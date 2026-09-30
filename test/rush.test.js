import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, solve, pathsFor, scoreWord, lengthBonus, hashWords, hashSet, hash32, scoreWords, botRound, rng, NEIGHBORS } from '../shared/rush/board.js';
import { fullDict, words } from './helpers.js';

const board = (rows, extra = {}) => ({ l: rows.join(''), dl: -1, tl: -1, dw: -1, ...extra });

test('neighbours include diagonals', () => {
  assert.deepEqual(NEIGHBORS[0], [1, 4, 5]);
  assert.equal(NEIGHBORS[5].length, 8);
});

test('paths follow touching tiles and use each tile once', () => {
  const b = board(['CATS', 'XXXX', 'XXXX', 'XXXX']);
  assert.equal(pathsFor(b, 'CAT').length, 1);
  assert.equal(pathsFor(b, 'CATC').length, 0, 'no reuse');
  assert.equal(pathsFor(b, 'CTA').length, 0, 'C and T do not touch');
  // Q tile spells QU.
  const q = board(['QIXX', 'XXXX', 'XXXX', 'XXXX']);
  assert.equal(pathsFor(q, 'QUI').length, 1);
  assert.equal(pathsFor(q, 'QI').length, 0);
});

test('scoring: letters, bonus tiles and length bonus', () => {
  // C4 A1 T1 = 6
  assert.equal(scoreWord(board(['CATS', 'XXXX', 'XXXX', 'XXXX']), 'CAT'), 6);
  assert.equal(scoreWord(board(['CATS', 'XXXX', 'XXXX', 'XXXX'], { dl: 0 }), 'CAT'), 10);
  assert.equal(scoreWord(board(['CATS', 'XXXX', 'XXXX', 'XXXX'], { tl: 0 }), 'CAT'), 14);
  assert.equal(scoreWord(board(['CATS', 'XXXX', 'XXXX', 'XXXX'], { dw: 2 }), 'CAT'), 12);
  assert.equal(scoreWord(board(['CATS', 'XXXX', 'XXXX', 'XXXX'], { tw: 2 }), 'CAT'), 18);
  assert.equal(scoreWord(board(['CATS', 'XXXX', 'XXXX', 'XXXX']), 'DOG'), 0);
  assert.equal(lengthBonus(4), 0);
  assert.equal(lengthBonus(5), 5);
  assert.equal(lengthBonus(9), 25);
});

test('boards are deterministic, full of words, and the last round has a triple', () => {
  const d = fullDict();
  const a = makeBoard('abc', 0, d), b = makeBoard('abc', 0, d);
  assert.deepEqual(a, b);
  assert.notDeepEqual(makeBoard('abc', 1, d), a);
  assert.ok('tw' in makeBoard('abc', 2, d) && !('dw' in makeBoard('abc', 2, d)));
  for (let i = 0; i < 20; i++) assert.ok(solve(makeBoard('s' + i, 0, d), d).length >= 60);
});

test('solver finds exactly the dictionary words that can be traced', () => {
  const d = fullDict();
  const b = makeBoard('solver', 0, d);
  const all = solve(b, d);
  for (const { w, s } of all) {
    assert.ok(d.has(w), w);
    assert.ok(pathsFor(b, w).length, w);
    assert.equal(s, scoreWord(b, w));
    assert.ok(w.length >= 3);
  }
  // Brute force: every 3–5 letter dictionary word that can be traced is found.
  const found = new Set(all.map(x => x.w));
  for (const w of ['CAT', 'DOG', 'TEAS', 'NOTE', 'RATE', 'STONE']) if (pathsFor(b, w).length && d.has(w)) assert.ok(found.has(w), w);
  // Brute force over the whole word list: anything traceable must be found.
  for (const w of words()) if (w.length >= 3 && w.length <= 8 && pathsFor(b, w).length) assert.ok(found.has(w), 'missed ' + w);
});

test('hashed word lists match only real answers', () => {
  const set = hashSet(hashWords(['CAT', 'DOG'], 'g1:0:'));
  assert.ok(set.has(hash32('g1:0:CAT')));
  assert.ok(!set.has(hash32('g1:0:COW')));
  assert.ok(!set.has(hash32('g2:0:CAT')), 'salted per game');
});

test('scoreWords ignores duplicates and invalid words', () => {
  const b = board(['CATS', 'XXXX', 'XXXX', 'XXXX']);
  const valid = w => ['CAT', 'CATS', 'SAT'].includes(w);
  const r = scoreWords(b, ['cat', 'CAT', 'CATS', 'XXX', 'SAT'], valid);
  assert.deepEqual(r.words.map(x => x.w), ['CAT', 'CATS']);
  assert.equal(r.total, 6 + 7);
});

test('bots get stronger with level', () => {
  const d = fullDict();
  const all = solve(makeBoard('bot', 0, d), d);
  const sum = lv => botRound(all, lv, rng(7)).reduce((s, x) => s + x.s, 0);
  assert.ok(sum('easy') < sum('medium') && sum('medium') < sum('hard'));
  const easy = botRound(all, 'easy', rng(3));
  assert.ok(easy.every(x => x.w.length <= 4 && x.t >= 0 && x.t <= 90));
});
