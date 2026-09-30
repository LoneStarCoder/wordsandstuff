// Word Rush: a 4×4 grid of letters. Trace words through touching tiles
// (including diagonals), each tile at most once per word. Shared by the
// server and the browser.
import { SHIFT, END } from '../dict/dawg.js';

export const SIZE = 4, CELLS = 16, ROUNDS = 3, ROUND_SECONDS = 90, MIN_LEN = 3;

// The classic 16 letter cubes. "Q" shows as "Qu" and spells QU.
const DICE = ['AAEEGN', 'ABBJOO', 'ACHOPS', 'AFFKPS', 'AOOTTW', 'CIMOTU', 'DEILRX', 'DELRVY', 'DISTTY', 'EEGHNW', 'EEINSU', 'EHRTVW', 'EIOSST', 'ELRTTY', 'HIMNQU', 'HLNNRZ'];

export const VALUES = { A: 1, B: 4, C: 4, D: 2, E: 1, F: 4, G: 3, H: 3, I: 1, J: 10, K: 5, L: 2, M: 4, N: 2, O: 1, P: 4, Q: 10, R: 1, S: 1, T: 1, U: 2, V: 5, W: 4, X: 8, Y: 3, Z: 10 };

// Extra points for long words, by length.
export const lengthBonus = len => (len >= 8 ? 25 : len === 7 ? 15 : len === 6 ? 10 : len === 5 ? 5 : 0);

// Tile text as spelled in words.
export const spell = ch => (ch === 'Q' ? 'QU' : ch);

// Neighbours of each cell (8 directions).
export const NEIGHBORS = Array.from({ length: CELLS }, (_, i) => {
  const r = Math.floor(i / SIZE), c = i % SIZE, out = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) out.push(rr * SIZE + cc);
    }
  return out;
});

// Small seeded PRNG (mulberry32) so a seed always gives the same board.
export function rng(seed) {
  let s = typeof seed === 'string' ? hash32(seed) : seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a, 32 bit.
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// A round's board: 16 letters plus bonus tiles. The last round has a
// triple-word tile instead of a double.
// { l: 'ABCD…' (16 chars), dl, tl, dw | tw: cell index }
export function makeBoard(seed, round = 0, dict = null, minWords = 60) {
  const rand = rng(seed + ':' + round);
  for (let attempt = 0; ; attempt++) {
    const dice = [...DICE];
    for (let i = dice.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [dice[i], dice[j]] = [dice[j], dice[i]];
    }
    const l = dice.map(d => d[Math.floor(rand() * 6)]).join('');
    const cells = [...Array(CELLS).keys()];
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const board = { l, dl: cells[0], tl: cells[1] };
    board[round === ROUNDS - 1 ? 'tw' : 'dw'] = cells[2];
    // Reroll boards with too few words: they aren't fun.
    if (!dict || attempt > 30 || solve(board, dict).length >= minWords) return board;
  }
}

function pathScore(board, path) {
  let sum = 0, mult = 1;
  for (const i of path) {
    const v = VALUES[board.l[i]];
    sum += i === board.dl ? v * 2 : i === board.tl ? v * 3 : v;
    if (i === board.dw) mult *= 2;
    if (i === board.tw) mult *= 3;
  }
  return sum * mult;
}

// All paths that spell `word` on the board.
export function pathsFor(board, word) {
  word = word.toUpperCase();
  const out = [];
  const used = new Array(CELLS).fill(false);
  const go = (i, pos, path) => {
    const piece = spell(board.l[i]);
    if (!word.startsWith(piece, pos)) return;
    const next = pos + piece.length;
    used[i] = true;
    path.push(i);
    if (next === word.length) out.push([...path]);
    else for (const n of NEIGHBORS[i]) if (!used[n]) go(n, next, path);
    path.pop();
    used[i] = false;
  };
  for (let i = 0; i < CELLS; i++) go(i, 0, []);
  return out;
}

// Points for a word: the best path wins, plus the length bonus.
export function scoreWord(board, word) {
  const paths = pathsFor(board, word);
  if (!paths.length) return 0;
  return Math.max(...paths.map(p => pathScore(board, p))) + lengthBonus(word.length);
}

// Every dictionary word on the board: [{ w, s }] sorted best first.
export function solve(board, dict) {
  const a = dict.a, found = new Set();
  const used = new Array(CELLS).fill(false);
  const step = (list, ch) => {
    const e = dict.find(list, ch.charCodeAt(0) - 65);
    return e;
  };
  const go = (i, list, word) => {
    let e = -1;
    for (const ch of spell(board.l[i])) {
      e = step(list, ch);
      if (e < 0) return;
      list = a[e] >>> SHIFT;
      word += ch;
    }
    if (word.length >= MIN_LEN && a[e] & END) found.add(word);
    if (!list) return;
    used[i] = true;
    for (const n of NEIGHBORS[i]) if (!used[n]) go(n, list, word);
    used[i] = false;
  };
  for (let i = 0; i < CELLS; i++) go(i, a[0], '');
  return [...found].map(w => ({ w, s: scoreWord(board, w) })).sort((x, y) => y.s - x.s || (x.w < y.w ? -1 : 1));
}

// Words are shared with the browser as salted hashes, so the answers aren't
// sitting in the page. Returns base64 of little-endian uint32s.
export function hashWords(words, salt) {
  const arr = new Uint32Array(words.map(w => hash32(salt + w)));
  const bytes = new Uint8Array(arr.buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function hashSet(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Set(new Uint32Array(bytes.buffer));
}

// Total for a list of found words (duplicates and junk ignored).
export function scoreWords(board, words, valid) {
  let total = 0;
  const seen = new Set(), out = [];
  for (let w of words) {
    w = String(w).toUpperCase();
    if (seen.has(w) || !valid(w)) continue;
    seen.add(w);
    const s = scoreWord(board, w);
    if (!s) continue;
    out.push({ w, s });
    total += s;
  }
  return { total, words: out };
}

// Bot: finds a share of the board's words over the round, like a person.
// Returns [{ w, s, t }] with t = seconds into the round.
const BOT = { easy: { n: [8, 12], maxLen: 4 }, medium: { n: [15, 22], maxLen: 6 }, hard: { n: [26, 36], maxLen: 16 } };
export function botRound(all, level, rand) {
  const cfg = BOT[level] || BOT.medium;
  const pool = all.filter(x => x.w.length <= cfg.maxLen);
  const n = Math.min(pool.length, cfg.n[0] + Math.floor(rand() * (cfg.n[1] - cfg.n[0] + 1)));
  // Favour shorter, easier-to-spot words, with some luck.
  const ranked = pool.map(x => ({ ...x, k: rand() * 3 + x.w.length * (level === 'hard' ? 0.2 : 0.6) })).sort((x, y) => x.k - y.k);
  return ranked
    .slice(0, n)
    .map(({ w, s }) => ({ w, s, t: Math.round(2 + rand() ** 1.4 * (ROUND_SECONDS - 5)) }))
    .sort((x, y) => x.t - y.t);
}
