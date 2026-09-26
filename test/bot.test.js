import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS, analyzeMove } from '../shared/words/rules.js';
import { createState, play, swap, pass, boardArray } from '../shared/words/game.js';
import { generateMoves, chooseMove } from '../shared/words/bot.js';
import { fullDict, seeded } from './helpers.js';

test('every generated move is legal and scored like the rules engine', () => {
  const dict = fullDict();
  for (const [vid, seed] of [['classic', 7], ['modern', 11], ['classic', 99]]) {
    const rand = seeded(seed);
    const ri = n => Math.floor(rand() * n);
    const st = createState(vid, ri);
    const v = VARIANTS[vid];
    let checked = 0;
    for (let turn = 0; turn < 60 && !st.over; turn++) {
      const board = boardArray(st.b);
      const rack = [...st.r[st.turn]];
      let n = 0;
      generateMoves(v, board, rack, dict, (tiles, score) => {
        if (n++ % 7) return; // sample to keep the test fast
        const r = analyzeMove(v, board, tiles);
        assert.ok(r.ok, `${vid} ${JSON.stringify(tiles)} ${r.error}`);
        assert.equal(score, r.score, `${vid} score ${JSON.stringify(tiles)}`);
        for (const w of r.words) assert.ok(dict.has(w.w), w.w);
        checked++;
      });
      const levels = ['easy', 'medium', 'hard'];
      const mv = chooseMove({ variantId: vid, board, rack, bagCount: st.bag.length, dawg: dict, level: levels[turn % 3], rand });
      const res = mv.k === 'play' ? play(st, st.turn, mv.tiles, dict) : mv.k === 'swap' ? swap(st, st.turn, mv.tiles, ri) : pass(st, st.turn);
      assert.ok(res.ok, `${mv.k} ${res.error}`);
    }
    assert.ok(checked > 100, 'checked ' + checked);
  }
});

test('hard bot finds a strong opening', () => {
  const dict = fullDict();
  const mv = chooseMove({ variantId: 'classic', board: Array(225).fill(''), rack: [...'QUIZERS'], bagCount: 80, dawg: dict, level: 'hard' });
  assert.equal(mv.k, 'play');
  assert.ok(mv.score >= 40, 'score ' + mv.score);
});

// Brute force: try every ordering of every subset of the rack in every
// straight line on the board and keep what the rules engine accepts.
function bruteForce(v, board, rack, dict) {
  const found = new Set();
  const perms = [];
  const rec = (used, cur) => {
    if (cur.length) perms.push(cur.slice());
    for (let k = 0; k < rack.length; k++) {
      if (used[k]) continue;
      used[k] = true;
      const options = rack[k] === '?' ? [...'abcdefghijklmnopqrstuvwxyz'] : [rack[k]];
      for (const ch of options) { cur.push(ch); rec(used, cur); cur.pop(); }
      used[k] = false;
    }
  };
  rec([], []);
  for (let start = 0; start < 225; start++) {
    if (board[start]) continue;
    for (const step of [1, 15]) {
      for (const p of perms) {
        const tiles = [];
        let i = start;
        for (const ch of p) {
          while (i < 225 && board[i]) i += step;
          if (i >= 225 || (step === 1 && Math.floor(i / 15) !== Math.floor(start / 15))) break;
          tiles.push([i, ch]);
          i += step;
        }
        if (tiles.length !== p.length) continue;
        const r = analyzeMove(v, board, tiles);
        if (r.ok && r.words.every(w => dict.has(w.w))) found.add(JSON.stringify([...tiles].sort((a, b) => a[0] - b[0])) + r.score);
      }
    }
  }
  return found;
}

test('generator finds exactly the moves a brute-force search finds', () => {
  const dict = fullDict();
  const v = VARIANTS.modern;
  const rand = seeded(5);
  const ri = n => Math.floor(rand() * n);
  const st = createState('modern', ri);
  for (let t = 0; t < 8; t++) {
    const mv = chooseMove({ variantId: 'modern', board: boardArray(st.b), rack: [...st.r[st.turn]], bagCount: st.bag.length, dawg: dict, level: 'hard' });
    assert.equal(mv.k, 'play');
    assert.ok(play(st, st.turn, mv.tiles, dict).ok);
  }
  const board = boardArray(st.b);
  for (const rack of [['E', 'S', 'T'], ['A', '?', 'R'], ['Q', 'I', 'Z', 'O']]) {
    const gen = new Set();
    generateMoves(v, board, rack, dict, (tiles, score) => gen.add(JSON.stringify([...tiles].sort((a, b) => a[0] - b[0])) + score));
    const brute = bruteForce(v, board, rack, dict);
    const missing = [...brute].filter(m => !gen.has(m));
    const extra = [...gen].filter(m => !brute.has(m));
    assert.deepEqual(missing, [], 'missing for ' + rack.join(''));
    assert.deepEqual(extra, [], 'extra for ' + rack.join(''));
    assert.ok(brute.size > 10, rack.join('') + ' ' + brute.size);
  }
});
