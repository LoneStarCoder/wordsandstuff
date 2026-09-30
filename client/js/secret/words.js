// The Secret Word list (~22 KB): every 5-letter word, answers marked.
// Downloaded the first time it's needed, then cached by the service worker.
/* global FIVE_URL */
import { parseWords } from '../../../shared/secret/game.js';

let loading = null;
export function loadFive() {
  loading ||= fetch(FIVE_URL)
    .then(r => (r.ok ? r.text() : Promise.reject()))
    .then(parseWords)
    .catch(() => {
      loading = null;
      throw new Error("Couldn't download the word list. Check your connection and try again.");
    });
  return loading;
}
