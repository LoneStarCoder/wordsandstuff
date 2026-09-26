// Runs the bot's move search off the main thread.
/* global DICT_URL */
import { Dawg } from '../../../shared/words/dawg.js';
import { unpack } from '../../../shared/words/pack.js';
import { chooseMove } from '../../../shared/words/bot.js';

let dawg = null;

self.onmessage = async e => {
  const { id, req } = e.data;
  try {
    dawg ||= fetch(DICT_URL)
      .then(r => r.arrayBuffer())
      .then(b => new Dawg(unpack(new Uint8Array(b))));
    const move = chooseMove({ ...req, dawg: await dawg });
    self.postMessage({ id, move });
  } catch (err) {
    dawg = null;
    self.postMessage({ id, error: String(err) });
  }
};
