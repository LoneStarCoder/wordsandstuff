// Rules for the crossword tile game, shared by the server, the browser and
// the bot. The board is an array of 225 cells: '' when empty, an uppercase
// letter for a normal tile, a lowercase letter for a blank played as that
// letter. Racks hold uppercase letters and '?' for blanks.

export const N = 15, CELLS = N * N, CENTER = 7 * N + 7, RACK = 7;

const half = rows => [...rows, ...rows.slice(0, 7).reverse()];

// Premium squares: d = double letter, t = triple letter, D = double word,
// T = triple word, * = start square.
export const VARIANTS = {
  modern: {
    name: 'Modern',
    blurb: 'Casual layout · 104 tiles · 35 pt bingo',
    layout: half([
      '...T..t.t..T...',
      '..d..D...D..d..',
      '.d..d.....d..d.',
      'T..t...D...t..T',
      '..d...d.d...d..',
      '.D...t...t...D.',
      't...d.....d...t',
      '...D...*...D...',
    ]).join(''),
    centerWord: 1,
    bingo: 35,
    swapMin: 1,
    maxScoreless: 6,
    tiles: 'A9:1 B2:4 C2:4 D5:2 E13:1 F2:4 G3:3 H4:3 I8:1 J1:10 K1:5 L4:2 M2:4 N5:2 O8:1 P2:4 Q1:10 R6:1 S5:1 T7:1 U4:2 V2:5 W2:4 X1:8 Y2:3 Z1:10 ?2:0',
  },
  classic: {
    name: 'Classic',
    blurb: 'Traditional layout · 100 tiles · 50 pt bingo',
    layout: half([
      'T..d...T...d..T',
      '.D...t...t...D.',
      '..D...d.d...D..',
      'd..D...d...D..d',
      '....D.....D....',
      '.t...t...t...t.',
      '..d...d.d...d..',
      'T..d...*...d..T',
    ]).join(''),
    centerWord: 2,
    bingo: 50,
    swapMin: 7,
    maxScoreless: 6,
    tiles: 'A9:1 B2:3 C2:3 D4:2 E12:1 F2:4 G3:2 H2:4 I9:1 J1:8 K1:5 L4:1 M2:3 N6:1 O8:1 P2:3 Q1:10 R6:1 S4:1 T6:1 U4:1 V2:4 W2:4 X1:8 Y2:4 Z1:10 ?2:0',
  },
};

for (const v of Object.values(VARIANTS)) {
  v.values = {};
  v.counts = {};
  for (const t of v.tiles.split(' ')) {
    const [, ch, count, val] = t.match(/^(.)(\d+):(\d+)$/);
    v.values[ch] = +val;
    v.counts[ch] = +count;
  }
  v.total = Object.values(v.counts).reduce((a, b) => a + b, 0);
  // Per-cell multipliers, precomputed for scoring.
  v.lm = new Uint8Array(CELLS);
  v.wm = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const p = v.layout[i];
    v.lm[i] = p === 'd' ? 2 : p === 't' ? 3 : 1;
    v.wm[i] = p === 'D' ? 2 : p === 'T' ? 3 : p === '*' ? v.centerWord : 1;
  }
}

export const variant = id => VARIANTS[id] || VARIANTS.modern;

// Point value of a board cell or rack tile (blanks are worth nothing).
export const tileValue = (v, ch) => (ch && ch >= 'A' && ch <= 'Z' ? v.values[ch] : 0);

export const rackValue = (v, rack) => rack.reduce((s, ch) => s + tileValue(v, ch), 0);

export function newBag(v, rand) {
  const bag = [];
  for (const [ch, n] of Object.entries(v.counts)) for (let i = 0; i < n; i++) bag.push(ch);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

const isLetter = ch => typeof ch === 'string' && /^[A-Za-z]$/.test(ch);

// Checks the geometry of a move and scores it. `tiles` is [[cellIndex, ch], …]
// with ch uppercase, or lowercase for a blank. Dictionary checks are separate.
// Returns { ok, error } or { ok: true, words: [{ w, s, cells }], score, bingo }.
export function analyzeMove(v, board, tiles) {
  if (!Array.isArray(tiles) || !tiles.length) return { ok: false, error: 'Place some tiles first.' };
  if (tiles.length > RACK) return { ok: false, error: 'Too many tiles.' };
  const placed = new Map();
  for (const t of tiles) {
    if (!Array.isArray(t)) return { ok: false, error: 'Bad move.' };
    const [i, ch] = t;
    if (!Number.isInteger(i) || i < 0 || i >= CELLS || !isLetter(ch)) return { ok: false, error: 'Bad move.' };
    if (board[i] || placed.has(i)) return { ok: false, error: 'That square is taken.' };
    placed.set(i, ch);
  }
  const at = i => placed.get(i) || board[i];
  const idx = [...placed.keys()].sort((a, b) => a - b);
  const rows = new Set(idx.map(i => Math.floor(i / N)));
  const cols = new Set(idx.map(i => i % N));
  if (rows.size > 1 && cols.size > 1) return { ok: false, error: 'Tiles must be in one row or column.' };

  const firstMove = !board.some(Boolean);
  let step;
  if (idx.length > 1) step = rows.size === 1 ? 1 : N;
  else {
    const i = idx[0], c = i % N;
    const horiz = (c > 0 && board[i - 1]) || (c < N - 1 && board[i + 1]);
    step = horiz ? 1 : N;
  }

  // All cells between the first and last placed tile must be filled.
  for (let i = idx[0]; i <= idx[idx.length - 1]; i += step) {
    if (!at(i)) return { ok: false, error: 'Tiles must form a single word with no gaps.' };
  }

  if (firstMove) {
    if (!placed.has(CENTER)) return { ok: false, error: 'The first word must cover the center star.' };
    if (tiles.length < 2) return { ok: false, error: 'The first word needs at least two letters.' };
  }

  const words = [];
  const wordAt = (i, s) => {
    // Walk back to the start of the word through cell i in direction s.
    const sameLine = (a, b) => (s === 1 ? Math.floor(a / N) === Math.floor(b / N) : true);
    let start = i;
    while (start - s >= 0 && sameLine(start - s, start) && at(start - s)) start -= s;
    const cells = [];
    for (let j = start; j < CELLS && sameLine(j, start) && at(j); j += s) cells.push(j);
    return cells;
  };
  const score = cells => {
    let sum = 0, mult = 1;
    for (const j of cells) {
      const ch = at(j);
      if (placed.has(j)) {
        sum += tileValue(v, ch) * v.lm[j];
        mult *= v.wm[j];
      } else sum += tileValue(v, ch);
    }
    return sum * mult;
  };
  const text = cells => cells.map(j => at(j).toUpperCase()).join('');

  const main = wordAt(idx[0], step);
  if (main.length > 1) words.push(main);
  const cross = step === 1 ? N : 1;
  for (const i of idx) {
    const w = wordAt(i, cross);
    if (w.length > 1) words.push(w);
  }
  if (!words.length) return { ok: false, error: 'Your word must connect to tiles on the board.' };

  if (!firstMove) {
    const touches = words.some(cells => cells.some(j => !placed.has(j)));
    if (!touches) return { ok: false, error: 'Your word must connect to tiles on the board.' };
  }

  const out = words.map(cells => ({ w: text(cells), s: score(cells), cells }));
  const bingo = tiles.length === RACK ? v.bingo : 0;
  return { ok: true, words: out, score: out.reduce((s, w) => s + w.s, 0) + bingo, bingo };
}

// Removes the tiles used by a move from a rack. Returns the new rack, or null
// if the rack does not hold them. Lowercase letters consume a blank.
export function takeFromRack(rack, letters) {
  const left = [...rack];
  for (const ch of letters) {
    const want = ch >= 'a' && ch <= 'z' ? '?' : ch;
    const k = left.indexOf(want);
    if (k < 0) return null;
    left.splice(k, 1);
  }
  return left;
}
