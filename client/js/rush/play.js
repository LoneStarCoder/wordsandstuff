// Playing a round: 90 seconds to trace as many words as you can.
// Swipe through touching tiles (or type on a keyboard) and let go to score.
import { h, set, toast, local } from '../dom.js';
import { SIZE, spell, pathsFor, scoreWord, NEIGHBORS, ROUND_SECONDS } from '../../../shared/rush/board.js';
import { initAudio, sfx, muted, setMuted } from './audio.js';
import { tileEl } from './common.js';

const PRAISE = [[8, 'Legendary!'], [7, 'Amazing!'], [6, 'Great!'], [5, 'Nice!']];

// opts: { title, note, resumed, start(), finish(words), onDone(recap), quit() , saveKey }
export function playScreen(root, opts) {
  let alive = true, round = null, timer = null;
  let found = local.get(opts.saveKey, []); // words, oldest first
  let score = 0;
  let path = [], typed = '', tracing = false;
  let finishing = false;

  const el = h('div.play');
  root.append(el);

  // --- Ready screen ------------------------------------------------------------
  function ready() {
    const btn = h('button.primary.big-btn', { onclick: go }, opts.resumed ? 'Resume' : 'Start');
    set(
      el,
      h(
        'div.ready',
        h('button.icon-btn.quit', { 'aria-label': 'Back', onclick: opts.quit }, '‹'),
        h('div.ready-tiles', [...'GO'].map(c => h('span.tile', h('span.l', c)))),
        h('h1', opts.title),
        opts.note && h('p.muted', opts.note),
        h('ul.ready-tips', h('li', 'Swipe through touching letters — diagonals count.'), h('li', 'Longer words score big. Bonus tiles multiply.'), h('li', `You have ${ROUND_SECONDS} seconds once you start.`)),
        btn,
      ),
    );
    btn.focus();
  }

  async function go(e) {
    initAudio();
    e.target.disabled = true;
    e.target.textContent = 'Loading…';
    try {
      round = await opts.start();
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Try again';
      return;
    }
    if (!alive) return;
    if (Date.now() >= round.endsAt) return timeUp();
    if (!opts.resumed) await countdown();
    if (alive) play();
  }

  function countdown() {
    return new Promise(resolve => {
      const big = h('div.count', '3');
      set(el, h('div.ready', big));
      let n = 3;
      sfx.count();
      const t = setInterval(() => {
        n--;
        if (!alive) return clearInterval(t);
        if (n > 0) {
          big.textContent = String(n);
          sfx.count();
        } else {
          clearInterval(t);
          big.textContent = 'Go!';
          sfx.go();
          setTimeout(resolve, 350);
        }
        big.classList.remove('pop');
        void big.offsetWidth;
        big.classList.add('pop');
      }, 650);
    });
  }

  // --- Playing -----------------------------------------------------------------
  const scoreEl = h('b.p-score', '0');
  const clock = h('span.clock');
  const bar = h('div.bar-fill');
  const rival = h('div.rival');
  const current = h('div.current');
  const grid = h('div.grid', { 'aria-label': 'Letter grid' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'trace');
  svg.setAttribute('viewBox', '0 0 400 400');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  svg.append(line);
  const pops = h('div.pops');
  const list = h('div.found');
  const countEl = h('span');
  let tiles = [];

  function play() {
    const b = round.board;
    tiles = [...b.l].map((ch, i) => {
      const bonus = i === b.dl ? 'dl' : i === b.tl ? 'tl' : i === b.dw ? 'dw' : i === b.tw ? 'tw' : '';
      const t = tileEl(ch, bonus);
      t.dataset.i = i;
      return t;
    });
    set(grid, tiles, svg, pops);
    const mute = h('button.icon-btn.small', { 'aria-label': 'Sound on or off', onclick: () => (setMuted(!muted()), (mute.textContent = muted() ? '🔇' : '🔊')) }, muted() ? '🔇' : '🔊');
    set(
      el,
      h(
        'div.p-top',
        h('button.icon-btn', { 'aria-label': 'Leave round', onclick: leave }, '‹'),
        h('div.p-title', opts.title),
        mute,
        clock,
      ),
      h('div.bar', bar),
      h('div.p-scores', h('div.me', h('span.small.muted', 'You'), scoreEl), rival),
      current,
      grid,
      h('div.found-head', countEl, h('span.small.muted', 'newest first')),
      list,
    );
    // Rebuild score from words saved before a reload.
    score = found.reduce((s, w) => s + scoreWord(round.board, w), 0);
    renderFound();
    renderCurrent();
    tick();
    timer = setInterval(tick, 200);
    grid.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
  }

  let lastSecond = null;
  function tick() {
    const left = Math.max(0, round.endsAt - Date.now());
    const sec = Math.ceil(left / 1000);
    clock.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    bar.style.transform = `scaleX(${left / ((round.total || ROUND_SECONDS) * 1000)})`;
    const hurry = sec <= 10;
    el.classList.toggle('hurry', hurry);
    if (hurry && sec !== lastSecond && sec > 0 && sec <= 5) sfx.tick();
    lastSecond = sec;
    renderRival();
    if (left <= 0) timeUp();
  }

  function renderRival() {
    if (round.ticker) {
      const elapsed = (Date.now() - (round.endsAt - ROUND_SECONDS * 1000)) / 1000;
      const got = round.ticker.words.filter(x => x.t <= elapsed);
      const s = got.reduce((t, x) => t + x.s, 0);
      set(rival, h('span.small.muted', round.ticker.name), h('b', String(s)), h('span.small.muted', `${got.length} words`));
      scoreEl.parentElement.classList.toggle('ahead', score > s);
    } else if (round.target) {
      set(rival, h('span.small.muted', `${round.target.name} scored`), h('b', String(round.target.s)), h('span.small.muted', score > round.target.s ? "You're ahead!" : `${round.target.s - score + 1} to beat`));
      scoreEl.parentElement.classList.toggle('ahead', score > round.target.s);
    } else rival.replaceChildren();
  }

  const wordOf = p => p.map(i => spell(round.board.l[i])).join('');

  function stateOf(w) {
    if (w.length < 3) return '';
    if (found.includes(w)) return 'dupe';
    return round.isWord(w) ? 'good' : '';
  }

  function renderCurrent() {
    const w = wordOf(path);
    const st = path.length ? stateOf(w) : '';
    current.className = 'current ' + st;
    if (!path.length) set(current, h('span.muted.small', found.length ? `${found.length} found · keep going!` : 'Swipe letters to make words'));
    else set(current, h('span.cw', w), st === 'good' && h('span.cw-pts', '+' + scoreWord(round.board, w)), st === 'dupe' && h('span.small', 'already found'));
    tiles.forEach((t, i) => {
      const k = path.indexOf(i);
      t.classList.toggle('on', k >= 0);
      t.classList.toggle('good', k >= 0 && st === 'good');
      t.classList.toggle('dupe', k >= 0 && st === 'dupe');
    });
    // Line through the centres of the traced tiles (SVG uses a 400×400 box).
    const g = grid.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
    line.setAttribute('points', path.map(i => {
      const t = tiles[i].getBoundingClientRect();
      return `${t.left - g.left + t.width / 2},${t.top - g.top + t.height / 2}`;
    }).join(' '));
    line.style.strokeWidth = g.width / 22 + 'px';
    line.setAttribute('class', st);
  }

  function renderFound() {
    countEl.textContent = `${found.length} word${found.length === 1 ? '' : 's'}`;
    scoreEl.textContent = String(score);
    set(list, [...found].reverse().map(w => h('span.chip-word', w, h('small', String(scoreWord(round.board, w))))));
  }

  function pop(text, cls) {
    const p = h('div.pop' + cls, text);
    set(pops, p);
    setTimeout(() => p.remove(), 1100);
  }

  function submit() {
    const w = wordOf(path);
    const st = stateOf(w);
    if (path.length === 0) return;
    if (w.length < 3) {
      if (path.length > 1) pop('Too short', '.meh');
    } else if (st === 'dupe') {
      sfx.dupe();
      pop('Already found', '.meh');
    } else if (st === 'good') {
      const s = scoreWord(round.board, w);
      found.push(w);
      score += s;
      local.set(opts.saveKey, found);
      sfx.good(w.length);
      const praise = PRAISE.find(([n]) => w.length >= n)?.[1];
      pop(`+${s}${praise ? ' ' + praise : ''}`, w.length >= 6 ? '.wow' : '.plus');
      grid.classList.remove('flash');
      void grid.offsetWidth;
      grid.classList.add('flash');
      renderFound();
      renderRival();
    } else {
      sfx.bad();
      grid.classList.remove('shake');
      void grid.offsetWidth;
      grid.classList.add('shake');
    }
    path = [];
    typed = '';
    renderCurrent();
  }

  // Which tile is under the pointer? Only the middle of a tile counts, so
  // diagonal swipes don't clip the neighbours.
  function tileAt(x, y) {
    const r = grid.getBoundingClientRect();
    const size = r.width / SIZE;
    const col = Math.floor((x - r.left) / size), row = Math.floor((y - r.top) / size);
    if (col < 0 || row < 0 || col >= SIZE || row >= SIZE) return -1;
    const cx = r.left + (col + 0.5) * size, cy = r.top + (row + 0.5) * size;
    return Math.hypot(x - cx, y - cy) < size * 0.42 ? row * SIZE + col : -1;
  }

  function extend(i) {
    if (i < 0) return;
    const last = path[path.length - 1];
    if (i === last) return;
    if (i === path[path.length - 2]) {
      path.pop(); // slide back to undo
      return renderCurrent();
    }
    if (path.includes(i) || (path.length && !NEIGHBORS[last].includes(i))) return;
    path.push(i);
    sfx.tile(path.length);
    renderCurrent();
  }

  function down(e) {
    if (finishing || e.button > 0) return;
    const i = tileAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    grid.setPointerCapture?.(e.pointerId);
    tracing = true;
    typed = '';
    path = [];
    extend(i);
    const move = ev => {
      if (!tracing) return;
      // Sample along fast swipes so no tile is skipped.
      const evs = ev.getCoalescedEvents?.() || [ev];
      for (const c of evs) extend(tileAt(c.clientX, c.clientY));
    };
    const up = () => {
      tracing = false;
      grid.removeEventListener('pointermove', move);
      grid.removeEventListener('pointerup', up);
      grid.removeEventListener('pointercancel', up);
      submit();
    };
    grid.addEventListener('pointermove', move);
    grid.addEventListener('pointerup', up);
    grid.addEventListener('pointercancel', up);
  }

  // Keyboard: type a word and press Enter.
  function key(e) {
    if (finishing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.overlay')) return;
    if (/^[a-z]$/i.test(e.key)) {
      typed += e.key.toUpperCase();
      // "Q" alone means the Qu tile.
      if (typed.endsWith('Q')) typed += 'U';
    } else if (e.key === 'Backspace') {
      typed = typed.endsWith('QU') ? typed.slice(0, -2) : typed.slice(0, -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      return submit();
    } else if (e.key === 'Escape') typed = '';
    else return;
    e.preventDefault();
    const paths = typed ? pathsFor(round.board, typed) : [];
    path = paths[0] || [];
    renderCurrent();
    if (typed && !paths.length) set(current, h('span.cw.miss', typed), h('span.small', 'not on the board'));
  }

  // --- Finishing -----------------------------------------------------------------
  async function timeUp() {
    if (finishing) return;
    finishing = true;
    clearInterval(timer);
    tracing = false;
    path = [];
    if (tiles.length) {
      sfx.end();
      el.classList.remove('hurry');
      el.append(h('div.times-up', h('div', "Time's up!")));
    }
    await new Promise(r => setTimeout(r, tiles.length ? 1100 : 0));
    send();
  }

  async function send() {
    if (!alive) return;
    try {
      const recap = await opts.finish(found);
      local.del(opts.saveKey);
      if (alive) opts.onDone(recap);
    } catch (err) {
      if (!alive) return;
      set(el, h('div.ready', h('h1', "Couldn't save your round"), h('p.muted', err.message + ' Your words are saved on this device.'), h('button.primary.big-btn', { onclick: send }, 'Try again')));
    }
  }

  function leave() {
    toast('The clock keeps running — come back soon!');
    opts.quit();
  }

  ready();

  return () => {
    alive = false;
    clearInterval(timer);
    document.removeEventListener('keydown', key);
  };
}
