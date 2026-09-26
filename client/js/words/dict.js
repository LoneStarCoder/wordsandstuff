// The word list is only downloaded when it's needed (bot games) and then
// cached forever by the service worker. Online games are checked by the
// server, so they use it only if it's already on the device.
/* global DICT_URL */
import { Dawg } from '../../../shared/words/dawg.js';
import { unpack } from '../../../shared/words/pack.js';

let dict = null, loading = null;

export const dictNow = () => dict;

export function loadDict() {
  loading ||= fetch(DICT_URL)
    .then(r => {
      if (!r.ok) throw new Error('dictionary ' + r.status);
      return r.arrayBuffer();
    })
    .then(buf => (dict = new Dawg(unpack(new Uint8Array(buf)))))
    .catch(() => {
      loading = null;
      throw new Error("Couldn't download the word list. Check your connection and try again.");
    });
  return loading;
}

// Loads the dictionary only if it's already cached on this device.
export async function loadDictIfCached() {
  if (dict) return dict;
  try {
    if (await caches.match(DICT_URL)) return await loadDict();
  } catch {}
  return null;
}
