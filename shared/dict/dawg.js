// Read-only DAWG (directed acyclic word graph) over a Uint32Array.
//
// Layout: a[0] = offset of the root's edge list. Every node with children is a
// contiguous run of edges; each edge is one uint32:
//   bits 0-4  letter (0 = 'a' … 25 = 'z')
//   bit  5    a word ends after this edge
//   bit  6    last edge in this node's list
//   bits 7-31 offset of the child's edge list (0 = no children)
// The same buffer is the download format, so there is nothing to parse.

export const LETTER = 31, END = 32, LAST = 64, SHIFT = 7;

export class Dawg {
  constructor(buffer) {
    this.a = buffer instanceof Uint32Array ? buffer : new Uint32Array(buffer);
    this.root = this.a[0];
  }

  // Index of the edge for letter code c in the list starting at `list`, or -1.
  find(list, c) {
    if (!list) return -1;
    const a = this.a;
    for (let i = list; ; i++) {
      const e = a[i];
      if ((e & LETTER) === c) return i;
      if (e & LAST) return -1;
    }
  }

  // Edge index reached after following `word` from the root, or -1.
  walk(word) {
    let list = this.root, e = -1;
    for (let i = 0; i < word.length; i++) {
      e = this.find(list, word.charCodeAt(i) - 97);
      if (e < 0) return -1;
      list = this.a[e] >>> SHIFT;
    }
    return e;
  }

  has(word) {
    word = word.toLowerCase();
    if (!word.length) return false;
    const e = this.walk(word);
    return e >= 0 && (this.a[e] & END) !== 0;
  }
}
