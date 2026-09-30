// The guessing grid and keyboard, shared by friend challenges, the daily
// word and practice.
import { h, set, toast } from '../dom.js';
import { LEN, MAX_GUESSES } from '../../../shared/secret/game.js';
import { sfx, initAudio } from '../rush/audio.js';

const KEYS = ['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'];
const RANK = { '.': 1, y: 2, g: 3 };

// opts: { rows: [{ g, fb }], allowed: Set | null, readOnly, hidden, submit(word) → { fb } | { error } }
export function guessBoard(opts) {
  let rows = opts.rows || [];
  let typed = '';
  let busy = false;
  const grid = h('div.sw-grid', { 'aria-label': 'Guesses' });
  const kb = h('div.sw-keys');
  const el = h('div.sw-board', grid, !opts.readOnly && kb);

  const tile = (ch, state = '', i = 0, reveal = false) => {
    const t = h('div.sw-tile' + (state ? '.s-' + (state === '.' ? 'x' : state) : '') + (ch && !state ? '.typed' : '') + (reveal ? '.flip' : ''), opts.hidden && state ? '' : ch);
    if (reveal) t.style.animationDelay = i * 0.18 + 's';
    return t;
  };

  function render(revealLast = false) {
    const out = [];
    rows.forEach((r, k) => out.push(h('div.sw-row', [...r.g].map((ch, i) => tile(ch, r.fb[i], i, revealLast && k === rows.length - 1)))));
    const over = rows.some(r => r.fb === 'ggggg') || rows.length >= MAX_GUESSES;
    if (!over && !opts.readOnly) out.push(h('div.sw-row.cur', Array.from({ length: LEN }, (_, i) => tile(typed[i] || ''))));
    while (out.length < MAX_GUESSES) out.push(h('div.sw-row', Array.from({ length: LEN }, () => tile(''))));
    set(grid, out);
    // Best-known state of each letter for the keyboard.
    const best = {};
    for (const r of rows) [...r.g].forEach((ch, i) => (best[ch] = RANK[r.fb[i]] > (RANK[best[ch]] || 0) ? r.fb[i] : best[ch]));
    set(
      kb,
      KEYS.map(line =>
        h(
          'div.sw-krow',
          [...line].map(k =>
            h('button.sw-key' + (k === '⏎' || k === '⌫' ? '.wide' : '') + (best[k] ? '.s-' + (best[k] === '.' ? 'x' : best[k]) : ''), {
              type: 'button',
              'aria-label': k === '⏎' ? 'Enter' : k === '⌫' ? 'Delete' : k,
              onclick: () => press(k === '⏎' ? 'Enter' : k === '⌫' ? 'Backspace' : k),
            }, k === '⏎' ? 'Enter' : k),
          ),
        ),
      ),
    );
    el.classList.toggle('locked', over || !!opts.readOnly);
  }

  const shake = () => {
    const row = grid.querySelector('.cur');
    row?.classList.remove('shake');
    void row?.offsetWidth;
    row?.classList.add('shake');
  };

  async function press(key) {
    initAudio();
    if (busy || opts.readOnly || rows.some(r => r.fb === 'ggggg') || rows.length >= MAX_GUESSES) return;
    if (/^[A-Z]$/i.test(key)) {
      if (typed.length < LEN) typed += key.toUpperCase();
      sfx.tile(typed.length);
    } else if (key === 'Backspace') typed = typed.slice(0, -1);
    else if (key === 'Enter') {
      if (typed.length < LEN) {
        shake();
        return toast('Not enough letters', 1200);
      }
      if (opts.allowed && !opts.allowed.has(typed)) {
        shake();
        sfx.bad();
        return toast(`${typed} isn't in the word list`, 1400);
      }
      if (rows.some(r => r.g === typed)) {
        shake();
        return toast('Already tried that', 1200);
      }
      busy = true;
      const word = typed;
      const res = await opts.submit(word).catch(e => ({ error: e.message }));
      busy = false;
      if (res.error) {
        shake();
        return toast(res.error);
      }
      rows = [...rows, { g: word, fb: res.fb }];
      typed = '';
      render(true);
      setTimeout(() => (res.fb === 'ggggg' ? sfx.good(7) : sfx.tile(1)), LEN * 180);
      return;
    } else return;
    render();
  }

  const onKey = e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input') || document.querySelector('.overlay')) return;
    if (/^[a-z]$/i.test(e.key) || e.key === 'Enter' || e.key === 'Backspace') {
      e.preventDefault();
      press(e.key);
    }
  };
  document.addEventListener('keydown', onKey);
  render();

  return {
    el,
    setRows(r) {
      rows = r;
      render();
    },
    destroy: () => document.removeEventListener('keydown', onKey),
  };
}
