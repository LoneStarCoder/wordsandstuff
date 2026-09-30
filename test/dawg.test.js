import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDawg } from '../tools/dawg-build.js';
import { Dawg } from '../shared/dict/dawg.js';
import { pack, unpack } from '../shared/dict/pack.js';
import { fullDict } from './helpers.js';

test('small DAWG membership', () => {
  const words = ['car', 'card', 'cards', 'cat', 'cats', 'do', 'dog', 'dogs'];
  const d = new Dawg(buildDawg(words));
  for (const w of words) assert.ok(d.has(w), w);
  for (const w of ['ca', 'c', 'dogss', 'cart', '', 'x']) assert.ok(!d.has(w), w);
  assert.ok(d.has('CATS'), 'case-insensitive');
});

test('pack/unpack round trip keeps every word', () => {
  const words = ['aa', 'aah', 'aahed', 'ab', 'abs', 'bar', 'bars', 'car', 'cars', 'zoo', 'zoos'];
  const a = buildDawg(words);
  const b = unpack(pack(a));
  const d = new Dawg(b);
  for (const w of words) assert.ok(d.has(w), w);
  assert.ok(!d.has('ba'));
});

test('full dictionary packs and unpacks', () => {
  const d = fullDict();
  const d2 = new Dawg(unpack(pack(d.a)));
  for (const w of ['qi', 'za', 'zen', 'quixotic', 'jazz', 'emoji', 'aa', 'zyzzyva']) assert.ok(d2.has(w), w);
  for (const w of ['qzx', 'aaaa', 'jazzz']) assert.ok(!d2.has(w), w);
});
