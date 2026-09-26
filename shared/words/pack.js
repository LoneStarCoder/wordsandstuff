// Compact transport format for the DAWG (see dawg.js), ~30% smaller than the
// raw edge array after brotli. Lists are written depth-first; a child that has
// not been written yet follows inline, one already written is referenced by id.
//
// File: u32 edgeCount, u32 refBytes, then three byte streams:
//   F[edgeCount]  letter | END | LAST        (the edge minus its child offset)
//   K[edgeCount]  0 no child · 1 new child follows · 2 reference to earlier list
//   R[refBytes]   varint list ids for K = 2
import { LAST, SHIFT } from './dawg.js';

export function pack(a) {
  const F = [], K = [], R = [];
  const ids = new Map();
  const varint = v => { while (v >= 128) { R.push((v & 127) | 128); v >>>= 7; } R.push(v); };
  const emit = list => {
    ids.set(list, ids.size);
    const kids = [];
    for (let i = list; ; i++) {
      const e = a[i];
      F.push(e & 127);
      kids.push(e >>> SHIFT);
      if (e & LAST) break;
    }
    for (const o of kids) {
      if (!o) K.push(0);
      else if (ids.has(o)) { K.push(2); varint(ids.get(o)); }
      else { K.push(1); emit(o); }
    }
  };
  if (a[0]) emit(a[0]);
  const out = new Uint8Array(8 + F.length + K.length + R.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, F.length, true);
  dv.setUint32(4, R.length, true);
  out.set(F, 8);
  out.set(K, 8 + F.length);
  out.set(R, 8 + F.length * 2);
  return out;
}

export function unpack(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(0, true);
  const F = bytes.subarray(8, 8 + n), K = bytes.subarray(8 + n, 8 + 2 * n), R = bytes.subarray(8 + 2 * n);
  const a = new Uint32Array(n + 1);
  const ids = [];
  let pos = 1, fi = 0, ki = 0, ri = 0;
  const varint = () => {
    let v = 0, s = 0, b;
    do { b = R[ri++]; v += (b & 127) * 2 ** s; s += 7; } while (b & 128);
    return v;
  };
  const dec = () => {
    const off = pos;
    ids.push(off);
    let len = 0;
    while (!(F[fi + len++] & LAST));
    for (let j = 0; j < len; j++) a[off + j] = F[fi + j];
    fi += len;
    pos += len;
    for (let j = 0; j < len; j++) {
      const k = K[ki++];
      const child = k === 1 ? dec() : k === 2 ? ids[varint()] : 0;
      a[off + j] = (a[off + j] | (child << SHIFT)) >>> 0;
    }
    return off;
  };
  if (n) a[0] = dec();
  return a;
}
