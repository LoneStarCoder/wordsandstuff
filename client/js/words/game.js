// The game screen: board, rack, drag & drop / tap / keyboard placement,
// score preview, moves and chat. Works with any source from sources.js.
import { h, toast, sheet, confirm, local, initial, timeAgo, set } from '../dom.js';
import { go } from '../nav.js';
import { me } from '../net.js';
import { variant, analyzeMove, N, CELLS } from '../../../shared/words/rules.js';
import { boardArray } from '../../../shared/words/game.js';
import { dictNow, loadDictIfCached } from './dict.js';
import { shareInvite, howToPlay } from './common.js';
import { pushNudge } from '../push.js';

const PREMIUM = { d: ['dl', 'DL'], t: ['tl', 'TL'], D: ['dw', 'DW'], T: ['tw', 'TW'], '*': ['star', '★'] };
const hoverDevice = matchMedia('(hover: hover) and (pointer: fine)').matches;

export function gameScreen(root, source) {
  let view = null, v = null, board = [];
  let rack = [], uid = 0;
  const pending = new Map(); // cell -> { id, ch }
  let placeOrder = [];
  let selected = null; // rack tile id picked by tapping
  let cursor = null; // { i, step } for typing on a keyboard
  let swapMode = false;
  const swapSel = new Set();
  let busy = false, committing = new Set();
  let tab = 'moves';
  let flashCells = new Set(), flashTimer = null;
  let badWords = [];
  let playScore = null;
  let alive = true;

  // --- DOM ---------------------------------------------------------------
  const pills = [h('div.player'), h('div.player')];
  const top = h(
    'header.game-top',
    h('button.icon-btn', { 'aria-label': 'Back to games', onclick: () => go('/words') }, '‹'),
    h('div.players', pills),
    h('button.icon-btn', { 'aria-label': 'Game menu', onclick: openMenu }, '⋯'),
  );
  const status = h('div.status');
  const boardEl = h('div.board', { 'aria-label': 'Board' });
  const preview = h('div.preview', { hidden: true });
  const boardWrap = h('div.board-wrap', boardEl, preview);
  const rackEl = h('div.rack', { 'aria-label': 'Your tiles' });
  const actions = h('div.actions');
  const panel = h('div.panel');
  const el = h('div.game', top, status, boardWrap, rackEl, actions, panel);
  root.append(el);

  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const c = h('div.cell');
    c.dataset.i = i;
    cells.push(c);
    boardEl.append(c);
  }

  // Keep tile text proportional to the board size.
  const ro = new ResizeObserver(() => {
    const w = boardEl.clientWidth;
    if (w) boardEl.style.setProperty('--cell', w / N + 'px');
  });
  ro.observe(boardEl);

  // --- Helpers -----------------------------------------------------------
  const myTurn = () => view && !view.over && view.turn === view.me && !source.thinking;
  const pendingIds = () => new Set([...pending.values()].map(p => p.id));
  const oppName = () => view.pl[1 - view.me] || 'Your friend';
  const myName = () => view.pl[view.me] || me.name || 'You';

  function tileEl(ch, cls = '') {
    const blank = ch === '?' || (ch >= 'a' && ch <= 'z');
    return h(
      'div.tile' + (blank ? '.blank' : '') + cls,
      h('span.l', ch === '?' ? '' : ch.toUpperCase()),
      blank ? null : h('span.v', v.values[ch]),
    );
  }

  function lastPlayCells() {
    for (let k = view.m.length - 1; k >= 0; k--) {
      const m = view.m[k];
      if (m.k === 'play') return new Set(m.t.map(t => t[0]));
    }
    return new Set();
  }

  // --- Rendering ---------------------------------------------------------
  function renderBoard() {
    const last = lastPlayCells();
    const badCells = new Set();
    if (badWords.length && pending.size) {
      const res = analyzeMove(v, board, [...pending].map(([i, p]) => [i, p.ch]));
      if (res.ok) for (const w of res.words) if (badWords.includes(w.w)) w.cells.forEach(c => badCells.add(c));
    }
    for (let i = 0; i < CELLS; i++) {
      const c = cells[i], ch = board[i], p = pending.get(i);
      const flags = (last.has(i) ? 'L' : '') + (flashCells.has(i) ? 'F' : '') + (badCells.has(i) ? 'X' : '');
      const key = ch ? 'b' + ch + flags : p ? 'p' + p.ch + p.id + flags : 'e' + (cursor?.i === i ? cursor.step : '');
      if (c._key === key) continue;
      c._key = key;
      const prem = PREMIUM[v.layout[i]];
      c.className = 'cell' + (prem ? ' ' + prem[0] : '');
      set(c);
      if (ch) c.append(tileEl(ch, (last.has(i) ? '.last' : '') + (flashCells.has(i) ? '.flash' : '')));
      else if (p) c.append(tileEl(p.ch, '.pending' + (badCells.has(i) ? '.bad' : '')));
      else {
        if (prem) c.append(h('span.lbl', prem[1]));
        if (cursor?.i === i) c.append(h('span.cursor', cursor.step === 1 ? '→' : '↓'));
      }
    }
  }

  function renderRack() {
    const used = pendingIds();
    const tiles = rack.filter(t => !used.has(t.id));
    set(rackEl, 
      ...tiles.map(t => {
        const e = tileEl(t.ch, (selected === t.id ? '.selected' : '') + (swapMode && swapSel.has(t.id) ? '.chosen' : ''));
        e.dataset.id = t.id;
        return e;
      }),
      ...Array.from({ length: Math.max(0, 7 - tiles.length) }, () => h('div.slot')),
    );
    rackEl.classList.toggle('swapping', swapMode);
  }

  function renderPlayers() {
    const order = [view.me, 1 - view.me];
    order.forEach((seat, k) => {
      const name = seat === view.me ? myName() : view.pl[seat] || 'Waiting…';
      const active = !view.over && view.turn === seat;
      const won = view.over && view.win === seat;
      pills[k].className = 'player' + (active ? ' active' : '') + (won ? ' won' : '');
      set(pills[k], 
        h('span.avatar' + (seat === view.me ? '.mine' : ''), initial(name)),
        h('span.pinfo', h('span.pname', seat === view.me ? 'You' : name), h('span.pscore', String(view.s[seat]))),
      );
    });
  }

  function renderStatus() {
    let text, extra = null;
    if (view.over) {
      const diff = Math.abs(view.s[0] - view.s[1]);
      if (view.end?.why === 'resign') text = view.win === view.me ? `${oppName()} resigned. You win!` : 'You resigned.';
      else if (view.win === 2) text = "It's a tie!";
      else text = view.win === view.me ? `You won by ${diff}! 🎉` : `${oppName()} won by ${diff}.`;
    } else if (source.thinking) text = `${oppName()} is thinking…`;
    else if (view.turn === view.me) text = 'Your turn';
    else if (!view.pl[1 - view.me]) text = 'Waiting for your friend to join';
    else text = `${oppName()}'s turn`;
    if (source.kind === 'online' && view.jk && !view.pl[1]) {
      extra = h('button.chip.primary', { onclick: () => shareInvite(view) }, 'Share invite');
    }
    set(status, 
      h('span.status-text' + (myTurn() ? '.go' : ''), text),
      extra,
      h('span.bag', { title: 'Tiles left in the bag' }, h('span.bag-icon'), `${view.bag} left`),
    );
  }

  function renderPreview() {
    playScore = null;
    if (!pending.size || swapMode) return (preview.hidden = true);
    const res = analyzeMove(v, board, [...pending].map(([i, p]) => [i, p.ch]));
    if (!res.ok) return (preview.hidden = true);
    const d = dictNow();
    const bad = d ? res.words.filter(w => !d.has(w.w)) : [];
    const end = res.words[0].cells[res.words[0].cells.length - 1];
    const col = end % N, row = Math.floor(end / N);
    preview.style.left = ((col + 1) / N) * 100 + '%';
    preview.style.top = (row / N) * 100 + '%';
    preview.className = 'preview' + (d ? (bad.length ? ' bad' : ' good') : '') + (col >= N - 2 ? ' flip' : '');
    preview.textContent = String(res.score);
    preview.hidden = false;
    playScore = res.score;
  }

  function renderActions() {
    const b = (label, onclick, opts = {}) => h('button' + (opts.cls || ''), { onclick, disabled: opts.disabled || busy, 'aria-label': opts.aria }, label);
    if (view.over) {
      set(actions, b('Games', () => go('/words')), b('Rematch', rematch, { cls: '.primary' }));
      return;
    }
    if (swapMode) {
      set(actions, 
        b('Cancel', () => {
          swapMode = false;
          swapSel.clear();
          changed();
        }),
        b(swapSel.size ? `Swap ${swapSel.size}` : 'Pick tiles', doSwap, { cls: '.primary', disabled: !swapSel.size }),
      );
      return;
    }
    const canSwap = myTurn() && view.bag >= Math.max(v.swapMin, 1);
    set(actions, 
      pending.size ? b('Recall', recall) : b('Shuffle', shuffle),
      b('Swap', startSwap, { disabled: !canSwap }),
      b('Pass', doPass, { disabled: !myTurn() }),
      b(playScore != null ? `Play ${playScore}` : 'Play', play, { cls: '.primary.play', disabled: !myTurn() || !pending.size }),
    );
  }

  function describe(m) {
    const who = m.p === view.me ? 'You' : view.pl[m.p] || 'Friend';
    if (m.k === 'play') return [who, m.w.join(', '), '+' + m.s];
    if (m.k === 'swap') return [who, `swapped ${m.n} tile${m.n === 1 ? '' : 's'}`, ''];
    if (m.k === 'pass') return [who, 'passed', ''];
    return [who, 'resigned', ''];
  }

  function renderPanel() {
    const online = source.kind === 'online';
    const seen = local.get('wns.chat.' + view.id, 0);
    const unread = online && tab !== 'chat' ? view.chat.length - seen : 0;
    if (tab === 'chat') local.set('wns.chat.' + view.id, view.chat.length);
    const tabs = h(
      'div.tabs',
      h('button' + (tab === 'moves' ? '.on' : ''), { onclick: () => ((tab = 'moves'), renderPanel()) }, 'Moves'),
      online && h('button' + (tab === 'chat' ? '.on' : ''), { onclick: () => ((tab = 'chat'), renderPanel()) }, 'Chat', unread > 0 && h('span.badge', String(unread))),
    );
    let body;
    if (tab === 'chat' && online) {
      const list = h(
        'div.chat-list',
        view.chat.length ? view.chat.map(c => h('div.msg' + (c.p === view.me ? '.mine' : ''), h('span', c.m), h('time', timeAgo(c.at)))) : h('p.muted.small.center', 'Say hi 👋'),
      );
      const input = h('input', { type: 'text', maxLength: 200, placeholder: 'Message', enterKeyHint: 'send', 'aria-label': 'Message' });
      const send = async e => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        try {
          await source.chat(text);
        } catch (err) {
          toast(err.message);
          input.value = text;
        }
        input.focus();
      };
      body = h('div.chat', list, h('form.chat-form', { onsubmit: send }, input, h('button.primary', 'Send')));
      requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
    } else {
      const moves = [...view.m].reverse();
      body = h(
        'ol.moves',
        moves.length
          ? moves.map(m => {
              const [who, what, pts] = describe(m);
              return h(
                'li' + (m.k === 'play' ? '.tap' : ''),
                { onclick: () => m.k === 'play' && flash(m.t.map(t => t[0])) },
                h('span.who' + (m.p === view.me ? '.mine' : ''), who),
                h('span.what', what),
                h('span.pts', pts),
              );
            })
          : h('li.muted.small', 'No moves yet.'),
      );
    }
    set(panel, tabs, body);
  }

  function renderAll() {
    if (!view) return;
    renderPlayers();
    renderStatus();
    renderPreview();
    renderBoard();
    renderRack();
    renderActions();
    renderPanel();
  }

  const changed = () => {
    renderPreview();
    renderBoard();
    renderRack();
    renderActions();
  };

  function flash(list) {
    flashCells = new Set(list);
    renderBoard();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashCells = new Set();
      renderBoard();
    }, 1600);
  }

  // --- State sync ----------------------------------------------------------
  function syncRack() {
    const want = [...(view.r || '')];
    const next = [];
    for (const t of rack) {
      const k = want.indexOf(t.ch);
      if (k >= 0) {
        want.splice(k, 1);
        next.push(t);
      }
    }
    for (const ch of want) next.push({ id: ++uid, ch });
    const ids = new Set(next.map(t => t.id));
    for (const [i, p] of pending) if (!ids.has(p.id)) pending.delete(i);
    if (!ids.has(selected)) selected = null;
    rack = next;
  }

  function load() {
    view = source.view;
    if (!view) return;
    v = variant(view.v);
    boardEl.className = 'board v-' + view.v;
    board = boardArray(view.b);
    for (const i of [...pending.keys()]) if (board[i]) pending.delete(i);
    placeOrder = placeOrder.filter(i => pending.has(i));
    syncRack();
  }

  const offChange = source.onChange(info => {
    if (!alive) return;
    if (info.kind === 'move' && info.mine) {
      rack = rack.filter(t => !committing.has(t.id));
      committing = new Set();
      pending.clear();
      placeOrder = [];
      badWords = [];
      swapMode = false;
      swapSel.clear();
    }
    load();
    renderAll();
    if (info.kind === 'move' && !info.mine && info.move?.k === 'play') {
      flash(info.move.t.map(t => t[0]));
      navigator.vibrate?.(20);
    }
    if (view?.over) gameOver();
  });

  // --- Moves ---------------------------------------------------------------
  async function play() {
    if (!myTurn() || !pending.size || busy) return;
    const tiles = [...pending].map(([i, p]) => [i, p.ch]);
    // Check locally first: saves a round trip for obvious mistakes.
    const res = analyzeMove(v, board, tiles);
    if (!res.ok) return toast(res.error);
    const d = dictNow();
    if (d) {
      const bad = res.words.filter(w => !d.has(w.w)).map(w => w.w);
      if (bad.length) {
        badWords = bad;
        renderBoard();
        return toast(bad.length === 1 ? `${bad[0]} isn't in the word list.` : `${bad.join(', ')} aren't in the word list.`);
      }
    }
    await submit({ k: 'play', t: tiles }, pendingIds());
  }

  async function submit(move, ids = new Set()) {
    busy = true;
    committing = ids;
    renderActions();
    let r;
    try {
      r = await source.submit(move);
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    busy = false;
    if (!alive) return;
    if (!r.ok) {
      committing = new Set();
      badWords = r.bad || [];
      toast(r.error);
      changed();
    }
  }

  function recall() {
    pending.clear();
    placeOrder = [];
    badWords = [];
    changed();
  }

  function shuffle() {
    const free = rack.filter(t => !pendingIds().has(t.id));
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }
    rack = [...free, ...rack.filter(t => pendingIds().has(t.id))];
    renderRack();
    rackEl.classList.remove('shuffled');
    void rackEl.offsetWidth;
    rackEl.classList.add('shuffled');
  }

  function startSwap() {
    recall();
    swapMode = true;
    selected = null;
    changed();
    toast('Tap the tiles you want to swap.');
  }

  function doSwap() {
    const letters = rack.filter(t => swapSel.has(t.id)).map(t => t.ch);
    submit({ k: 'swap', t: letters }, new Set(swapSel));
  }

  async function doPass() {
    if (await confirm('Pass?', 'Skip your turn without playing.', 'Pass')) submit({ k: 'pass' });
  }

  async function resign() {
    if (await confirm('Resign?', `${oppName()} will win this game.`, 'Resign', true)) submit({ k: 'resign' });
  }

  async function rematch() {
    try {
      const id = await source.rematch();
      go(source.kind === 'bot' ? '/words/bot/' + id : '/words/' + id);
    } catch (e) {
      toast(e.message);
    }
  }

  function gameOver() {
    const key = 'wns.over.' + view.id;
    if (local.get(key)) return;
    local.set(key, 1);
    const won = view.win === view.me, tie = view.win === 2;
    const lines = [];
    if (view.end?.why === 'out') lines.push(`${view.end.adj[view.me] > 0 ? 'You' : oppName()} used every tile.`);
    if (view.end?.why === 'passes') lines.push('Too many passes in a row ended the game.');
    if (view.rr && view.end?.why !== 'resign') {
      const left = view.rr[1 - view.me];
      if (left) lines.push(`${oppName()} had ${left.split('').join(' ')} left.`);
    }
    const s = sheet(
      tie ? "It's a tie!" : won ? 'You won! 🎉' : `${oppName()} won`,
      h(
        'div.stack.center',
        h('div.final', h('div', h('b', String(view.s[view.me])), h('span', 'You')), h('div.vs', '–'), h('div', h('b', String(view.s[1 - view.me])), h('span', oppName()))),
        lines.map(l => h('p.muted.small', l)),
        h('div.row.end', h('button', { onclick: () => s.close() }, 'Close'), h('button.primary', { onclick: () => (s.close(), rematch()) }, 'Rematch')),
      ),
    );
  }

  function unseenTiles() {
    const left = { ...v.counts };
    for (const ch of board) if (ch) left[ch >= 'a' ? '?' : ch]--;
    for (const ch of view.r) left[ch]--;
    return h(
      'div.stack',
      h('p.muted.small', `Tiles you haven't seen yet (in the bag or on ${oppName()}'s rack).`),
      h('div.unseen', Object.entries(left).map(([ch, n]) => h('div' + (n ? '' : '.none'), h('b', ch === '?' ? '␣' : ch), h('span', String(Math.max(0, n)))))),
    );
  }

  function openMenu() {
    if (!view) return;
    const item = (label, fn, cls = '') => h('button.menu-item' + cls, { onclick: () => (s.close(), fn()) }, label);
    const s = sheet(
      'Game',
      h(
        'div.menu',
        source.kind === 'online' && view.jk && !view.pl[1] && item('Share invite link', () => shareInvite(view)),
        item('Tiles left', () => sheet('Tiles left', unseenTiles())),
        item('How to play', howToPlay),
        view.over && item('Rematch', rematch),
        !view.over && item('Resign', resign, '.danger'),
        source.kind === 'bot' && view.over && item('Delete game', () => (source.remove(), go('/words'))),
      ),
    );
  }

  // --- Placing tiles -------------------------------------------------------
  function pickLetter() {
    return new Promise(resolve => {
      let done = false;
      const s = sheet(
        'Blank tile',
        h(
          'div.letters',
          [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(L =>
            h('button', {
              onclick: () => {
                done = true;
                s.close();
                resolve(L);
              },
            }, L),
          ),
        ),
        { onClose: () => !done && resolve(null) },
      );
    });
  }

  async function place(id, i) {
    const t = rack.find(t => t.id === id);
    if (!t || board[i] || pending.has(i) || pendingIds().has(id)) return;
    let ch = t.ch;
    if (ch === '?') {
      const L = await pickLetter();
      if (!L || board[i] || pending.has(i)) return;
      ch = L.toLowerCase();
    }
    pending.set(i, { id, ch });
    placeOrder.push(i);
    badWords = [];
    selected = null;
    changed();
  }

  function unplace(i) {
    pending.delete(i);
    placeOrder = placeOrder.filter(x => x !== i);
    badWords = [];
  }

  function cellTap(i) {
    if (!view || view.over || swapMode || board[i]) return;
    if (pending.has(i)) {
      unplace(i);
      return changed();
    }
    if (selected != null) return place(selected, i);
    if (hoverDevice) {
      cursor = cursor?.i === i ? { i, step: cursor.step === 1 ? N : 1 } : { i, step: 1 };
      renderBoard();
    }
  }

  function rackTap(id) {
    if (swapMode) {
      swapSel.has(id) ? swapSel.delete(id) : swapSel.add(id);
      return changed();
    }
    if (cursor && !board[cursor.i] && !pending.has(cursor.i)) {
      const t = rack.find(t => t.id === id);
      if (t) return typeTile(t, t.ch === '?' ? null : t.ch);
    }
    selected = selected === id ? null : id;
    renderRack();
  }

  function reorder(id, x) {
    const others = [...rackEl.querySelectorAll('.tile')].filter(e => +e.dataset.id !== id);
    let before = null;
    for (const e of others) {
      const r = e.getBoundingClientRect();
      if (x < r.left + r.width / 2) {
        before = +e.dataset.id;
        break;
      }
    }
    const k = rack.findIndex(t => t.id === id);
    if (k < 0) return;
    const [t] = rack.splice(k, 1);
    const at = before == null ? rack.length : rack.findIndex(t => t.id === before);
    rack.splice(at < 0 ? rack.length : at, 0, t);
  }

  function hit(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target) return null;
    const cell = target.closest('.cell');
    if (cell && boardEl.contains(cell)) return { kind: 'cell', i: +cell.dataset.i };
    if (target.closest('.rack')) return { kind: 'rack' };
    return null;
  }

  function drop(from, to, x) {
    if (to?.kind === 'cell' && !board[to.i]) {
      if (from.kind === 'rack') {
        if (pending.has(to.i)) unplace(to.i);
        place(from.id, to.i);
        return;
      }
      if (from.i !== to.i) {
        const a = pending.get(from.i), b = pending.get(to.i);
        pending.set(to.i, a);
        if (b) pending.set(from.i, b);
        else pending.delete(from.i);
        placeOrder = placeOrder.map(c => (c === from.i ? to.i : c === to.i && b ? from.i : c));
      }
    } else if (to?.kind === 'rack') {
      const id = from.kind === 'rack' ? from.id : pending.get(from.i).id;
      if (from.kind === 'cell') unplace(from.i);
      reorder(id, x);
    } else if (from.kind === 'cell') unplace(from.i);
    changed();
  }

  function onPointerDown(e, from) {
    if (e.button > 0 || !view) return;
    const tile = from.kind === 'rack' ? e.target.closest('.tile') : pending.has(from.i) ? cells[from.i].firstChild : null;
    const canDrag = !!tile && !view.over && !swapMode;
    if (tile) e.preventDefault();
    const sx = e.clientX, sy = e.clientY, lift = e.pointerType === 'touch' ? -34 : 0;
    let dragging = false, ghost = null, over = null, gw = 0, gh = 0;

    const setOver = c => {
      if (over === c) return;
      over?.classList.remove('drop');
      over = c;
      over?.classList.add('drop');
    };
    const move = ev => {
      if (!canDrag) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        dragging = true;
        const r = tile.getBoundingClientRect();
        const size = Math.max(r.width, 40) * (ev.pointerType === 'touch' ? 1.15 : 1);
        ghost = tile.cloneNode(true);
        ghost.classList.add('ghost');
        ghost.style.width = ghost.style.height = size + 'px';
        ghost.style.fontSize = size * 0.55 + 'px';
        gw = gh = size;
        document.body.append(ghost);
        tile.classList.add('dragging');
        selected = null;
      }
      ghost.style.transform = `translate(${ev.clientX - gw / 2}px, ${ev.clientY - gh / 2 + lift}px)`;
      const t = hit(ev.clientX, ev.clientY + lift);
      setOver(t?.kind === 'cell' && !board[t.i] ? cells[t.i] : null);
    };
    const end = (ev, cancelled) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setOver(null);
      if (!dragging) {
        if (!cancelled) from.kind === 'rack' ? rackTap(from.id) : cellTap(from.i);
        return;
      }
      ghost.remove();
      tile.classList.remove('dragging');
      if (cancelled) return changed();
      drop(from, hit(ev.clientX, ev.clientY + lift), ev.clientX);
    };
    const up = ev => end(ev, false);
    const cancel = ev => end(ev, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  rackEl.addEventListener('pointerdown', e => {
    const t = e.target.closest('.tile');
    if (t) onPointerDown(e, { kind: 'rack', id: +t.dataset.id });
  });
  boardEl.addEventListener('pointerdown', e => {
    const c = e.target.closest('.cell');
    if (c) onPointerDown(e, { kind: 'cell', i: +c.dataset.i });
  });

  // --- Keyboard ------------------------------------------------------------
  function typeTile(t, letter) {
    const place1 = L => {
      const i = cursor.i;
      pending.set(i, { id: t.id, ch: t.ch === '?' ? L.toLowerCase() : L });
      placeOrder.push(i);
      badWords = [];
      // Move the cursor past any tiles already on the board.
      let n = i + cursor.step;
      const inLine = j => j < CELLS && (cursor.step === N || Math.floor(j / N) === Math.floor(i / N));
      while (inLine(n) && (board[n] || pending.has(n))) n += cursor.step;
      if (inLine(n)) cursor = { ...cursor, i: n };
      changed();
    };
    if (letter) place1(letter);
    else pickLetter().then(L => L && place1(L));
  }

  function onKey(e) {
    if (!view || view.over || swapMode || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea') || document.querySelector('.overlay')) return;
    const used = pendingIds();
    if (/^[a-z]$/i.test(e.key) && cursor) {
      const L = e.key.toUpperCase();
      if (board[cursor.i] || pending.has(cursor.i)) return;
      const t = rack.find(t => !used.has(t.id) && t.ch === L) || rack.find(t => !used.has(t.id) && t.ch === '?');
      if (!t) return toast(`No ${L} on your rack.`, 1200);
      e.preventDefault();
      typeTile(t, L);
    } else if (e.key === 'Backspace') {
      const i = placeOrder[placeOrder.length - 1];
      if (i == null) return;
      e.preventDefault();
      unplace(i);
      cursor = { i, step: cursor?.step || 1 };
      changed();
    } else if (e.key === 'Enter' && pending.size) {
      e.preventDefault();
      play();
    } else if (e.key === 'Escape') {
      cursor = null;
      recall();
    } else if (cursor && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -N, ArrowDown: N }[e.key];
      const n = cursor.i + d;
      if (n >= 0 && n < CELLS && (Math.abs(d) === N || Math.floor(n / N) === Math.floor(cursor.i / N))) {
        cursor = { i: n, step: Math.abs(d) === N ? N : 1 };
        renderBoard();
      }
    }
  }
  document.addEventListener('keydown', onKey);

  // --- Start -----------------------------------------------------------------
  const nudge = source.kind === 'online' ? h('div.nudge-slot') : null;
  if (nudge) el.insertBefore(nudge, panel);

  load();
  if (view) renderAll();
  else set(status, h('span.status-text', 'Loading…'));
  source
    .refresh()
    .then(() => {
      if (!alive) return;
      load();
      renderAll();
      if (view?.over) gameOver();
      if (nudge && view && !view.over) pushNudge(nudge, oppName());
    })
    .catch(e => {
      if (!alive) return;
      if (!view) {
        set(el, h('div.empty', h('p', e.status === 404 ? "This game doesn't exist anymore." : e.message), h('button.primary', { onclick: () => go('/words') }, 'Back to games')));
      } else toast(e.message);
    });
  if (source.kind === 'online') loadDictIfCached().then(d => d && alive && view && changed());

  return () => {
    alive = false;
    offChange();
    source.close();
    ro.disconnect();
    clearTimeout(flashTimer);
    document.removeEventListener('keydown', onKey);
    document.querySelectorAll('.ghost').forEach(g => g.remove());
  };
}
