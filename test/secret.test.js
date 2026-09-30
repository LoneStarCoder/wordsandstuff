import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedback, outcome, dailyAnswer, parseWords, packWords, emojiGrid } from '../shared/secret/game.js';
import { fiveList } from './helpers.js';

test('feedback marks right spot, wrong spot and repeated letters correctly', () => {
  assert.equal(feedback('CRANE', 'CRANE'), 'ggggg');
  assert.equal(feedback('SPEED', 'ABIDE'), '..y.y');
  assert.equal(feedback('EERIE', 'THREE'), 'y.g.g');
  assert.equal(feedback('ALLOT', 'LLAMA'), 'ygy..');
  assert.equal(feedback('LLAMA', 'ALLOT'), 'ygy..');
  assert.equal(feedback('BOOKS', 'ROBOT'), 'ygy..'); // ROBOT has two Os
});

test('outcome and emoji grid', () => {
  assert.deepEqual(outcome(['CRANE', 'BLEND'], 'BLEND'), { solved: true, tries: 2, done: true });
  assert.deepEqual(outcome(['CRANE'], 'BLEND'), { solved: false, tries: null, done: false });
  assert.equal(outcome(Array(6).fill('CRANE'), 'BLEND').done, true);
  assert.equal(emojiGrid(['g.y..']), '🟩⬜🟨⬜⬜');
});

test('word list: answers are common, allowed words include obscure ones', () => {
  const { allowed, answers } = fiveList();
  assert.ok(allowed.size > 8000 && answers.length > 2000);
  assert.ok(answers.every(w => allowed.has(w) && /^[A-Z]{5}$/.test(w)));
  for (const w of ['CRANE', 'PIZZA', 'HOUSE']) assert.ok(answers.includes(w), w);
  assert.ok(allowed.has('XYSTI') && !answers.includes('XYSTI'));
  assert.ok(!answers.includes('WHORE') && !answers.includes('CATS'));
  const round = parseWords(packWords(['abcde', 'fghij'], ['fghij']));
  assert.deepEqual([...round.allowed], ['ABCDE', 'FGHIJ']);
  assert.deepEqual(round.answers, ['FGHIJ']);
});

test('daily word is fixed per day and does not repeat for years', () => {
  const { answers } = fiveList();
  assert.equal(dailyAnswer('2026-10-01', answers), dailyAnswer('2026-10-01', answers));
  const seen = new Set();
  const d = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 2000; i++) {
    seen.add(dailyAnswer(d.toISOString().slice(0, 10), answers));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  assert.equal(seen.size, 2000);
});
