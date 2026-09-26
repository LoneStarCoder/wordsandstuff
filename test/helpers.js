import { loadWords, buildDawg } from '../tools/dawg-build.js';
import { Dawg } from '../shared/words/dawg.js';

const data = f => new URL('../data/' + f, import.meta.url).pathname;

let cached;
export function fullDict() {
  cached ||= new Dawg(buildDawg(loadWords([data('enable1.txt'), data('supplement.txt')])));
  return cached;
}

// Small deterministic PRNG (mulberry32) for reproducible tests.
export function seeded(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
