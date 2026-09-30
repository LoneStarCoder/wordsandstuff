// A "match" gives the screens a view of a Word Rush match and a way to play
// its rounds. OnlineMatch talks to the server; BotMatch runs on the device.
// Both expose the view shape the server sends (see server/rush.js).
import { api, live, ApiError } from '../net.js';
import { local } from '../dom.js';
import { makeBoard, solve, hashSet, hash32, scoreWords, botRound, rng, ROUNDS, ROUND_SECONDS } from '../../../shared/rush/board.js';
import { loadDict } from './dict.js';

class Emitter {
  listeners = new Set();
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.listeners.forEach(fn => fn());
  }
}

// --- Online ---------------------------------------------------------------

export class OnlineMatch extends Emitter {
  kind = 'online';

  constructor(id) {
    super();
    this.id = id;
    this.base = '/rush/' + id;
    const cached = local.get('wns.m.' + id);
    this.view = cached?.view || null;
    this.etag = cached?.etag || null;
    this.off = live.on(msg => {
      if (msg.t === 'resync' || (msg.t === 'up' && msg.id === id && msg.ver !== this.view?.ver)) this.refresh().catch(() => {});
    });
    live.connect();
  }

  set(view, etag) {
    this.view = view;
    this.etag = etag || `"${view.ver}.${view.me}"`;
    local.set('wns.m.' + this.id, { view, etag: this.etag });
    this.emit();
  }

  async refresh() {
    try {
      const res = await api('GET', 'rush/' + this.id, null, { etag: this.view && this.etag, quiet: !!this.view });
      if (res.status !== 304) this.set(res.data, res.etag);
    } catch (e) {
      if (!this.view || e.status === 404) throw e;
    }
  }

  async startRound(r) {
    const { data } = await api('POST', `rush/${this.id}/start?r=${r}`, {});
    const hashes = hashSet(data.h);
    const opp = this.view.r[r][1 - this.view.me];
    return {
      board: data.b,
      isWord: w => hashes.has(hash32(data.salt + w)),
      // Use the server's clock for elapsed time, the device clock from here on.
      endsAt: Date.now() + (data.sec * 1000 - (data.now - data.st)),
      total: data.sec,
      target: opp?.done ? { name: this.view.pl[1 - this.view.me], s: opp.s } : null,
    };
  }

  async submit(r, words) {
    const { data } = await api('POST', `rush/${this.id}/submit?r=${r}`, { w: words });
    this.set(data.view);
    local.set(`wns.rc.${this.id}.${r}`, data.recap);
    return data.recap;
  }

  async recap(r) {
    const key = `wns.rc.${this.id}.${r}`;
    const cached = local.get(key);
    // A cached recap is final once it includes your friend's words.
    if (cached?.opp) return cached;
    const { data } = await api('GET', `rush/${this.id}/recap?r=${r}`, null, { quiet: !!cached });
    local.set(key, data);
    return data;
  }

  async rematch() {
    const res = await api('POST', 'rush', { rematch: this.id });
    local.set('wns.m.' + res.data.id, { view: res.data, etag: res.etag });
    return '/rush/' + res.data.id;
  }

  async remove() {
    await api('DELETE', 'rush/' + this.id);
  }

  close() {
    this.off();
  }
}

// --- Bot ------------------------------------------------------------------

export const BOT_NAMES = { easy: 'Easy Bot', medium: 'Medium Bot', hard: 'Hard Bot' };
const botIndex = () => local.get('wns.rbots', []);

// The same view the server would send, built from a local match document.
function viewOf(doc, seat) {
  const done = x => x?.done;
  const tot = [0, 1].map(s => doc.res[s].reduce((t, x) => t + (done(x) ? x.s : 0), 0));
  const over = doc.ff != null || doc.res.every(rs => rs.every(done));
  const v = {
    id: doc.id, ver: doc.ver, u: doc.u, me: seat, pl: doc.pl, tot, over,
    r: [0, 1, 2].map(r => [0, 1].map(s => {
      const x = doc.res[s][r];
      return x ? { s: done(x) ? x.s : null, n: done(x) ? x.w.length : null, done: !!done(x), st: s === seat && !done(x) ? x.st : undefined } : null;
    })),
    next: doc.res[seat].findIndex(x => !done(x)),
    level: doc.level,
  };
  if (over) v.win = doc.ff != null ? 1 - doc.ff : tot[0] === tot[1] ? 2 : tot[0] > tot[1] ? 0 : 1;
  return v;
}

export function listBotMatches() {
  return botIndex()
    .map(id => local.get('wns.rbot.' + id))
    .filter(Boolean)
    .map(doc => viewOf(doc, 0))
    .sort((a, b) => b.u - a.u);
}

export async function newBotMatch(level, name) {
  const dict = await loadDict();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const seed = id + Math.random();
  const doc = {
    id, level, seed, ver: 1, c: Date.now(), u: Date.now(),
    pl: [name || 'You', BOT_NAMES[level] || 'Bot'],
    b: [0, 1, 2].map(r => makeBoard(seed, r, dict)),
    res: [[null, null, null], [null, null, null]],
  };
  local.set('wns.rbot.' + id, doc);
  local.set('wns.rbots', [id, ...botIndex()].slice(0, 30));
  return id;
}

export class BotMatch extends Emitter {
  kind = 'bot';

  constructor(id) {
    super();
    this.id = id;
    this.base = '/rush/bot/' + id;
    this.doc = local.get('wns.rbot.' + id);
  }

  get view() {
    return this.doc ? viewOf(this.doc, 0) : null;
  }

  save() {
    this.doc.ver++;
    this.doc.u = Date.now();
    local.set('wns.rbot.' + this.id, this.doc);
    this.emit();
  }

  async refresh() {
    if (!this.doc) throw new ApiError(404, 'Match not found.');
  }

  async startRound(r) {
    const dict = await loadDict();
    const doc = this.doc, board = doc.b[r];
    const all = solve(board, dict);
    const valid = new Set(all.map(x => x.w));
    if (!doc.res[0][r]) {
      // The bot plays the same round alongside you.
      const bot = botRound(all, doc.level, rng(doc.seed + ':bot:' + r));
      doc.res[0][r] = { st: Date.now(), done: false, s: 0, w: [] };
      doc.res[1][r] = { st: Date.now(), done: false, s: bot.reduce((t, x) => t + x.s, 0), w: bot.map(x => x.w), bot };
      this.save();
    }
    return {
      board,
      isWord: w => valid.has(w),
      endsAt: doc.res[0][r].st + ROUND_SECONDS * 1000,
      ticker: { name: doc.pl[1], words: doc.res[1][r].bot },
    };
  }

  async submit(r, words) {
    const doc = this.doc;
    const x = doc.res[0][r];
    if (!x.done) {
      const all = solve(doc.b[r], await loadDict());
      const valid = new Set(all.map(y => y.w));
      const res = scoreWords(doc.b[r], words, w => valid.has(w));
      Object.assign(x, { done: true, s: res.total, w: res.words.map(y => y.w) });
      doc.res[1][r].done = true;
      this.save();
    }
    return this.recap(r);
  }

  async recap(r) {
    const doc = this.doc;
    const all = solve(doc.b[r], await loadDict());
    const score = new Map(all.map(x => [x.w, x.s]));
    const withScores = ws => ws.map(w => ({ w, s: score.get(w) || 0 }));
    const bot = doc.res[1][r];
    return { r, b: doc.b[r], s: doc.res[0][r].s, mine: withScores(doc.res[0][r].w), opp: { s: bot.s, w: withScores(bot.w) }, all };
  }

  async rematch() {
    return '/rush/bot/' + (await newBotMatch(this.doc.level, this.doc.pl[0]));
  }

  async remove() {
    local.del('wns.rbot.' + this.id);
    for (let r = 0; r < ROUNDS; r++) local.del(`wns.rp.${this.id}.${r}`);
    local.set('wns.rbots', botIndex().filter(x => x !== this.id));
  }

  close() {}
}

// --- Daily board ------------------------------------------------------------

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const dailyResult = (day = today()) => local.get('wns.daily.' + day);

// Consecutive days played, counting back from today (or yesterday).
export function dailyStreak() {
  let n = 0;
  const d = new Date();
  if (!dailyResult(today())) d.setDate(d.getDate() - 1);
  for (;;) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!dailyResult(key)) return n;
    n++;
    d.setDate(d.getDate() - 1);
  }
}

// Everyone gets the same board on the same day.
export class Daily {
  kind = 'daily';

  constructor(day = today()) {
    this.day = day;
    this.id = 'daily-' + day;
  }

  async start() {
    const dict = await loadDict();
    const board = makeBoard('daily:' + this.day, 2, dict, 80);
    const all = solve(board, dict);
    const valid = new Set(all.map(x => x.w));
    const key = 'wns.dailyStart.' + this.day;
    const st = local.get(key) || Date.now();
    local.set(key, st);
    return { board, all, isWord: w => valid.has(w), endsAt: st + ROUND_SECONDS * 1000 };
  }

  async submit(words) {
    const { board, all, isWord } = await this.start();
    const res = scoreWords(board, words, isWord);
    const result = { s: res.total, n: res.words.length, best: res.words.slice().sort((a, b) => b.s - a.s)[0]?.w || null, of: all.length, w: res.words.map(x => x.w) };
    local.set('wns.daily.' + this.day, result);
    return this.recap();
  }

  // Sends today's words to the shared leaderboard (the server re-scores
  // them) and returns everyone's scores. Needs a player name.
  async post() {
    const result = dailyResult(this.day);
    const { data } = await api('POST', 'daily/' + this.day, { w: result.w });
    local.set('wns.daily.' + this.day, { ...result, sent: true });
    local.set('wns.dailyTable.' + this.day, data);
    return data;
  }

  async scores() {
    const { data } = await api('GET', 'daily/' + this.day, null, { quiet: true });
    local.set('wns.dailyTable.' + this.day, data);
    return data;
  }

  cachedScores() {
    return local.get('wns.dailyTable.' + this.day);
  }

  async recap() {
    const { board, all } = await this.start();
    const result = dailyResult(this.day);
    const score = new Map(all.map(x => [x.w, x.s]));
    return { r: 0, b: board, s: result.s, mine: result.w.map(w => ({ w, s: score.get(w) || 0 })), opp: null, all };
  }
}
