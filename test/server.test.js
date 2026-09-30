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

import { hashSet, hash32, solve } from '../shared/rush/board.js';

test('two friends play a Word Rush match: invite, rounds, recaps, rematch', async () => {
  const a = (await call('POST', '/api/hello', { name: '  Ann  ' })).data;
  const b = (await call('POST', '/api/hello', { name: 'Bob<script>' })).data;
  assert.equal(a.n, 'Ann');
  assert.equal(b.n, 'Bobscript');
  assert.equal((await call('GET', '/api/me', null, 'nope.nope')).status, 401);
  assert.equal((await call('GET', '/api/me', null, a.id + '.wrongsecret')).status, 401);

  const sa = socket(a.token), sb = socket(b.token);
  await sa.next(e => e.t === 'hi');
  await sb.next(e => e.t === 'hi');

  const g = (await call('POST', '/api/rush', {}, a.token)).data;
  assert.ok(g.jk);
  assert.equal(g.next, 0);
  assert.deepEqual(g.pl, ['Ann', null]);

  // Invite preview and join; a third player can't take the seat.
  assert.deepEqual((await call('GET', `/api/invite/${g.id}/${g.jk}`)).data, { id: g.id, by: 'Ann' });
  assert.equal((await call('GET', `/api/invite/${g.id}/wrong`)).status, 404);
  assert.equal((await call('GET', `/api/rush/${g.id}`, null, b.token)).status, 404, 'not visible before joining');
  const joined = (await call('POST', `/api/rush/${g.id}/join`, { jk: g.jk }, b.token)).data;
  assert.equal(joined.me, 1);
  assert.equal(joined.jk, undefined);
  await sa.next(e => e.t === 'up' && e.id === g.id);
  const c = (await call('POST', '/api/hello', { name: 'Cy' })).data;
  assert.equal((await call('POST', `/api/rush/${g.id}/join`, { jk: g.jk }, c.token)).status, 409);

  // Rounds must be played in order.
  assert.equal((await call('POST', `/api/rush/${g.id}/start?r=1`, {}, a.token)).status, 400);
  assert.equal((await call('POST', `/api/rush/${g.id}/submit?r=0`, { w: [] }, a.token)).status, 400, 'not started');

  // Ann plays round 1: the hashes identify the real words and nothing else.
  const st = (await call('POST', `/api/rush/${g.id}/start?r=0`, {}, a.token)).data;
  assert.equal(st.b.l.length, 16);
  assert.equal(st.sec, 90);
  const answers = solve(st.b, fullDict());
  const set = hashSet(st.h);
  assert.equal(set.size, answers.length);
  assert.ok(answers.every(x => set.has(hash32(st.salt + x.w))));
  assert.ok(!set.has(hash32(st.salt + 'ZZZZ')));
  // Starting again resumes the same round and clock.
  assert.equal((await call('POST', `/api/rush/${g.id}/start?r=0`, {}, a.token)).data.st, st.st);

  const picks = answers.slice(0, 5).map(x => x.w);
  const sub = (await call('POST', `/api/rush/${g.id}/submit?r=0`, { w: [...picks, picks[0], 'NOTAWORD', 'zzz'] }, a.token)).data;
  const expected = answers.slice(0, 5).reduce((s, x) => s + x.s, 0);
  assert.equal(sub.recap.s, expected);
  assert.deepEqual(sub.recap.mine.map(x => x.w), picks);
  assert.equal(sub.recap.opp, null, "Bob hasn't played yet");
  assert.equal(sub.recap.all.length, answers.length);
  assert.equal(sub.view.next, 1);
  assert.equal(sub.view.tot[0], expected);
  await sb.next(e => e.t === 'up' && e.id === g.id && e.ver === sub.view.ver);
  // Submitting twice doesn't change anything.
  assert.equal((await call('POST', `/api/rush/${g.id}/submit?r=0`, { w: answers.map(x => x.w) }, a.token)).data.recap.s, expected);

  // Bob sees Ann's score but not her words until he's played.
  const bv = await call('GET', `/api/rush/${g.id}`, null, b.token);
  assert.equal(bv.data.r[0][0].s, expected);
  assert.equal((await call('GET', `/api/rush/${g.id}/recap?r=0`, null, b.token)).status, 400);
  assert.equal((await call('GET', `/api/rush/${g.id}`, null, b.token, { 'If-None-Match': bv.headers.get('etag') })).status, 304);
  assert.equal((await call('GET', `/api/rush/${g.id}`, null, b.token, { 'If-None-Match': 'W/' + bv.headers.get('etag') })).status, 304);

  await call('POST', `/api/rush/${g.id}/start?r=0`, {}, b.token);
  const bsub = (await call('POST', `/api/rush/${g.id}/submit?r=0`, { w: [answers[0].w] }, b.token)).data;
  assert.deepEqual(bsub.recap.opp.w.map(x => x.w), picks, 'now Bob sees what Ann found');

  // Everyone plays the rest; then the match is over.
  for (const p of [a, b]) for (const r of [1, 2]) {
    if (p === b && r === 0) continue;
    await call('POST', `/api/rush/${g.id}/start?r=${r}`, {}, p.token);
    await call('POST', `/api/rush/${g.id}/submit?r=${r}`, { w: [] }, p.token);
  }
  const over = (await call('GET', `/api/rush/${g.id}`, null, a.token)).data;
  assert.equal(over.over, true);
  assert.equal(over.win, over.tot[0] > over.tot[1] ? 0 : 1);
  assert.equal(over.next, -1);

  const list = (await call('GET', '/api/rush', null, b.token));
  assert.equal(list.data.length, 1);
  assert.equal((await call('GET', '/api/rush', null, b.token, { 'If-None-Match': list.headers.get('etag') })).status, 304);

  // Rename flows into matches.
  await call('POST', '/api/me', { name: 'Bobby' }, b.token);
  assert.deepEqual((await call('GET', `/api/rush/${g.id}`, null, a.token)).data.pl, ['Ann', 'Bobby']);

  // Both asking for a rematch get the same new match.
  const r1 = (await call('POST', '/api/rush', { rematch: g.id }, b.token)).data;
  await sa.next(e => e.t === 'up' && e.id === r1.id);
  const r2 = (await call('POST', '/api/rush', { rematch: g.id }, a.token)).data;
  assert.equal(r2.id, r1.id);

  // Leaving an unfinished match forfeits it.
  await call('DELETE', `/api/rush/${r1.id}`, null, b.token);
  const ff = (await call('GET', `/api/rush/${r1.id}`, null, a.token)).data;
  assert.equal(ff.over, true);
  assert.equal(ff.win, ff.me);

  // An unjoined invite is deleted outright.
  const lonely = (await call('POST', '/api/rush', {}, a.token)).data;
  await call('DELETE', `/api/rush/${lonely.id}`, null, a.token);
  assert.equal(await store.get('r:' + lonely.id), null);

  sa.ws.close();
  sb.ws.close();
});

test('bad input is rejected politely', async () => {
  assert.equal((await fetch(base + '/ws')).status, 426);
  assert.equal((await call('POST', '/api/hello', { name: '   ' })).status, 400);
  const a = (await call('POST', '/api/hello', { name: 'Zed' })).data;
  const g = (await call('POST', '/api/rush', {}, a.token)).data;
  for (const r of ['x', '-1', '3', '1.5']) assert.equal((await call('POST', `/api/rush/${g.id}/start?r=${r}`, {}, a.token)).status, 400, r);
  assert.equal((await call('POST', `/api/rush/nope-nope/start?r=0`, {}, a.token)).status, 404);
  await call('POST', `/api/rush/${g.id}/start?r=0`, {}, a.token);
  assert.equal((await call('POST', `/api/rush/${g.id}/submit?r=0`, { w: 'CAT' }, a.token)).data.recap.s, 0);
  const res = await fetch(base + '/api/hello', { method: 'POST', body: '{bad' });
  assert.equal(res.status, 400);
});
