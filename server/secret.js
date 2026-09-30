// Secret Word: one player picks a 5-letter word, the other has 6 guesses.
// The word stays on the server until the guessing is over. Challenges live
// under w:<id>; each player's list is the set pw:<playerId>. The daily word
// leaderboard is dw:<YYYY-MM-DD>.
import { feedback, outcome, dailyAnswer, MAX_GUESSES } from '../shared/secret/game.js';
import { newId, HttpError, TTL } from './util.js';

export function createSecret({ store, words }) {
  const { allowed, answers } = words;
  const locks = new Map();
  const withLock = (id, fn) => {
    const run = (locks.get(id) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(id, tail);
    tail.then(() => locks.get(id) === tail && locks.delete(id));
    return run;
  };

  const clean = w => String(w ?? '').trim().toUpperCase();
  const mustWord = w => {
    w = clean(w);
    if (!/^[A-Z]{5}$/.test(w)) throw new HttpError(400, 'Words have 5 letters.');
    if (!allowed.has(w)) throw new HttpError(400, `${w} isn't in the word list.`);
    return w;
  };

  const load = async id => {
    if (typeof id !== 'string' || !/^[\w-]{6,20}$/.test(id)) return null;
    const raw = await store.get('w:' + id);
    return raw ? JSON.parse(raw) : null;
  };
  const isDone = c => outcome(c.g, c.word).done || c.gaveUp;
  const save = c => store.set('w:' + c.id, JSON.stringify(c), isDone(c) ? TTL.done : c.to ? TTL.active : TTL.waiting);
  const roleOf = (c, pid) => (c.from.id === pid ? 'setter' : c.to?.id === pid ? 'guesser' : null);
  const mustRole = (c, pid) => {
    const r = c && roleOf(c, pid);
    if (!r) throw new HttpError(404, 'Challenge not found.');
    return r;
  };

  // What one player sees. The guesser only learns the word once done.
  function view(c, pid) {
    const role = roleOf(c, pid);
    const done = isDone(c);
    const res = outcome(c.g, c.word);
    const out = {
      id: c.id, ver: c.ver, u: c.u, role,
      from: c.from.n, to: c.to?.n || null,
      g: c.g, fb: c.g.map(g => feedback(g, c.word)),
      done, solved: res.solved, tries: res.tries,
    };
    if (role === 'setter' || done) out.word = c.word;
    if (c.jk && role === 'setter') out.jk = c.jk;
    if (c.back) out.back = c.back;
    return out;
  }

  async function create(from, word, to = null) {
    const now = Date.now();
    const c = { id: newId(), t: 'sw', c: now, u: now, ver: 1, from: { id: from.id, n: from.n }, to: to ? { id: to.id, n: to.n } : null, word, g: [] };
    if (!to) c.jk = newId(6);
    await save(c);
    await store.sadd('pw:' + from.id, c.id, TTL.list);
    if (to) await store.sadd('pw:' + to.id, c.id, TTL.list);
    return c;
  }

  // Daily word leaderboard (same idea as the Word Rush daily).
  let chain = Promise.resolve();
  const serial = fn => (chain = chain.then(fn, fn));
  const checkDay = day => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
    const t = m && Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (!t || Math.abs(t + 12 * 3600e3 - Date.now()) > 40 * 3600e3) throw new HttpError(400, 'That daily word has closed.');
    return day;
  };
  const table = (entries, pid) =>
    Object.entries(entries)
      .map(([id, e]) => ({ n: e.n, t: e.t, fb: e.fb, me: id === pid || undefined }))
      .sort((a, b) => (a.t ?? 99) - (b.t ?? 99));

  return {
    load, view, isDone,

    async list(pid) {
      const ids = await store.smembers('pw:' + pid);
      const raws = await store.mget(ids.map(id => 'w:' + id));
      const all = [];
      ids.forEach((id, k) => (raws[k] ? all.push(JSON.parse(raws[k])) : store.srem('pw:' + pid, id)));
      all.sort((a, b) => b.u - a.u);
      const done = all.filter(isDone);
      for (const c of done.slice(40)) store.srem('pw:' + pid, c.id);
      return all.filter(c => !isDone(c) || done.indexOf(c) < 40).map(c => view(c, pid));
    },

    async get(pid, id) {
      const c = await load(id);
      mustRole(c, pid);
      return c;
    },

    // A new challenge: open (invite link) or straight to someone you've
    // played with ("send one back").
    async create(player, word, replyTo) {
      word = mustWord(word);
      if (!replyTo) return { c: await create(player, word) };
      return withLock(replyTo, async () => {
        const old = await load(replyTo);
        const role = mustRole(old, player.id);
        const other = role === 'setter' ? old.to : old.from;
        if (!other) throw new HttpError(400, 'Nobody has joined that challenge yet.');
        const c = await create(player, word, other);
        if (role === 'guesser') {
          old.back = c.id;
          old.ver++;
          await save(old);
        }
        return { c, other };
      });
    },

    async invite(id, jk) {
      const c = await load(id);
      if (!c || !c.jk || c.jk !== jk) return null;
      return { id: c.id, by: c.from.n };
    },

    join: (player, id, jk) =>
      withLock(id, async () => {
        const c = await load(id);
        if (!c) throw new HttpError(404, 'That invite has expired.');
        if (roleOf(c, player.id)) return { c, joined: false };
        if (!c.jk || c.jk !== jk) throw new HttpError(409, 'Someone else already took that challenge.');
        c.to = { id: player.id, n: player.n };
        delete c.jk;
        c.ver++;
        c.u = Date.now();
        await save(c);
        await store.sadd('pw:' + player.id, c.id, TTL.list);
        return { c, joined: true };
      }),

    guess: (player, id, word) =>
      withLock(id, async () => {
        const c = await load(id);
        if (mustRole(c, player.id) !== 'guesser') throw new HttpError(400, 'You picked this word!');
        if (isDone(c)) throw new HttpError(400, 'This challenge is over.');
        const g = mustWord(word);
        if (c.g.includes(g)) throw new HttpError(400, `You already tried ${g}.`);
        c.g.push(g);
        c.ver++;
        c.u = Date.now();
        await save(c);
        return c;
      }),

    remove: (player, id) =>
      withLock(id, async () => {
        const c = await load(id);
        const role = mustRole(c, player.id);
        if (!c.to) await store.del('w:' + c.id);
        else if (!isDone(c) && role === 'guesser') {
          c.gaveUp = true;
          c.ver++;
          c.u = Date.now();
          await save(c);
        }
        await store.srem('pw:' + player.id, c.id);
        return c;
      }),

    async rename(player) {
      for (const id of await store.smembers('pw:' + player.id)) {
        await withLock(id, async () => {
          const c = await load(id);
          if (!c) return;
          let changed = false;
          for (const k of ['from', 'to']) if (c[k]?.id === player.id && c[k].n !== player.n) (c[k].n = player.n), (changed = true);
          if (changed) {
            c.ver++;
            await save(c);
          }
        });
      }
    },

    // Daily: the server checks the guesses against the day's word.
    async dailyScores(player, day) {
      return table(JSON.parse((await store.get('dw:' + checkDay(day))) || '{}'), player.id);
    },

    dailySubmit: (player, day, guesses) =>
      serial(async () => {
        checkDay(day);
        const entries = JSON.parse((await store.get('dw:' + day)) || '{}');
        if (!entries[player.id]) {
          if (Object.keys(entries).length >= 500) throw new HttpError(400, 'The daily word is full today.');
          const answer = dailyAnswer(day, answers);
          const list = (Array.isArray(guesses) ? guesses : []).slice(0, MAX_GUESSES).map(clean).filter(g => allowed.has(g));
          const res = outcome(list, answer);
          const used = res.solved ? list.slice(0, res.tries) : list;
          entries[player.id] = { n: player.n, t: res.tries, fb: used.map(g => feedback(g, answer)), at: Date.now() };
          await store.set('dw:' + day, JSON.stringify(entries), 8 * 86400);
        }
        return table(entries, player.id);
      }),
  };
}
