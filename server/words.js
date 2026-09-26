// Online word games: storage, access control and the per-player views sent
// to browsers. Game documents live under g:<id>; each player's game list is
// the set pg:<playerId>.
import { randomBytes, randomInt } from 'node:crypto';
import * as G from '../shared/words/game.js';

const DAY = 86400;
export const TTL = { active: 180 * DAY, done: 45 * DAY, waiting: 30 * DAY, list: 400 * DAY };
const MAX_CHAT = 60;
const MAX_LIST = 60;

export const newId = (bytes = 9) => randomBytes(bytes).toString('base64url');
const rand = n => randomInt(n);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createWords({ store, dict }) {
  // Serialise writes per game so two requests can't interleave.
  const locks = new Map();
  const withLock = (gid, fn) => {
    const prev = locks.get(gid) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(gid, tail);
    tail.then(() => locks.get(gid) === tail && locks.delete(gid));
    return run;
  };

  const load = async gid => {
    if (typeof gid !== 'string' || !/^[\w-]{6,20}$/.test(gid)) return null;
    const raw = await store.get('g:' + gid);
    return raw ? JSON.parse(raw) : null;
  };
  const save = g => {
    const ttl = g.st.over ? TTL.done : g.pl[1] ? TTL.active : TTL.waiting;
    return store.set('g:' + g.id, JSON.stringify(g), ttl);
  };
  const seatOf = (g, pid) => (g.pl[0]?.id === pid ? 0 : g.pl[1]?.id === pid ? 1 : -1);
  const mustSeat = (g, pid) => {
    const seat = g ? seatOf(g, pid) : -1;
    if (seat < 0) throw new HttpError(404, 'Game not found.');
    return seat;
  };

  // The game as one player sees it: no opponent rack, no bag contents.
  function view(g, seat) {
    const st = g.st;
    const out = {
      id: g.id, v: st.v, ver: g.ver, u: g.u, me: seat,
      pl: g.pl.map(p => (p ? p.n : null)),
      b: st.b, r: st.r[seat], bag: st.bag.length, s: st.s, turn: st.turn,
      m: st.m, over: st.over, win: st.win, chat: g.chat,
    };
    if (st.over) {
      out.end = st.end;
      out.rr = st.r;
    }
    if (g.jk && seat === 0) out.jk = g.jk;
    if (g.next) out.next = g.next;
    return out;
  }

  // What changed after a move: enough for a client that has version ver-1
  // to catch up without downloading the whole game again.
  function delta(g, seat, move) {
    const st = g.st;
    const d = { ver: g.ver, u: g.u, mv: move, s: st.s, bag: st.bag.length, turn: st.turn, over: st.over, win: st.win };
    if (seat >= 0) d.r = st.r[seat];
    if (st.over) {
      d.end = st.end;
      d.rr = st.r;
    }
    return d;
  }

  function summary(g, pid) {
    const seat = seatOf(g, pid), st = g.st;
    const last = st.m[st.m.length - 1];
    const out = {
      id: g.id, v: st.v, ver: g.ver, u: g.u, me: seat,
      opp: g.pl[1 - seat]?.n || null, s: st.s, turn: st.turn, over: st.over, win: st.win,
      cc: g.chat.length,
    };
    if (last) out.last = { p: last.p, k: last.k, s: last.s, w: last.w?.[0] };
    if (g.jk && seat === 0) out.jk = g.jk;
    return out;
  }

  async function list(pid) {
    const ids = await store.smembers('pg:' + pid);
    const raws = await store.mget(ids.map(id => 'g:' + id));
    const games = [];
    for (let k = 0; k < ids.length; k++) {
      if (!raws[k]) {
        store.srem('pg:' + pid, ids[k]); // expired
        continue;
      }
      games.push(JSON.parse(raws[k]));
    }
    games.sort((a, b) => b.u - a.u);
    // Keep the list bounded: drop the oldest finished games.
    const done = games.filter(g => g.st.over);
    for (const g of done.slice(20)) store.srem('pg:' + pid, g.id);
    const keep = games.filter(g => !g.st.over || done.indexOf(g) < 20).slice(0, MAX_LIST);
    return keep.map(g => summary(g, pid));
  }

  async function create(player, variantId, opponent = null) {
    const now = Date.now();
    const g = {
      id: newId(), t: 'words', c: now, u: now, ver: 1,
      pl: [{ id: player.id, n: player.n }, opponent ? { id: opponent.id, n: opponent.n } : null],
      st: G.createState(variantId, rand),
      chat: [],
    };
    if (!opponent) g.jk = newId(6);
    await save(g);
    await store.sadd('pg:' + player.id, g.id, TTL.list);
    if (opponent) await store.sadd('pg:' + opponent.id, g.id, TTL.list);
    return g;
  }

  return {
    load, view, summary, list, seatOf,

    async get(pid, gid) {
      const g = await load(gid);
      return { g, seat: mustSeat(g, pid) };
    },

    create: (player, variantId) => create(player, variantId),

    // A new game against the same opponent. Whoever moved second last time
    // moves first. Both players asking for a rematch get the same new game.
    rematch: (player, gid) =>
      withLock(gid, async () => {
        const old = await load(gid);
        const seat = mustSeat(old, player.id);
        if (old.next) {
          const existing = await load(old.next);
          if (existing) return { g: existing, created: false };
        }
        if (!old.pl[1]) throw new HttpError(400, 'Nobody has joined that game yet.');
        if (!old.st.over) throw new HttpError(400, 'Finish this game first.');
        const other = old.pl[1 - seat];
        const fresh = p => (p.id === player.id ? { id: p.id, n: player.n } : p);
        const g = await create(fresh(old.pl[1]), old.st.v, fresh(old.pl[0]));
        old.next = g.id;
        old.ver++;
        await save(old);
        return { g, created: true, other };
      }),

    // Public details of an invite, shown before joining.
    async invite(gid, jk) {
      const g = await load(gid);
      if (!g || !g.jk || g.jk !== jk) return null;
      return { id: g.id, v: g.st.v, by: g.pl[0].n };
    },

    join: (player, gid, jk) =>
      withLock(gid, async () => {
        const g = await load(gid);
        if (!g) throw new HttpError(404, 'That invite has expired.');
        const seat = seatOf(g, player.id);
        if (seat >= 0) return { g, seat, joined: false };
        if (!g.jk || g.jk !== jk) throw new HttpError(409, 'Someone else already joined that game.');
        g.pl[1] = { id: player.id, n: player.n };
        delete g.jk;
        g.ver++;
        g.u = Date.now();
        await save(g);
        await store.sadd('pg:' + player.id, g.id, TTL.list);
        return { g, seat: 1, joined: true };
      }),

    move: (player, gid, body) =>
      withLock(gid, async () => {
        const g = await load(gid);
        const seat = mustSeat(g, player.id);
        const st = g.st;
        const k = body?.k;
        let res;
        if (k === 'play') res = G.play(st, seat, body.t, dict);
        else if (k === 'swap') res = G.swap(st, seat, body.t, rand);
        else if (k === 'pass') res = G.pass(st, seat);
        else if (k === 'resign') res = G.resign(st, seat);
        else throw new HttpError(400, 'Unknown move.');
        if (!res.ok) throw Object.assign(new HttpError(400, res.error), { bad: res.bad });
        g.ver++;
        g.u = Date.now();
        await save(g);
        return { g, seat, move: res.move };
      }),

    chat: (player, gid, text) =>
      withLock(gid, async () => {
        const g = await load(gid);
        const seat = mustSeat(g, player.id);
        const m = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
        if (!m) throw new HttpError(400, 'Say something!');
        const c = { p: seat, m, at: Date.now() };
        g.chat.push(c);
        if (g.chat.length > MAX_CHAT) g.chat.splice(0, g.chat.length - MAX_CHAT);
        g.ver++;
        await save(g);
        return { g, seat, c };
      }),

    // Removes a game from the player's list. Unfinished games are resigned
    // first; an invite nobody accepted is deleted outright.
    remove: (player, gid) =>
      withLock(gid, async () => {
        const g = await load(gid);
        const seat = mustSeat(g, player.id);
        let move = null;
        if (!g.pl[1]) await store.del('g:' + g.id);
        else if (!g.st.over) {
          move = G.resign(g.st, seat).move;
          g.ver++;
          g.u = Date.now();
          await save(g);
        }
        await store.srem('pg:' + player.id, g.id);
        return { g, seat, move };
      }),

    // Keeps the display name in step across a player's games.
    async rename(player) {
      for (const gid of await store.smembers('pg:' + player.id)) {
        await withLock(gid, async () => {
          const g = await load(gid);
          const seat = g ? seatOf(g, player.id) : -1;
          if (seat < 0 || g.pl[seat].n === player.n) return;
          g.pl[seat].n = player.n;
          g.ver++;
          await save(g);
        });
      }
    },

    delta,
  };
}
