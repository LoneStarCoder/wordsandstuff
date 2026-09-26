// A game "source" gives the game screen a view of the game and a way to make
// moves. OnlineSource talks to the server; BotSource runs everything locally.
// Both expose the same view shape the server sends (see server/words.js).
/* global BOT_URL */
import { api, live, me, ApiError } from '../net.js';
import { local } from '../dom.js';
import * as G from '../../../shared/words/game.js';
import { loadDict } from './dict.js';

class Emitter {
  listeners = new Set();
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(info) {
    this.listeners.forEach(fn => fn(info));
  }
}

// Applies a move delta from the server. Returns false if we missed something.
export function applyDelta(view, d) {
  if (d.ver <= view.ver) return true;
  if (d.ver !== view.ver + 1) return false;
  view.m.push(d.mv);
  if (d.mv.k === 'play') {
    const b = [...view.b];
    for (const [i, ch] of d.mv.t) b[i] = ch;
    view.b = b.join('');
  }
  for (const k of ['ver', 'u', 's', 'bag', 'turn', 'over', 'win', 'end', 'rr', 'r']) if (k in d) view[k] = d[k];
  return true;
}

// --- Online ---------------------------------------------------------------

export class OnlineSource extends Emitter {
  kind = 'online';

  constructor(id) {
    super();
    this.id = id;
    const cached = local.get('wns.g.' + id);
    this.view = cached?.view || null;
    this.etag = cached?.etag || null;
    this.off = live.on(msg => this.onLive(msg));
    live.connect();
  }

  save() {
    local.set('wns.g.' + this.id, { view: this.view, etag: this.etag });
  }

  // Matches the server's ETag for this version of the game, so reopening a
  // game we kept up to date over the socket costs a 304 instead of a download.
  tag() {
    return `"${this.view.ver}.${this.view.me}"`;
  }

  async refresh() {
    try {
      const res = await api('GET', 'games/' + this.id, null, { etag: this.view && this.etag, quiet: !!this.view });
      if (res.status === 304) return;
      this.view = res.data;
      this.etag = res.etag;
      this.save();
      this.emit({ kind: 'load' });
    } catch (e) {
      if (!this.view || e.status === 404) throw e;
    }
  }

  onLive(msg) {
    if (msg.t === 'resync') return this.refresh().catch(() => {});
    if (msg.id !== this.id || !this.view) return;
    if (msg.t === 'mv') {
      const mine = msg.d.mv.p === this.view.me;
      if (!applyDelta(this.view, msg.d)) return this.refresh().catch(() => {});
      this.etag = this.tag();
      this.save();
      this.emit({ kind: 'move', move: msg.d.mv, mine });
    } else if (msg.t === 'chat') {
      if (msg.ver <= this.view.ver) return;
      if (msg.ver !== this.view.ver + 1) return this.refresh().catch(() => {});
      this.view.chat.push(msg.c);
      this.view.ver = msg.ver;
      this.etag = this.tag();
      this.save();
      this.emit({ kind: 'chat', chat: msg.c });
    } else if (msg.t === 'join') {
      this.refresh().catch(() => {});
    }
  }

  async submit(move) {
    try {
      const { data } = await api('POST', `games/${this.id}/move`, move);
      if (!applyDelta(this.view, data)) await this.refresh();
      this.etag = this.tag();
      this.save();
      this.emit({ kind: 'move', move: data.mv, mine: true });
      return { ok: true, move: data.mv };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, error: e.message, bad: e.data?.bad };
      throw e;
    }
  }

  async chat(text) {
    const { data } = await api('POST', `games/${this.id}/chat`, { m: text });
    if (data.ver === this.view.ver + 1) {
      this.view.chat.push(data.c);
      this.view.ver = data.ver;
      this.etag = this.tag();
      this.save();
      this.emit({ kind: 'chat', chat: data.c });
    } else await this.refresh();
  }

  async rematch() {
    const { data } = await api('POST', 'games', { rematch: this.id });
    local.set('wns.g.' + data.id, { view: data, etag: null });
    return data.id;
  }

  close() {
    this.off();
  }
}

// --- Bot ------------------------------------------------------------------

export const BOT_NAMES = { easy: 'Easy Bot', medium: 'Medium Bot', hard: 'Hard Bot' };

const botIndex = () => local.get('wns.bots', []);

export function listBotGames() {
  return botIndex()
    .map(id => local.get('wns.bot.' + id))
    .filter(Boolean)
    .sort((a, b) => b.u - a.u);
}

export function newBotGame(variantId, level) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const st = G.createState(variantId, n => Math.floor(Math.random() * n));
  const game = { id, level, st, c: Date.now(), u: Date.now() };
  local.set('wns.bot.' + id, game);
  local.set('wns.bots', [id, ...botIndex()].slice(0, 30));
  return id;
}

export function deleteBotGame(id) {
  local.del('wns.bot.' + id);
  local.set('wns.bots', botIndex().filter(x => x !== id));
}

// sessionStorage that never throws (it can be disabled).
function session(k, v) {
  try {
    if (v === undefined) return sessionStorage.getItem(k);
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {}
  return null;
}

let worker = null, seq = 0;
const waiting = new Map();
function askBot(req) {
  if (!worker) {
    worker = new Worker(BOT_URL);
    // A new version was deployed while this page was open and the old bot
    // file is gone: fail every pending request so the page can reload.
    worker.onerror = () => {
      waiting.forEach(w => w.reject(new Error('bot unavailable')));
      waiting.clear();
      worker = null;
    };
    worker.onmessage = e => {
      const w = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (e.data.error) w?.reject(new Error(e.data.error));
      else w?.resolve(e.data.move);
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, req });
  });
}

export class BotSource extends Emitter {
  kind = 'bot';

  constructor(id) {
    super();
    this.id = id;
    this.game = local.get('wns.bot.' + id);
    this.thinking = false;
  }

  get view() {
    const g = this.game, st = g?.st;
    if (!st) return null;
    return {
      id: g.id, v: st.v, me: 0, ver: st.m.length,
      pl: [me.name || 'You', BOT_NAMES[g.level] || 'Bot'],
      b: st.b, r: st.r[0], bag: st.bag.length, s: st.s, turn: st.turn, m: st.m,
      over: st.over, win: st.win, end: st.end, rr: st.over ? st.r : undefined, chat: [],
      level: g.level,
    };
  }

  save() {
    this.game.u = Date.now();
    local.set('wns.bot.' + this.id, this.game);
  }

  async refresh() {
    if (!this.game) throw new ApiError(404, 'Game not found.');
    await loadDict();
    if (!this.game.st.over && this.game.st.turn === 1) this.botTurn();
  }

  async submit(move) {
    const st = this.game.st;
    const rand = n => Math.floor(Math.random() * n);
    let res;
    if (move.k === 'play') res = G.play(st, 0, move.t, await loadDict());
    else if (move.k === 'swap') res = G.swap(st, 0, move.t, rand);
    else if (move.k === 'pass') res = G.pass(st, 0);
    else if (move.k === 'resign') res = G.resign(st, 0);
    if (!res.ok) return res;
    this.save();
    this.emit({ kind: 'move', move: res.move, mine: true });
    if (!st.over) this.botTurn();
    return res;
  }

  async botTurn() {
    if (this.thinking) return;
    this.thinking = true;
    this.emit({ kind: 'thinking' });
    const st = this.game.st;
    const started = Date.now();
    let mv;
    try {
      mv = await askBot({ variantId: st.v, board: G.boardArray(st.b), rack: [...st.r[1]], bagCount: st.bag.length, level: this.game.level });
    } catch {
      // Reload once to pick up the current version; the bot resumes its turn.
      if (!session('wns.botReload')) {
        session('wns.botReload', '1');
        return location.reload();
      }
      mv = { k: 'pass' };
    }
    session('wns.botReload', null);
    // Take a moment, like a person would.
    await new Promise(r => setTimeout(r, Math.max(0, 700 + Math.random() * 600 - (Date.now() - started))));
    const rand = n => Math.floor(Math.random() * n);
    let res = { ok: false };
    if (mv.k === 'play') res = G.play(st, 1, mv.tiles, await loadDict());
    else if (mv.k === 'swap') res = G.swap(st, 1, mv.tiles, rand);
    if (!res.ok) res = G.pass(st, 1);
    this.thinking = false;
    this.save();
    this.emit({ kind: 'move', move: res.move, mine: false });
  }

  async rematch() {
    return newBotGame(this.game.st.v, this.game.level);
  }

  remove() {
    deleteBotGame(this.id);
  }

  close() {}
}
