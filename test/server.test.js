import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { fullDict } from './helpers.js';

let app, store, base;

before(async () => {
  // Set TEST_REDIS_URL to run against a real Redis instead of memory.
  store = await createStore({ url: process.env.TEST_REDIS_URL, prefix: 'wnstest:' + Date.now() + ':' });
  app = await createApp({ store, dict: fullDict(), staticDir: '/nonexistent', log: { error() {} } });
  await new Promise(r => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  app.close();
  await store.close();
});

async function call(method, path, body, token, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
}

function socket(token) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const events = [];
  const waiters = [];
  ws.on('message', d => {
    const msg = JSON.parse(d);
    events.push(msg);
    waiters.splice(0).forEach(w => w());
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'auth', k: token })));
  const next = async pred => {
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      await new Promise((r, j) => { waiters.push(r); setTimeout(() => j(new Error('timeout')), 2000); });
    }
  };
  return { ws, events, next };
}

// Put known tiles on a player's rack by editing the stored game.
async function setRack(gid, seat, rack) {
  const g = JSON.parse(await store.get('g:' + gid));
  g.st.r[seat] = rack;
  await store.set('g:' + gid, JSON.stringify(g));
}

test('two friends play a game through invites, moves, chat and a rematch', async () => {
  const a = (await call('POST', '/api/hello', { name: '  Ann  ' })).data;
  const b = (await call('POST', '/api/hello', { name: 'Bob<script>' })).data;
  assert.equal(a.n, 'Ann');
  assert.equal(b.n, 'Bobscript');
  assert.equal((await call('GET', '/api/me', null, 'nope.nope')).status, 401);
  assert.equal((await call('GET', '/api/me', null, a.id + '.wrongsecret')).status, 401);

  const sa = socket(a.token), sb = socket(b.token);
  await sa.next(e => e.t === 'hi');
  await sb.next(e => e.t === 'hi');

  const g = (await call('POST', '/api/games', { v: 'classic' }, a.token)).data;
  assert.equal(g.v, 'classic');
  assert.equal(g.r.length, 7);
  assert.ok(g.jk);
  assert.equal(g.pl[1], null);

  // Invite preview, then Bob joins. Ann can't join her own invite as seat 1.
  const inv = await call('GET', `/api/invite/${g.id}/${g.jk}`);
  assert.deepEqual(inv.data, { id: g.id, v: 'classic', by: 'Ann' });
  assert.equal((await call('GET', `/api/invite/${g.id}/wrong`)).status, 404);
  assert.equal((await call('GET', `/api/games/${g.id}`, null, b.token)).status, 404, 'not visible before joining');
  const joined = (await call('POST', `/api/games/${g.id}/join`, { jk: g.jk }, b.token)).data;
  assert.equal(joined.me, 1);
  assert.equal(joined.jk, undefined);
  assert.deepEqual(joined.pl, ['Ann', 'Bobscript']);
  await sa.next(e => e.t === 'join' && e.id === g.id);
  // A third player can't take the seat.
  const c = (await call('POST', '/api/hello', { name: 'Cy' })).data;
  assert.equal((await call('POST', `/api/games/${g.id}/join`, { jk: g.jk }, c.token)).status, 409);

  // Bob can't see Ann's rack.
  const bobView = (await call('GET', `/api/games/${g.id}`, null, b.token));
  assert.equal(bobView.data.r.length, 7);
  assert.equal(bobView.data.rr, undefined);
  const etag = bobView.headers.get('etag');
  assert.equal((await call('GET', `/api/games/${g.id}`, null, b.token, { 'If-None-Match': etag })).status, 304);
  // Edge proxies may hand the browser a weak version of the tag.
  assert.equal((await call('GET', `/api/games/${g.id}`, null, b.token, { 'If-None-Match': 'W/' + etag })).status, 304);

  await setRack(g.id, 0, 'CATSDOG');
  assert.equal((await call('POST', `/api/games/${g.id}/move`, { k: 'play', t: [[112, 'C'], [113, 'A'], [114, 'T']] }, b.token)).status, 400, "not Bob's turn");
  const bad = await call('POST', `/api/games/${g.id}/move`, { k: 'play', t: [[111, 'D'], [112, 'O'], [113, 'G'], [114, 'S'], [115, 'T']] }, a.token);
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.data.bad, ['DOGST']);
  const mv = await call('POST', `/api/games/${g.id}/move`, { k: 'play', t: [[111, 'C'], [112, 'A'], [113, 'T']] }, a.token);
  assert.equal(mv.status, 200, JSON.stringify(mv.data));
  assert.equal(mv.data.mv.s, 10);
  assert.equal(mv.data.r.length, 7);
  assert.equal(mv.data.turn, 1);
  const ev = await sb.next(e => e.t === 'mv' && e.id === g.id);
  assert.equal(ev.d.mv.w[0], 'CAT');
  assert.equal(ev.d.r.length, 7, "Bob's event carries Bob's rack");
  assert.equal(ev.d.ver, mv.data.ver);

  const chat = await call('POST', `/api/games/${g.id}/chat`, { m: 'nice one' }, b.token);
  assert.equal(chat.status, 200);
  assert.equal((await sa.next(e => e.t === 'chat')).c.m, 'nice one');

  const list = await call('GET', '/api/games', null, b.token);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].opp, 'Ann');
  assert.equal(list.data[0].turn, 1);
  assert.equal((await call('GET', '/api/games', null, b.token, { 'If-None-Match': list.headers.get('etag') })).status, 304);

  // Rename flows into games.
  await call('POST', '/api/me', { name: 'Bobby' }, b.token);
  assert.deepEqual((await call('GET', `/api/games/${g.id}`, null, a.token)).data.pl, ['Ann', 'Bobby']);

  // Bob resigns by removing the game; Ann wins and both can rematch into one game.
  assert.equal((await call('DELETE', `/api/games/${g.id}`, null, b.token)).status, 200);
  const over = (await call('GET', `/api/games/${g.id}`, null, a.token)).data;
  assert.equal(over.over, true);
  assert.equal(over.win, 0);
  assert.equal((await call('GET', '/api/games', null, b.token)).data.length, 0);
  const r1 = (await call('POST', '/api/games', { rematch: g.id }, a.token)).data;
  assert.equal(r1.me, 1, 'Ann moved first last time, so Bob starts');
  await sb.next(e => e.t === 'new' && e.id === r1.id);
  const r2 = (await call('POST', '/api/games', { rematch: g.id }, b.token)).data;
  assert.equal(r2.id, r1.id);
  assert.equal(r2.me, 0);

  // An unjoined invite is deleted outright.
  const lonely = (await call('POST', '/api/games', { v: 'modern' }, a.token)).data;
  await call('DELETE', `/api/games/${lonely.id}`, null, a.token);
  assert.equal(await store.get('g:' + lonely.id), null);

  sa.ws.close();
  sb.ws.close();
});

test('bad input is rejected politely', async () => {
  assert.equal((await call('POST', '/api/hello', { name: '   ' })).status, 400);
  const a = (await call('POST', '/api/hello', { name: 'Zed' })).data;
  const g = (await call('POST', '/api/games', { v: 'nope' }, a.token)).data;
  assert.equal(g.v, 'modern');
  for (const body of [{ k: 'play', t: 'x' }, { k: 'play', t: [[999, 'A']] }, { k: 'play', t: [[112, '1']] }, { k: 'fly' }, { k: 'swap', t: ['Q', 'Q', 'Q', 'Q', 'Q', 'Q', 'Q', 'Q'] }]) {
    const r = await call('POST', `/api/games/${g.id}/move`, body, a.token);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await call('POST', `/api/games/${g.id}/chat`, { m: '   ' }, a.token)).status, 400);
  const res = await fetch(base + '/api/hello', { method: 'POST', body: '{bad' });
  assert.equal(res.status, 400);
});
