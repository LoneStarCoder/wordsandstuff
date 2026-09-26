import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS, analyzeMove, N, CENTER, takeFromRack } from '../shared/words/rules.js';
import { createState, play, pass, swap, resign, boardArray } from '../shared/words/game.js';
import { fullDict, seeded } from './helpers.js';

const empty = () => Array(225).fill('');
const at = (r, c) => r * N + c;
const word = (r, c, text, vert = false) => [...text].map((ch, k) => [vert ? at(r + k, c) : at(r, c + k), ch]);

test('tile sets add up', () => {
  assert.equal(VARIANTS.modern.total, 104);
  assert.equal(VARIANTS.classic.total, 100);
  for (const v of Object.values(VARIANTS)) {
    assert.equal(v.layout.length, 225);
    // Layouts are symmetric in both axes and the diagonal.
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      assert.equal(v.layout[at(r, c)], v.layout[at(c, r)]);
      assert.equal(v.layout[at(r, c)], v.layout[at(N - 1 - r, c)]);
    }
  }
});

test('first move scoring and rules', () => {
  const b = empty();
  const classic = VARIANTS.classic, modern = VARIANTS.modern;
  // CAT across the center: classic center is a double word.
  assert.equal(analyzeMove(classic, b, word(7, 6, 'CAT')).score, 10);
  assert.equal(analyzeMove(modern, b, word(7, 6, 'CAT')).score, 6);
  assert.match(analyzeMove(classic, b, word(6, 6, 'CAT')).error, /center/);
  assert.match(analyzeMove(classic, b, [[CENTER, 'A']]).error, /two letters/);
  assert.match(analyzeMove(classic, b, [[at(7, 6), 'C'], [at(7, 8), 'T']]).error, /gaps/);
  assert.match(analyzeMove(classic, b, [[at(7, 7), 'C'], [at(8, 8), 'T']]).error, /one row/);
  // Blank scores zero.
  assert.equal(analyzeMove(classic, b, [[at(7, 6), 'c'], [at(7, 7), 'A'], [at(7, 8), 'T']]).score, 4);
});

test('cross words, premiums and bingo', () => {
  const v = VARIANTS.classic;
  const b = empty();
  for (const [i, ch] of word(7, 6, 'CAT')) b[i] = ch;
  // S under the T makes a vertical word "TS"? no - place "AT" down from A: A(7,7) T(8,7) → "AT"
  let r = analyzeMove(v, b, [[at(8, 7), 'T']]);
  assert.ok(r.ok);
  assert.deepEqual(r.words.map(w => w.w), ['AT']);
  // Hook: S after CAT → CATS (7,9 has no premium) = 3+1+1+1
  r = analyzeMove(v, b, [[at(7, 9), 'S']]);
  assert.deepEqual(r.words.map(w => [w.w, w.s]), [['CATS', 6]]);
  // Parallel play forming two words: "TO" under "AT" → cells (8,7)=O? build: place O at (8,8) under T → "TO" vertical + nothing across
  r = analyzeMove(v, b, [[at(8, 8), 'O'], [at(8, 9), 'X']]);
  assert.ok(r.ok);
  assert.deepEqual(r.words.map(w => w.w).sort(), ['OX', 'TO']);
  // Disconnected move is rejected.
  assert.match(analyzeMove(v, b, word(0, 0, 'DOG')).error, /connect/);
  // Bingo bonus for 7 tiles.
  const bingo = analyzeMove(v, empty(), word(7, 4, 'READING'));
  assert.equal(bingo.bingo, 50);
  // R E A D I N G at cols 4..10; premiums in row 7: col 7 '*' (x2 word), col 3/11 'd' not covered.
  assert.equal(bingo.score, (1 + 1 + 1 + 2 + 1 + 1 + 2) * 2 + 50);
});

test('takeFromRack handles blanks', () => {
  assert.deepEqual(takeFromRack(['A', '?', 'B'], ['A', 'z']), ['B']);
  assert.equal(takeFromRack(['A', 'B'], ['C']), null);
});

test('game flow: play, swap, pass, end by passes, resign', () => {
  const dict = fullDict();
  const rand = seeded(1);
  const ri = n => Math.floor(rand() * n);
  const st = createState('classic', ri);
  assert.equal(st.r[0].length, 7);
  assert.equal(st.bag.length, 86);
  // Force a known rack.
  st.r[0] = 'CATSXYZ';
  assert.match(play(st, 1, word(7, 6, 'CAT'), dict).error, /not your turn/);
  assert.match(play(st, 0, word(7, 6, 'CAZ'), dict).error, /word list/);
  assert.match(play(st, 0, word(7, 6, 'DOG'), dict).error, /rack/);
  const res = play(st, 0, word(7, 6, 'CAT'), dict);
  assert.ok(res.ok);
  assert.equal(st.s[0], 10);
  assert.equal(st.r[0].length, 7);
  assert.equal(st.turn, 1);
  assert.equal(boardArray(st.b)[CENTER], 'A');
  const before = st.r[1];
  assert.ok(swap(st, 1, [...before.slice(0, 3)], ri).ok);
  assert.equal(st.r[1].length, 7);
  assert.equal(st.bag.length, 86 - 3);
  for (let k = 0; k < 5; k++) assert.ok(pass(st, st.turn).ok, 'pass ' + k);
  assert.ok(st.over);
  assert.equal(st.end.why, 'passes');

  const st2 = createState('modern', ri);
  assert.ok(resign(st2, 0).ok);
  assert.equal(st2.win, 1);
});
