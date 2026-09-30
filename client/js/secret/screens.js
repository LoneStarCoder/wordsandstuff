// Secret Word screens: lobby, friend challenges, daily word and practice.
import { h, set, local, sheet, toast, timeAgo, initial } from '../dom.js';
import { api, me, ensureMe, live } from '../net.js';
import { go } from '../nav.js';
import { feedback, outcome, dailyAnswer, emojiGrid, MAX_GUESSES } from '../../../shared/secret/game.js';
import { guessBoard } from './board.js';
import { loadFive } from './words.js';
import { copyText } from '../rush/common.js';
import { today } from '../rush/sources.js';
import { pushNudge } from '../push.js';

const share = text => (navigator.share ? navigator.share({ text }).catch(() => {}) : copyText(text, 'Result'));
const tries = t => (t ? `${t}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`);

function inviteSheet(c) {
  const url = `${location.origin}/join/${c.id}/${c.jk}`;
  sheet(
    'Send your secret word',
    h(
      'div.stack',
      h('p.muted', `Send this link to a friend. They get ${MAX_GUESSES} guesses to crack `, h('b', c.word), '.'),
      h('input.link', { type: 'text', readOnly: true, value: url, onfocus: e => e.target.select(), 'aria-label': 'Invite link' }),
      h(
        'div.row.end',
        h('button' + (navigator.share ? '' : '.primary'), { onclick: () => copyText(url) }, 'Copy link'),
        navigator.share && h('button.primary', { onclick: () => navigator.share({ title: 'Words and Stuff', text: 'I picked a secret word. Bet you can’t crack it!', url }).catch(() => {}) }, 'Share…'),
      ),
    ),
  );
}

// Pick a word for a friend. `back` sends it straight to the other player of
// an earlier challenge instead of making an invite link.
export async function createChallenge(back = null, toName = null) {
  if (!(await ensureMe())) return;
  const input = h('input.sw-input', { type: 'text', maxLength: 5, placeholder: 'WORD', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, 'aria-label': 'Secret word' });
  const btn = h('button.primary.block', { onclick: submit }, toName ? `Send to ${toName}` : 'Create challenge');
  const s = sheet(
    toName ? `A word for ${toName}` : 'Pick a secret word',
    h('div.stack', h('p.muted', 'Any real 5-letter word. Tricky ones are more fun!'), input, btn, h('p.small.muted', 'Only you will see the word until the guessing is over.')),
  );
  input.addEventListener('input', () => (input.value = input.value.replace(/[^a-z]/gi, '').toUpperCase()));
  input.addEventListener('keydown', e => e.key === 'Enter' && submit());
  async function submit() {
    const word = input.value;
    if (word.length !== 5) return toast('Pick a 5-letter word.');
    btn.disabled = true;
    try {
      const { allowed } = await loadFive();
      if (!allowed.has(word)) throw new Error(`${word} isn't in the word list.`);
      const res = await api('POST', 'secret', { word, back });
      s.close();
      go('/secret/' + res.data.id);
      if (!back) inviteSheet(res.data);
      else toast(`Sent to ${toName}!`);
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
    }
  }
}

// --- Lobby ---------------------------------------------------------------------

export function secretLobby(root) {
  let alive = true;
  let list = me.token ? local.get('wns.slist') : null;
  const daily = h('div');
  const lists = h('div.lists');
  const nudge = h('div.nudge-slot');
  root.append(
    h(
      'div.page.lobby',
      h('header.top', h('a.icon-btn', { href: '/', 'aria-label': 'Home' }, '‹'), h('h1', 'Secret Word')),
      daily,
      h(
        'div.new-game',
        h('button.big.primary', { onclick: () => createChallenge() }, h('b', 'Challenge a friend'), h('span', 'Pick a word for them')),
        h('a.big.button', { href: '/secret/practice' }, h('b', 'Practice'), h('span', 'Unlimited · offline')),
      ),
      nudge,
      lists,
      h('footer.foot', h('button.link', { onclick: rules }, 'How to play')),
    ),
  );

  function render() {
    const d = local.get('wns.sdaily.' + today());
    const res = d && outcome(d.g, d.a || '');
    set(
      daily,
      h(
        'a.daily-card' + (d?.done ? '.done' : ''),
        { href: '/secret/daily' },
        h('div.daily-art', [...'WORD'].map((c, i) => h('span.tile' + (i === 1 ? '.sw-g' : i === 3 ? '.sw-y' : ''), h('span.l', c)))),
        h('div.card-body', h('b', 'Daily word'), h('span.small', d?.done ? `Today: ${res?.solved ? tries(res.tries) : 'missed'}${d.sent ? '' : ' · tap to add to the leaderboard'}` : 'Same word for everyone today')),
        h('span.daily-side', h('span.chev', d?.done ? 'See' : 'Play')),
      ),
    );
    const all = list?.data || [];
    const mine = all.filter(c => !c.done && c.role === 'guesser');
    const waiting = all.filter(c => !c.done && c.role === 'setter');
    const done = all.filter(c => c.done).slice(0, 20);
    const row = c => {
      const other = c.role === 'setter' ? c.to : c.from;
      let sub;
      if (!c.done) sub = c.role === 'guesser' ? (c.g.length ? `Your turn · ${c.g.length}/${MAX_GUESSES} guesses` : `${other} sent you a word!`) : !c.to ? `Invite not accepted yet · ${c.word}` : `${other} is guessing ${c.word} · ${c.g.length}/${MAX_GUESSES}`;
      else sub = c.role === 'guesser' ? (c.solved ? `You cracked ${c.word} in ${c.tries}` : `You missed ${c.word}`) : c.solved ? `${other} cracked ${c.word} in ${c.tries}` : `${other} missed ${c.word}`;
      return h(
        'div.game-row' + (c.role === 'guesser' && !c.done ? '.mine' : ''),
        h('a.row-main', { href: '/secret/' + c.id }, h('span.avatar', initial(other || '?')), h('span.info', h('b', other || 'Waiting for a friend'), h('span.sub', sub)), h('span.meta', h('span.mini-fb', c.fb.slice(-1).map(f => h('span', emojiGrid([f])))), h('time', timeAgo(c.u)))),
        !c.to && c.jk ? h('button.chip', { onclick: () => inviteSheet(c) }, 'Share') : null,
      );
    };
    const section = (title, items) => (items.length ? h('section', h('h2', title, h('span.count', String(items.length))), items.map(row)) : null);
    set(
      lists,
      records(all),
      section('Your turn to guess', mine),
      section('Waiting on friends', waiting),
      section('Finished', done),
      !all.length && h('div.empty', h('p', 'No challenges yet.'), h('p.muted.small', 'Pick a secret word and dare a friend to crack it.')),
    );
  }

  // Head-to-head: average guesses when each of you cracked the other's words.
  function records(all) {
    const by = {};
    for (const c of all.filter(x => x.done && x.to)) {
      const other = c.role === 'setter' ? c.to : c.from;
      const r = (by[other] ||= { me: [], them: [] });
      (c.role === 'guesser' ? r.me : r.them).push(c.solved ? c.tries : 7);
    }
    const avg = a => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : '–');
    const names = Object.keys(by);
    if (!names.length) return null;
    return h(
      'section.records',
      h('h2', 'Head to head'),
      h('p.small.muted', 'Average guesses to crack each other’s words (lower is better, a miss counts as 7).'),
      names.map(n => h('div.record', h('span.avatar', initial(n)), h('b', n), h('span', `You ${avg(by[n].me)}`), h('span.muted', `${n} ${avg(by[n].them)}`))),
    );
  }

  async function refresh() {
    if (!me.token) return;
    try {
      const res = await api('GET', 'secret', null, { etag: list?.etag, quiet: !!list });
      if (res.status !== 304) {
        list = { etag: res.etag, data: res.data };
        local.set('wns.slist', list);
      }
    } catch {}
    if (alive) render();
  }

  render();
  refresh();
  if (me.token) {
    live.connect();
    if ((list?.data || []).some(c => !c.done && c.to)) pushNudge(nudge);
  }
  const off = live.on(msg => ['up', 'resync'].includes(msg.t) && refresh());
  return () => {
    alive = false;
    off();
  };
}

export function rules() {
  sheet(
    'How to play Secret Word',
    h(
      'div.rules',
      h('p', `Guess the 5-letter word in ${MAX_GUESSES} tries. After each guess the tiles show how close you are:`),
      h('div.sw-legend', h('span.sw-tile.s-g', 'G'), ' right letter, right spot'),
      h('div.sw-legend', h('span.sw-tile.s-y', 'Y'), ' in the word, wrong spot'),
      h('div.sw-legend', h('span.sw-tile.s-x', 'X'), ' not in the word'),
      h('ul', h('li', 'Challenge a friend: pick any real 5-letter word and send them the link. You can watch their guesses come in.'), h('li', 'When they’re done, they can send you one back. Your head-to-head record keeps score.'), h('li', 'The daily word is the same for everyone, with a leaderboard.')),
    ),
    { wide: true },
  );
}

// --- A friend challenge -----------------------------------------------------------

export function challengeScreen(root, id) {
  let alive = true, board = null;
  let cached = local.get('wns.sw.' + id);
  let view = cached?.view || null, etag = cached?.etag || null;
  const el = h('div.page.sw-page');
  root.append(el);

  const save = (v, tag) => {
    view = v;
    etag = tag || `"${v.ver}.${me.id}"`;
    local.set('wns.sw.' + id, { view, etag });
  };

  async function refresh() {
    try {
      const res = await api('GET', 'secret/' + id, null, { etag: view && etag, quiet: !!view });
      if (res.status !== 304) {
        save(res.data, res.etag);
        if (alive) render();
      }
    } catch (e) {
      if (!view && alive) set(el, h('div.empty', h('p', e.status === 404 ? "This challenge doesn't exist anymore." : e.message), h('a.button.primary', { href: '/secret' }, 'Back')));
    }
  }

  async function render() {
    if (!view) return set(el, h('p.muted.center', 'Loading…'));
    board?.destroy();
    const v = view;
    const other = v.role === 'setter' ? v.to : v.from;
    const rows = v.g.map((g, i) => ({ g, fb: v.fb[i] }));
    let status, actions = [];
    if (v.role === 'guesser') {
      status = v.done ? (v.solved ? `You cracked it in ${v.tries}! 🎉` : `Out of guesses — it was ${v.word}`) : `Crack ${other}'s secret word`;
      if (v.done) {
        actions.push(h('button.primary', { onclick: () => share(`Words and Stuff · Secret Word\nI cracked ${other}'s word in ${tries(v.tries)}\n${emojiGrid(v.fb)}`) }, 'Share'));
        actions.push(v.back ? h('a.button', { href: '/secret/' + v.back }, 'See the word you sent') : h('button', { onclick: () => createChallenge(v.id, other) }, `Send ${other} one back`));
      }
    } else {
      status = !v.to ? 'Waiting for a friend to take your challenge' : v.done ? (v.solved ? `${other} cracked it in ${v.tries}` : `${other} couldn't crack it! 😈`) : `${other} is guessing… ${v.g.length}/${MAX_GUESSES}`;
      if (!v.to && v.jk) actions.push(h('button.primary', { onclick: () => inviteSheet(v) }, 'Share invite'));
      if (v.done) actions.push(h('button.primary', { onclick: () => createChallenge(v.id, other) }, `New word for ${other}`));
    }
    const guessing = v.role === 'guesser' && !v.done;
    const allowed = guessing ? (await loadFive().catch(() => null))?.allowed : null;
    if (!alive) return;
    board = guessBoard({
      rows,
      allowed,
      readOnly: !guessing,
      submit: async g => {
        const res = await api('POST', `secret/${id}/guess`, { g });
        save(res.data);
        setTimeout(() => alive && render(), res.data.done ? 1400 : 0);
        return { fb: res.data.fb[res.data.fb.length - 1] };
      },
    });
    set(
      el,
      h('header.top', h('a.icon-btn', { href: '/secret', 'aria-label': 'Back' }, '‹'), h('h1', v.role === 'setter' ? `Your word for ${other || 'a friend'}` : `${other}'s word`)),
      v.role === 'setter' && h('div.sw-secret', 'Your word: ', h('b', v.word)),
      h('p.sw-status' + (v.done ? '.done' : ''), status),
      board.el,
      actions.length && h('div.row.center-row.sw-actions', actions),
    );
  }

  render();
  refresh();
  live.connect();
  const off = live.on(msg => (msg.t === 'resync' || (msg.t === 'up' && msg.id === id && msg.ver !== view?.ver)) && refresh());
  return () => {
    alive = false;
    off();
    board?.destroy();
  };
}

// --- Daily word ------------------------------------------------------------------

export function secretDaily(root) {
  let alive = true, board = null;
  const day = today();
  const key = 'wns.sdaily.' + day;
  const el = h('div.page.sw-page');
  const lb = h('div.leaders');
  root.append(el);

  const state = () => local.get(key) || { g: [] };

  async function post() {
    const st = state();
    const { data } = await api('POST', 'sdaily/' + day, { g: st.g });
    local.set(key, { ...state(), sent: true });
    local.set('wns.sdailyTable.' + day, data);
    return data;
  }

  function renderBoard(rows, note) {
    const st = state();
    if (!me.token || !st.sent) {
      return set(lb, h('h2', "Today's scores"), h('p.muted.small', 'Add your result to see how everyone else did.'), h('button.primary', { onclick: addScore }, 'Add my result'));
    }
    const mine = rows?.findIndex(x => x.me) ?? -1;
    set(
      lb,
      h('div.leaders-head', h('h2', "Today's scores"), h('button.link', { onclick: refreshBoard }, 'Refresh')),
      mine >= 0 && h('p.small.muted', `You're #${mine + 1} of ${rows.length}`),
      note && h('p.small.muted', note),
      rows ? h('ol.leader-list', rows.map((x, k) => h('li' + (x.me ? '.me' : ''), h('span.rank', x.t ? String(k + 1) : '–'), h('span.who', x.me ? `${x.n} (you)` : x.n), h('span.mini-fb', x.fb.map(f => h('span', emojiGrid([f])))), h('span.pts', h('b', tries(x.t)))))) : h('p.muted.small', 'Loading…'),
    );
  }

  async function addScore() {
    if (!(await ensureMe('Pick a name to put your result on today’s leaderboard.'))) return;
    try {
      renderBoard(await post());
    } catch (e) {
      toast(e.message);
    }
  }

  async function refreshBoard() {
    try {
      const st = state();
      if (st.sent) {
        const { data } = await api('GET', 'sdaily/' + day, null, { quiet: true });
        local.set('wns.sdailyTable.' + day, data);
        renderBoard(data);
      } else renderBoard(await post());
    } catch (e) {
      renderBoard(local.get('wns.sdailyTable.' + day), e.status === 0 ? 'Offline — showing saved scores.' : e.message);
    }
  }

  async function start() {
    let words;
    try {
      words = await loadFive();
    } catch (e) {
      return set(el, h('div.empty', h('p', e.message), h('a.button.primary', { href: '/secret' }, 'Back')));
    }
    if (!alive) return;
    const answer = dailyAnswer(day, words.answers);
    const st = state();
    const rows = st.g.map(g => ({ g, fb: feedback(g, answer) }));
    const finished = () => {
      const s = state();
      const res = outcome(s.g, answer);
      const fbs = s.g.map(g => feedback(g, answer));
      const text = `Words and Stuff · Daily Secret Word ${day.slice(5).replace('-', '/')}\n${tries(res.tries)}\n${emojiGrid(fbs)}\n${location.origin}/secret/daily`;
      set(
        el,
        h('header.top', h('a.icon-btn', { href: '/secret', 'aria-label': 'Back' }, '‹'), h('h1', 'Daily word')),
        h('p.sw-status.done', res.solved ? `Got it in ${res.tries}! 🎉` : `The word was ${answer}`),
        (board = guessBoard({ rows: s.g.map(g => ({ g, fb: feedback(g, answer) })), readOnly: true })).el,
        h('div.row.center-row.sw-actions', h('button.primary', { onclick: () => share(text) }, 'Share result'), h('a.button', { href: '/secret/practice' }, 'Practice')),
        lb,
      );
      renderBoard(local.get('wns.sdailyTable.' + day));
      if (me.token) refreshBoard();
      else if (!s.sent) addScore();
    };
    if (outcome(st.g, answer).done) return finished();
    board = guessBoard({
      rows,
      allowed: words.allowed,
      submit: async g => {
        const s = state();
        s.g.push(g);
        s.a = answer;
        s.done = outcome(s.g, answer).done;
        local.set(key, s);
        if (s.done) setTimeout(() => alive && (board.destroy(), finished()), 1500);
        return { fb: feedback(g, answer) };
      },
    });
    set(el, h('header.top', h('a.icon-btn', { href: '/secret', 'aria-label': 'Back' }, '‹'), h('h1', 'Daily word')), h('p.sw-status', 'Same word for everyone today'), board.el);
  }
  start();
  return () => {
    alive = false;
    board?.destroy();
  };
}

// --- Practice --------------------------------------------------------------------

export function secretPractice(root) {
  let alive = true, board = null;
  const el = h('div.page.sw-page');
  root.append(el);

  async function round() {
    let words;
    try {
      words = await loadFive();
    } catch (e) {
      return set(el, h('div.empty', h('p', e.message), h('a.button.primary', { href: '/secret' }, 'Back')));
    }
    if (!alive) return;
    let st = local.get('wns.spractice');
    if (!st || st.done) st = { a: words.answers[Math.floor(Math.random() * words.answers.length)], g: [] };
    local.set('wns.spractice', st);
    const stats = local.get('wns.sstats', { played: 0, won: 0, streak: 0, dist: [0, 0, 0, 0, 0, 0] });
    board?.destroy();
    board = guessBoard({
      rows: st.g.map(g => ({ g, fb: feedback(g, st.a) })),
      allowed: words.allowed,
      submit: async g => {
        st.g.push(g);
        const res = outcome(st.g, st.a);
        if (res.done) {
          st.done = true;
          stats.played++;
          if (res.solved) {
            stats.won++;
            stats.streak++;
            stats.dist[res.tries - 1]++;
          } else stats.streak = 0;
          local.set('wns.sstats', stats);
          setTimeout(() => alive && showEnd(res, st.a, stats), 1500);
        }
        local.set('wns.spractice', st);
        return { fb: feedback(g, st.a) };
      },
    });
    set(el, h('header.top', h('a.icon-btn', { href: '/secret', 'aria-label': 'Back' }, '‹'), h('h1', 'Practice')), h('p.sw-status', stats.played ? `Played ${stats.played} · won ${Math.round((stats.won / stats.played) * 100)}% · streak ${stats.streak}` : 'Warm up with random words'), board.el);
  }

  function showEnd(res, answer, stats) {
    const max = Math.max(1, ...stats.dist);
    sheet(
      res.solved ? `Nice — ${res.tries}/${MAX_GUESSES}!` : `It was ${answer}`,
      h(
        'div.stack',
        h('div.sw-dist', stats.dist.map((n, i) => h('div.sw-bar', h('span', String(i + 1)), h('i', { style: { width: Math.max(8, (n / max) * 100) + '%' } }, String(n))))),
        h('p.small.muted', `Played ${stats.played} · won ${Math.round((stats.won / stats.played) * 100)}% · streak ${stats.streak}`),
        h('button.primary.block', { onclick: e => (e.target.closest('.overlay')?.remove(), round()) }, 'Next word'),
      ),
    );
  }

  round();
  return () => {
    alive = false;
    board?.destroy();
  };
}
