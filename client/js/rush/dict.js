// The word list is only downloaded for games played on the device (the bot
// and the daily board), then cached forever by the service worker. Friend
// matches are checked with word hashes from the server instead.
/* global DICT_URL */
import { Dawg } from '../../../shared/dict/dawg.js';
import { unpack } from '../../../shared/dict/pack.js';

let loading = null;

export function loadDict() {
  loading ||= fetch(DICT_URL)
    .then(r => {
      if (!r.ok) throw new Error('dictionary ' + r.status);
      return r.arrayBuffer();
    })
    .then(buf => new Dawg(unpack(new Uint8Array(buf))))
    .catch(() => {
      loading = null;
      throw new Error("Couldn't download the word list. Check your connection and try again.");
    });
  return loading;
}
