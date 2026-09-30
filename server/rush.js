// Word Rush matches between two friends: three rounds, same boards for both
// players, played whenever each of them likes. Match documents live under
// r:<id>; each player's list is the set pr:<playerId>.
import { makeBoard, solve, hashWords, scoreWords, ROUNDS, ROUND_SECONDS } from '../shared/rush/board.js';
import { newId, HttpError, TTL } from './util.js';

const MAX_LIST = 60;
// Shorter rounds can be set for testing.
const roundSeconds = +process.env.ROUND_SECONDS || ROUND_SECONDS;

export function createRush({ store, dict }) {
  // Serialise writes per match so two requests can't interleave.
  const locks = new Map();
  const withLock = (id, fn) => {
    const run = (locks.get(id) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(id, tail);
    tail.then(() => locks.get(id) === tail && locks.delete(id));
    return run;
  };

  // Solutions are cheap (~1 ms) but asked for often; keep recent ones.
  const solved = new Map();
  const wordsOf = (g, r) => {
    const key = g.id + ':' + r;
    let all = solved.get(key);
    if (!all) {
      all = solve(g.b[r], dict);
      solved.set(key, all);
      if (solved.size > 300) solved.delete(solved.keys().next().value);
    }
    return all;
  };

  const load = async id => {
    if (typeof id !== 'string' || !/^[\w-]{6,20}$/.test(id)) return null;
    const raw = await store.get('r:' + id);
    return raw ? JSON.parse(raw) : null;
  };
  const isOver = g => g.ff != null || g.res.every(rs => rs.every(x => x?.done));
  const save = g => store.set('r:' + g.id, JSON.stringify(g), isOver(g) ? TTL.done : g.pl[1] ? TTL.active : TTL.waiting);
  const seatOf = (g, pid) => (g.pl[0]?.id === pid ? 0 : g.pl[1]?.id === pid ? 1 : -1);
  const mustSeat = (g, pid) => {
    const seat = g ? seatOf(g, pid) : -1;
    if (seat < 0) throw new HttpError(404, 'Match not found.');
    return seat;
  };
  const nextRound = (g, seat) => g.res[seat].findIndex(x => !x?.done);
  const total = (g, seat) => g.res[seat].reduce((s, x) => s + (x?.done ? x.s : 0), 0);

  // The match as one player sees it. Scores are public; words are only
  // revealed round by round once you've played that round.
  function view(g, seat) {
    const over = isOver(g);
    const tot = [total(g, 0), total(g, 1)];
    const out = {
      id: g.id, ver: g.ver, u: g.u, me: seat,
      pl: g.pl.map(p => (p ? p.n : null)),
      r: [0, 1, 2].map(r => [0, 1].map(s => {
        const x = g.res[s][r];
        return x ? { s: x.done ? x.s : null, n: x.done ? x.w.length : null, done: !!x.done, st: s === seat && !x.done ? x.st : undefined } : null;
      })),
      tot, over, next: nextRound(g, seat),
    };
    if (over) out.win = g.ff != null ? 1 - g.ff : tot[0] === tot[1] ? 2 : tot[0] > tot[1] ? 0 : 1;
    if (g.ff != null) out.ff = g.ff;
    if (g.jk && seat === 0) out.jk = g.jk;
    if (g.rm) out.rm = g.rm;
    return out;
  }

  async function create(player, opponent = null) {
    const now = Date.now();
    const seed = newId(12);
    const g = {
      id: newId(), t: 'rush', c: now, u: now, ver: 1, seed,
      pl: [{ id: player.id, n: player.n }, opponent ? { id: opponent.id, n: opponent.n } : null],
      b: [0, 1, 2].map(r => makeBoard(seed, r, dict)),
      res: [[null, null, null], [null, null, null]],
    };
    if (!opponent) g.jk = newId(6);
    await save(g);
    await store.sadd('pr:' + player.id, g.id, TTL.list);
    if (opponent) await store.sadd('pr:' + opponent.id, g.id, TTL.list);
    return g;
  }

  return {
    load, view, seatOf, nextRound, isOver,

    async get(pid, id) {
      const g = await load(id);
      return { g, seat: mustSeat(g, pid) };
    },

    async list(pid) {
      const ids = await store.smembers('pr:' + pid);
      const raws = await store.mget(ids.map(id => 'r:' + id));
      const games = [];
      ids.forEach((id, k) => (raws[k] ? games.push(JSON.parse(raws[k])) : store.srem('pr:' + pid, id)));
      games.sort((a, b) => b.u - a.u);
      const done = games.filter(isOver);
      for (const g of done.slice(20)) store.srem('pr:' + pid, g.id);
      return games
        .filter(g => !isOver(g) || done.indexOf(g) < 20)
        .slice(0, MAX_LIST)
        .map(g => view(g, seatOf(g, pid)));
    },

    create: player => create(player),

    // Both players asking for a rematch get the same new match.
    rematch: (player, id) =>
      withLock(id, async () => {
        const old = await load(id);
        const seat = mustSeat(old, player.id);
        if (old.rm) {
          const existing = await load(old.rm);
          if (existing) return { g: existing, created: false };
        }
        if (!old.pl[1]) throw new HttpError(400, 'Nobody has joined that match yet.');
        if (!isOver(old)) throw new HttpError(400, 'Finish this match first.');
        const other = old.pl[1 - seat];
        const g = await create({ id: player.id, n: player.n }, other);
        old.rm = g.id;
        old.ver++;
        await save(old);
        return { g, created: true, other };
      }),

    async invite(id, jk) {
      const g = await load(id);
      if (!g || !g.jk || g.jk !== jk) return null;
      return { id: g.id, by: g.pl[0].n };
    },

    join: (player, id, jk) =>
      withLock(id, async () => {
        const g = await load(id);
        if (!g) throw new HttpError(404, 'That invite has expired.');
        const seat = seatOf(g, player.id);
        if (seat >= 0) return { g, seat, joined: false };
        if (!g.jk || g.jk !== jk) throw new HttpError(409, 'Someone else already joined that match.');
        g.pl[1] = { id: player.id, n: player.n };
        delete g.jk;
        g.ver++;
        g.u = Date.now();
        await save(g);
        await store.sadd('pr:' + player.id, g.id, TTL.list);
        return { g, seat: 1, joined: true };
      }),

    // Starts (or resumes) a round and hands out the board. Valid words go out
    // as salted hashes so the browser can check words instantly without the
    // answers being readable.
    start: (player, id, r) =>
      withLock(id, async () => {
        const g = await load(id);
        const seat = mustSeat(g, player.id);
        if (isOver(g)) throw new HttpError(400, 'This match is over.');
        if (r !== nextRound(g, seat)) throw new HttpError(400, 'Play the rounds in order.');
        let x = g.res[seat][r];
        if (!x) {
          x = g.res[seat][r] = { st: Date.now(), done: false, s: 0, w: [] };
          g.ver++;
          await save(g);
        }
        const salt = `${g.id}:${r}:`;
        return { r, b: g.b[r], h: hashWords(wordsOf(g, r).map(x => x.w), salt), salt, st: x.st, now: Date.now(), sec: roundSeconds };
      }),

    submit: (player, id, r, words) =>
      withLock(id, async () => {
        const g = await load(id);
        const seat = mustSeat(g, player.id);
        const x = g.res[seat]?.[r];
        if (!x) throw new HttpError(400, "That round hasn't started.");
        if (!x.done) {
          const valid = new Set(wordsOf(g, r).map(x => x.w));
          const list = Array.isArray(words) ? words.slice(0, 400) : [];
          const res = scoreWords(g.b[r], list, w => valid.has(w));
          Object.assign(x, { done: true, s: res.total, w: res.words.map(y => y.w) });
          g.ver++;
          g.u = Date.now();
          await save(g);
        }
        return { g, seat, r };
      }),

    // Everything about a round you've played: your words, your friend's (if
    // they've played it), and all the words you could have found.
    recap(g, seat, r) {
      const mine = g.res[seat][r], theirs = g.res[1 - seat][r];
      if (!mine?.done) throw new HttpError(400, 'Play this round first.');
      const all = wordsOf(g, r);
      const score = new Map(all.map(x => [x.w, x.s]));
      const withScores = ws => ws.map(w => ({ w, s: score.get(w) || 0 }));
      return {
        r, b: g.b[r], mine: withScores(mine.w), s: mine.s,
        opp: theirs?.done ? { s: theirs.s, w: withScores(theirs.w) } : null,
        all,
      };
    },

    // Leaving a match forfeits it; an invite nobody accepted is deleted.
    remove: (player, id) =>
      withLock(id, async () => {
        const g = await load(id);
        const seat = mustSeat(g, player.id);
        let forfeited = false;
        if (!g.pl[1]) await store.del('r:' + g.id);
        else if (!isOver(g)) {
          g.ff = seat;
          g.ver++;
          g.u = Date.now();
          await save(g);
          forfeited = true;
        }
        await store.srem('pr:' + player.id, g.id);
        return { g, seat, forfeited };
      }),

    async rename(player) {
      for (const id of await store.smembers('pr:' + player.id)) {
        await withLock(id, async () => {
          const g = await load(id);
          const seat = g ? seatOf(g, player.id) : -1;
          if (seat < 0 || g.pl[seat].n === player.n) return;
          g.pl[seat].n = player.n;
          g.ver++;
          await save(g);
        });
      }
    },
  };
}
