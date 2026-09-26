// Builds the packed DAWG described in shared/words/dawg.js from a word list,
// using the incremental algorithm for sorted input (Daciuk et al., 2000).
import { readFileSync } from 'node:fs';
import { LETTER, END, LAST, SHIFT } from '../shared/words/dawg.js';

export function loadWords(files, maxLen = 15) {
  const set = new Set();
  for (const f of files) {
    for (let w of readFileSync(f, 'utf8').split(/\r?\n/)) {
      w = w.trim().toLowerCase();
      if (w && !w.startsWith('#') && /^[a-z]+$/.test(w) && w.length <= maxLen) set.add(w);
    }
  }
  return [...set].sort();
}

export function buildDawg(sortedWords) {
  let nextId = 0;
  const mk = () => ({ id: nextId++, final: false, edges: new Map(), sig: null });
  const root = mk();
  const register = new Map();
  const unchecked = []; // [parent, letter, child]
  let prev = '';

  const signature = n => {
    let s = n.final ? '1' : '0';
    for (const [c, ch] of [...n.edges].sort((x, y) => x[0] - y[0])) s += ',' + c + ':' + ch.id;
    return s;
  };
  const minimize = downTo => {
    for (let i = unchecked.length - 1; i >= downTo; i--) {
      const [parent, c, child] = unchecked[i];
      const sig = signature(child);
      const found = register.get(sig);
      if (found) parent.edges.set(c, found);
      else register.set(sig, child);
      unchecked.pop();
    }
  };

  for (const word of sortedWords) {
    if (word <= prev) throw new Error('words must be sorted and unique: ' + word);
    let common = 0;
    while (common < word.length && common < prev.length && word[common] === prev[common]) common++;
    minimize(common);
    let node = unchecked.length ? unchecked[unchecked.length - 1][2] : root;
    for (let i = common; i < word.length; i++) {
      const next = mk();
      const c = word.charCodeAt(i) - 97;
      node.edges.set(c, next);
      unchecked.push([node, c, next]);
      node = next;
    }
    node.final = true;
    prev = word;
  }
  minimize(0);

  // Assign each node with children an offset for its edge list (DFS order).
  const offset = new Map();
  let size = 1;
  const order = [];
  const visit = n => {
    if (!n.edges.size || offset.has(n)) return;
    offset.set(n, size);
    size += n.edges.size;
    order.push(n);
    for (const c of [...n.edges.keys()].sort((x, y) => x - y)) visit(n.edges.get(c));
  };
  visit(root);

  const a = new Uint32Array(size);
  a[0] = offset.get(root) || 0;
  for (const n of order) {
    let i = offset.get(n);
    const keys = [...n.edges.keys()].sort((x, y) => x - y);
    keys.forEach((c, k) => {
      const child = n.edges.get(c);
      const childOff = offset.get(child) || 0;
      if (childOff >= 2 ** 25) throw new Error('DAWG too large');
      a[i++] = (c & LETTER) | (child.final ? END : 0) | (k === keys.length - 1 ? LAST : 0) | (childOff << SHIFT) >>> 0;
    });
  }
  return a;
}
