// HTTP server: JSON API under /api, WebSocket at /ws, the built client for
// everything else.
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRush } from './rush.js';
import { createDaily } from './daily.js';
import { HttpError } from './util.js';
import { createPlayers, cleanName } from './players.js';
import { createHub } from './hub.js';
import { createPush } from './push.js';
import { loadStatic, serveFile, etagMatches } from './static.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// Fixed-window rate limiter keyed by IP (or player).
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return key => {
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= max;
  };
}

export async function createApp({ store, dict, staticDir, publicUrl = 'http://localhost', log = console }) {
  const rush = createRush({ store, dict });
  const daily = createDaily({ store, dict });
  const players = createPlayers({ store });
  const files = loadStatic(staticDir);
  const push = await createPush({ store, players, subject: publicUrl.startsWith('https:') ? publicUrl : 'mailto:noreply@example.com' });

  const limits = {
    api: limiter(240, 60_000),
    hello: limiter(20, 3_600_000),
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      if (!(err instanceof HttpError)) log.error(err);
      if (res.headersSent) return res.end();
      const status = err instanceof HttpError ? err.status : 500;
      json(req, res, status, { error: status === 500 ? 'Something went wrong.' : err.message, bad: err.bad });
    });
  });
  const hub = createHub(server, { players });

  const csp = host =>
    `default-src 'self'; connect-src 'self' wss://${host} ws://${host}; img-src 'self' data:; style-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

  function json(req, res, status, data, headers = {}) {
    let body = Buffer.from(JSON.stringify(data));
    const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers };
    if (h.ETag) {
      h['Cache-Control'] = 'no-cache';
      if (etagMatches(req.headers['if-none-match'], h.ETag)) {
        res.writeHead(304, h);
        return res.end();
      }
    }
    if (body.length > 900 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body);
      h['Content-Encoding'] = 'gzip';
      h.Vary = 'Accept-Encoding';
    }
    h['Content-Length'] = body.length;
    res.writeHead(status, h);
    res.end(body);
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 16_384) throw new HttpError(413, 'Too much data.');
      chunks.push(c);
    }
    if (!size) return {};
    try {
      return JSON.parse(Buffer.concat(chunks));
    } catch {
      throw new HttpError(400, 'Bad JSON.');
    }
  }

  const ipOf = req =>
    req.headers['cf-connecting-ip'] || req.headers['true-client-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

  async function auth(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    const p = m && (await players.fromToken(m[1]));
    if (!p) throw new HttpError(401, 'Please set up your name again.');
    return p;
  }

  // Tell both players' devices that a match changed; the other player gets
  // a push notification if they have no app open.
  function notify(g, fromSeat, pushBody) {
    for (const seat of [0, 1]) {
      const p = g.pl[seat];
      if (!p) continue;
      const delivered = hub.send(p.id, { t: 'up', id: g.id, ver: g.ver });
      if (seat !== fromSeat && !delivered && pushBody) {
        push.send(p.id, { title: 'Words and Stuff', body: pushBody, url: '/rush/' + g.id, tag: g.id }).catch(e => log.error('push', e));
      }
    }
  }

  function roundMessage(g, seat, r) {
    const who = g.pl[seat].n, other = 1 - seat;
    const s = g.res[seat][r].s;
    if (rush.isOver(g)) {
      const v = rush.view(g, other);
      const mine = v.tot[other], theirs = v.tot[seat];
      return `${who} finished. ${v.win === 2 ? "It's a tie" : v.win === other ? 'You won' : `${who} won`} ${Math.max(mine, theirs)}–${Math.min(mine, theirs)}!`;
    }
    const behind = rush.nextRound(g, other) >= 0 && rush.nextRound(g, other) <= r;
    return `${who} scored ${s} in round ${r + 1}.${behind ? ' Your turn — can you beat it?' : ''}`;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;

    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }

    // WebSocket upgrades are handled by hub.js; a plain request here means a
    // proxy stripped the Upgrade header.
    if (path === '/ws') {
      res.writeHead(426, { 'Content-Type': 'text/plain', Upgrade: 'websocket' });
      return res.end('WebSocket only');
    }

    if (path.startsWith('/api/')) {
      if (!limits.api(ipOf(req))) throw new HttpError(429, 'Slow down a little.');
      return api(req, res, path.slice(5).split('/'), url);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    const file = files.get(path);
    if (file) return serveFile(req, res, file, { ...SECURITY_HEADERS, ...(file.type.startsWith('text/html') ? { 'Content-Security-Policy': csp(req.headers.host) } : {}) });
    // App routes (no file extension) all get the single-page app.
    const index = files.get('/index.html');
    if (index && !/\.\w+$/.test(path)) {
      return serveFile(req, res, index, { ...SECURITY_HEADERS, 'Content-Security-Policy': csp(req.headers.host) });
    }
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Not found');
  }

  async function api(req, res, [a, b, c], url) {
    const m = req.method;
    const send = (data, status = 200, headers) => json(req, res, status, data, headers);

    if (m === 'GET' && a === 'config') {
      return send({ push: push.publicKey }, 200, { 'Cache-Control': 'public, max-age=3600' });
    }

    // New player: just a name.
    if (m === 'POST' && a === 'hello') {
      if (!limits.hello(ipOf(req))) throw new HttpError(429, 'Too many new players from here. Try again later.');
      const body = await readBody(req);
      const { player, token } = await players.create(body.name);
      return send({ id: player.id, n: player.n, token });
    }

    // Public invite details (no auth needed).
    if (m === 'GET' && a === 'invite' && b && c) {
      const inv = await rush.invite(b, c);
      if (!inv) throw new HttpError(404, 'That invite has expired or was already used.');
      return send(inv);
    }

    const me = await auth(req);

    if (a === 'me') {
      if (m === 'GET') return send({ id: me.id, n: me.n, push: (me.push || []).length });
      if (m === 'POST') {
        const body = await readBody(req);
        me.n = cleanName(body.name);
        await players.save(me);
        await rush.rename(me);
        return send({ id: me.id, n: me.n });
      }
    }

    if (a === 'push') {
      const body = await readBody(req);
      if (m === 'POST') {
        if (!(await push.subscribe(me, body.sub))) throw new HttpError(400, 'Bad subscription.');
        return send({ ok: true });
      }
      if (m === 'DELETE') {
        await push.unsubscribe(me, String(body.endpoint || ''));
        return send({ ok: true });
      }
    }

    if (a === 'daily' && b) {
      if (m === 'GET') return send(await daily.scores(me, b));
      if (m === 'POST') return send(await daily.submit(me, b, (await readBody(req)).w));
    }

    const tagged = (g, seat) => send(rush.view(g, seat), 200, { ETag: `"${g.ver}.${seat}"` });

    if (a === 'rush' && !b) {
      if (m === 'GET') {
        const list = await rush.list(me.id);
        const etag = '"' + createHash('sha1').update(JSON.stringify(list)).digest('base64url').slice(0, 16) + '"';
        return send(list, 200, { ETag: etag });
      }
      if (m === 'POST') {
        const body = await readBody(req);
        if (body.rematch) {
          const { g, created, other } = await rush.rematch(me, String(body.rematch));
          if (created) {
            notify(g, 0, null);
            if (!hub.online(other.id)) push.send(other.id, { title: 'Words and Stuff', body: `${me.n} wants a rematch!`, url: '/rush/' + g.id, tag: g.id }).catch(() => {});
          }
          return tagged(g, rush.seatOf(g, me.id));
        }
        return tagged(await rush.create(me), 0);
      }
    }

    if (a === 'rush' && b) {
      const round = () => {
        const r = Number(url.searchParams.get('r'));
        if (!Number.isInteger(r) || r < 0 || r > 2) throw new HttpError(400, 'Bad round.');
        return r;
      };
      if (m === 'GET' && !c) {
        const { g, seat } = await rush.get(me.id, b);
        return tagged(g, seat);
      }
      if (m === 'POST' && c === 'join') {
        const body = await readBody(req);
        const { g, seat, joined } = await rush.join(me, b, String(body.jk || ''));
        if (joined) notify(g, 1, `${me.n} joined your match!`);
        return tagged(g, seat);
      }
      if (m === 'POST' && c === 'start') {
        return send(await rush.start(me, b, round()));
      }
      if (m === 'POST' && c === 'submit') {
        const body = await readBody(req);
        const { g, seat, r } = await rush.submit(me, b, round(), body.w);
        notify(g, seat, roundMessage(g, seat, r));
        return send({ view: rush.view(g, seat), recap: rush.recap(g, seat, r) });
      }
      if (m === 'GET' && c === 'recap') {
        const { g, seat } = await rush.get(me.id, b);
        return send(rush.recap(g, seat, round()), 200, { ETag: `"${g.ver}.${seat}.r"` });
      }
      if (m === 'DELETE' && !c) {
        const { g, seat, forfeited } = await rush.remove(me, b);
        if (forfeited) notify(g, seat, `${me.n} left the match. You win!`);
        return send({ ok: true });
      }
    }

    throw new HttpError(404, 'Not found.');
  }

  return {
    server,
    close() {
      hub.close();
      server.close();
    },
  };
}
