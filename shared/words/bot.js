// Move generation (Appel & Jacobson, "The World's Fastest Scrabble Program")
// over the DAWG, scoring each move incrementally, plus a simple strategy on
// top for three difficulty levels.
import { N, CELLS, CENTER, RACK, variant } from './rules.js';
import { LETTER, END, LAST, SHIFT } from './dawg.js';

const ALL = (1 << 26) - 1;
const BLANK = 26;
const code = ch => (ch.charCodeAt(0) | 32) - 97; // works for upper and lower case

// Calls onMove(tiles, score) for every legal move. `board` is an array of 225
// cells ('' or letter), `rack` an array of letters / '?'.
export function generateMoves(v, board, rack, dawg, onMove) {
  const a = dawg.a;
  const vals = new Int16Array(26);
  for (let i = 0; i < 26; i++) vals[i] = v.values[String.fromCharCode(65 + i)] || 0;
  const cellVal = ch => (ch >= 'A' && ch <= 'Z' ? vals[ch.charCodeAt(0) - 65] : 0);
  const counts = new Int8Array(27);
  for (const ch of rack) counts[ch === '?' ? BLANK : code(ch)]++;
  const empty = !board.some(Boolean);
  const rackSize = rack.length;

  // Follows `word` (array of board chars) from list; returns edge index or -1.
  const follow = (list, chars) => {
    let e = -1;
    for (const ch of chars) {
      e = dawg.find(list, code(ch));
      if (e < 0) return -1;
      list = a[e] >>> SHIFT;
    }
    return e;
  };

  for (const horiz of [true, false]) {
    const pos = (r, c) => (horiz ? r * N + c : c * N + r);
    const crossMask = new Int32Array(CELLS);
    const crossSum = new Int16Array(CELLS);
    const anchor = new Uint8Array(CELLS);

    // Cross-checks: which letters may go in each empty cell given the tiles
    // above and below it (in this orientation), and what those tiles score.
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = pos(r, c);
        if (board[i]) continue;
        const above = [], below = [];
        for (let k = r - 1; k >= 0 && board[pos(k, c)]; k--) above.unshift(board[pos(k, c)]);
        for (let k = r + 1; k < N && board[pos(k, c)]; k++) below.push(board[pos(k, c)]);
        const hasSide = (c > 0 && board[pos(r, c - 1)]) || (c < N - 1 && board[pos(r, c + 1)]);
        anchor[i] = above.length || below.length || hasSide ? 1 : 0;
        if (!above.length && !below.length) {
          crossMask[i] = ALL;
          crossSum[i] = -1;
          continue;
        }
        let sum = 0;
        for (const ch of above) sum += cellVal(ch);
        for (const ch of below) sum += cellVal(ch);
        crossSum[i] = sum;
        let mask = 0;
        let list = a[0];
        if (above.length) {
          const e = follow(list, above);
          list = e < 0 ? 0 : a[e] >>> SHIFT;
        }
        if (list) {
          for (let j = list; ; j++) {
            const e = a[j];
            if (below.length) {
              const f = follow(e >>> SHIFT, below);
              if (f >= 0 && a[f] & END) mask |= 1 << (e & LETTER);
            } else if (e & END) mask |= 1 << (e & LETTER);
            if (e & LAST) break;
          }
        }
        crossMask[i] = mask;
      }
    }
    if (empty) {
      if (!horiz) break; // the board is symmetric; one direction is enough
      anchor[CENTER] = 1;
    }

    const placed = [];
    let row = 0, anchorCol = 0;

    const extend = (list, term, col, len, ms, mm, ct) => {
      const i = col < N ? pos(row, col) : -1;
      if (i >= 0 && board[i]) {
        const e = dawg.find(list, code(board[i]));
        if (e >= 0) extend(a[e] >>> SHIFT, (a[e] & END) !== 0, col + 1, len + 1, ms + cellVal(board[i]), mm, ct);
        return;
      }
      if (term && col > anchorCol && len > 1 && placed.length) {
        onMove(placed.slice(), ms * mm + ct + (placed.length === RACK ? v.bingo : 0));
      }
      if (i < 0 || !list) return;
      const mask = crossMask[i], lm = v.lm[i], wm = v.wm[i], cs = crossSum[i];
      for (let j = list; ; j++) {
        const e = a[j], L = e & LETTER;
        if (mask & (1 << L)) {
          const child = e >>> SHIFT, t = (e & END) !== 0;
          if (counts[L]) {
            const val = vals[L] * lm;
            counts[L]--;
            placed.push([i, String.fromCharCode(65 + L)]);
            extend(child, t, col + 1, len + 1, ms + val, mm * wm, cs >= 0 ? ct + (cs + val) * wm : ct);
            placed.pop();
            counts[L]++;
          }
          if (counts[BLANK]) {
            counts[BLANK]--;
            placed.push([i, String.fromCharCode(97 + L)]);
            extend(child, t, col + 1, len + 1, ms, mm * wm, cs >= 0 ? ct + cs * wm : ct);
            placed.pop();
            counts[BLANK]++;
          }
        }
        if (e & LAST) break;
      }
    };

    // Builds left parts of up to `limit` tiles in the empty cells left of the
    // anchor, then extends each one rightwards through the anchor.
    const left = (prefix, list, limit) => {
      const m = prefix.length;
      let ms = 0, mm = 1;
      for (let k = 0; k < m; k++) {
        const i = pos(row, anchorCol - m + k), ch = prefix[k];
        placed.push([i, ch]);
        ms += cellVal(ch) * v.lm[i];
        mm *= v.wm[i];
      }
      extend(list, false, anchorCol, m, ms, mm, 0);
      placed.length -= m;
      if (limit <= 0 || !list || m >= rackSize - 1) return;
      for (let j = list; ; j++) {
        const e = a[j], L = e & LETTER, child = e >>> SHIFT;
        if (child) {
          if (counts[L]) {
            counts[L]--;
            prefix.push(String.fromCharCode(65 + L));
            left(prefix, child, limit - 1);
            prefix.pop();
            counts[L]++;
          }
          if (counts[BLANK]) {
            counts[BLANK]--;
            prefix.push(String.fromCharCode(97 + L));
            left(prefix, child, limit - 1);
            prefix.pop();
            counts[BLANK]++;
          }
        }
        if (e & LAST) break;
      }
    };

    for (row = 0; row < N; row++) {
      for (let c = 0; c < N; c++) {
        const i = pos(row, c);
        if (!anchor[i] || board[i]) continue;
        anchorCol = c;
        if (c > 0 && board[pos(row, c - 1)]) {
          // Existing tiles to the left are a fixed prefix.
          let k = c - 1;
          while (k > 0 && board[pos(row, k - 1)]) k--;
          const chars = [];
          let ms = 0;
          for (let j = k; j < c; j++) {
            chars.push(board[pos(row, j)]);
            ms += cellVal(board[pos(row, j)]);
          }
          const e = follow(a[0], chars);
          if (e >= 0) extend(a[e] >>> SHIFT, (a[e] & END) !== 0, c, chars.length, ms, 1, 0);
        } else {
          let limit = 0;
          for (let k = c - 1; k >= 0 && !board[pos(row, k)] && !anchor[pos(row, k)]; k--) limit++;
          left([], a[0], limit);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Strategy

const LEAVE = {
  '?': 24, S: 8, E: 3, Z: 2, X: 2, R: 2, A: 1, N: 1, T: 1, L: 1, H: 1, D: 1, C: 0, I: 0, M: 0, O: -1,
  P: -1, Y: -1, G: -2, B: -2, F: -2, K: -2, U: -3, W: -3, J: -3, V: -5, Q: -7,
};
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

export function leaveValue(leave) {
  let s = 0, vow = 0, con = 0;
  const seen = {};
  for (const ch of leave) {
    s += LEAVE[ch] ?? 0;
    if (seen[ch]) s -= 4;
    seen[ch] = 1;
    if (VOWELS.has(ch)) vow++;
    else if (ch !== '?') con++;
  }
  if (seen.Q && !seen.U) s -= 6;
  s -= 3 * Math.max(0, Math.abs(vow - con) - 1);
  return s;
}

const minus = (rack, tiles) => {
  const left = [...rack];
  for (const [, ch] of tiles) {
    const k = left.indexOf(ch >= 'a' ? '?' : ch);
    if (k >= 0) left.splice(k, 1);
  }
  return left;
};

// Picks a move for the bot. Returns { k: 'play', tiles } | { k: 'swap', tiles } | { k: 'pass' }.
// level: 'easy' | 'medium' | 'hard'. rand() returns [0, 1).
export function chooseMove({ variantId, board, rack, bagCount, dawg, level = 'medium', rand = Math.random }) {
  const v = variant(variantId);
  const useLeave = bagCount > 0;
  let best = null, bestVal = -Infinity, maxScore = 0;
  // For easy/medium keep one random move per score (reservoir sampling).
  const byScore = new Map();
  generateMoves(v, board, rack, dawg, (tiles, score) => {
    if (score > maxScore) maxScore = score;
    if (level === 'hard') {
      const val = score + (useLeave ? leaveValue(minus(rack, tiles)) : tiles.length * 2);
      if (val > bestVal) { bestVal = val; best = { tiles, score }; }
    } else {
      const b = byScore.get(score);
      if (!b) byScore.set(score, { n: 1, tiles });
      else if (rand() * ++b.n < 1) b.tiles = tiles;
    }
  });

  if (level !== 'hard' && byScore.size) {
    const [lo, hi] = level === 'easy' ? [0.3, 0.55] : [0.6, 0.85];
    const target = maxScore * (lo + (hi - lo) * rand());
    let pick = null, gap = Infinity;
    for (const [score, b] of byScore) {
      const d = Math.abs(score - target);
      if (d < gap || (d === gap && rand() < 0.5)) { gap = d; pick = { tiles: b.tiles, score }; }
    }
    best = pick;
  }

  if (best) return { k: 'play', tiles: best.tiles, score: best.score };
  // Nothing to play: swap the worst tiles if the bag allows it, else pass.
  if (bagCount >= Math.max(v.swapMin, 1)) {
    const ranked = [...rack].sort((x, y) => (LEAVE[x] ?? 0) - (LEAVE[y] ?? 0));
    const n = Math.min(bagCount, Math.max(1, rack.length - 2));
    return { k: 'swap', tiles: ranked.slice(0, n) };
  }
  return { k: 'pass' };
}
