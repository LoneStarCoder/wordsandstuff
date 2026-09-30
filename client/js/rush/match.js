// Match overview, round play/recap routes, and the daily board.
import { h, set, toast, sheet, confirm, initial, local } from '../dom.js';
import { go } from '../nav.js';
import { me } from '../net.js';
import { ROUNDS } from '../../../shared/rush/board.js';
import { shareInvite, howToPlay, recapView, copyText } from './common.js';
import { playScreen } from './play.js';
import { Daily, dailyResult, dailyStreak, today } from './sources.js';
import { pushNudge } from '../push.js';

const ROUND_NOTES = ['A double-word tile is hiding on the board.', 'Same rules — keep the pressure on.', 'Final round: find the triple-word tile!'];

function errorPage(el, e, back = '/rush') {
  set(el, h('div.empty', h('p', e.status === 404 ? "This match doesn't exist anymore." : e.message), h('a.button.primary', { href: back }, 'Back to Word Rush')));
}

export function matchScreen(root, match) {
  let alive = true;
  const el = h('div.page.match');
  const nudge = h('div.nudge-slot');
  root.append(el);

  function render() {
    const v = match.view;
    if (!v) return set(el, h('p.muted.center', 'Loading…'));
    const opp = v.pl[1 - v.me];
    const oppName = opp || 'Waiting…';
    const lead = v.tot[v.me] - v.tot[1 - v.me];
    let banner = null;
    if (v.over) {
      const text = v.ff != null ? (v.win === v.me ? `${oppName} left the match. You win!` : 'You left this match.') : v.win === 2 ? "It's a tie!" : v.win === v.me ? 'You won the match! 🎉' : `${oppName} won the match`;
      banner = h('div.banner' + (v.win === v.me ? '.win' : ''), h('b', text), h('button.primary', { onclick: rematch }, 'Rematch'));
    } else if (!opp) {
      banner = h('div.banner', h('span', 'Waiting for a friend to join. You can play your rounds now.'), h('button.primary', { onclick: () => shareInvite(v) }, 'Invite'));
    }

    const cards = Array.from({ length: ROUNDS }, (_, r) => {
      const mine = v.r[r][v.me], theirs = v.r[r][1 - v.me];
      const playable = !v.over && v.next === r;
      const done = mine?.done;
      let status, action = null;
      if (done) {
        status = theirs?.done ? (mine.s > theirs.s ? 'You won this round' : mine.s < theirs.s ? `${oppName} won this round` : 'Tied') : `Waiting for ${oppName}`;
        action = h('a.button', { href: `${match.base}/${r}` }, 'See words');
      } else if (playable) {
        status = mine?.st ? 'In progress — the clock is running!' : theirs?.done ? `${oppName} scored ${theirs.s}. Beat it!` : 'Ready when you are';
        action = h('a.button.primary', { href: `${match.base}/${r}` }, mine?.st ? 'Resume' : 'Play');
      } else status = v.over ? 'Not played' : r === ROUNDS - 1 ? 'Locked · triple-word round' : 'Locked';
      return h(
        'div.round-card' + (playable ? '.next' : '') + (done ? '.done' : ''),
        h('div.rc-num', String(r + 1)),
        h('div.rc-info', h('b', `Round ${r + 1}`), h('span.small.muted', status)),
        h('div.rc-scores', h('span', done ? String(mine.s) : '–'), h('span.muted', theirs?.done ? String(theirs.s) : '–')),
        action,
      );
    });

    set(
      el,
      h('header.top', h('a.icon-btn', { href: '/rush', 'aria-label': 'Back' }, '‹'), h('h1', opp ? `You vs ${opp}` : 'New match'), h('button.icon-btn', { 'aria-label': 'Match menu', onclick: menu }, '⋯')),
      h(
        'div.scoreboard',
        h('div.sb' + (v.over && v.win === v.me ? '.crown' : ''), h('span.avatar.mine', initial(v.pl[v.me] || me.name || 'Y')), h('span.small.muted', 'You'), h('b', String(v.tot[v.me]))),
        h('div.sb-mid', v.over ? 'Final' : lead === 0 ? 'Level' : lead > 0 ? `+${lead}` : String(lead)),
        h('div.sb' + (v.over && v.win === 1 - v.me ? '.crown' : ''), h('span.avatar' + (match.kind === 'bot' ? '.bot' : ''), initial(oppName)), h('span.small.muted', oppName), h('b', String(v.tot[1 - v.me]))),
      ),
      banner,
      nudge,
      h('div.rounds', cards),
      h('p.small.muted.center', match.kind === 'bot' ? 'The bot plays each round alongside you.' : 'You both get the same three boards. Scores show up as you each finish.'),
    );
  }

  function menu() {
    const v = match.view;
    if (!v) return;
    const item = (label, fn, cls = '') => h('button.menu-item' + cls, { onclick: () => (s.close(), fn()) }, label);
    const s = sheet(
      'Match',
      h(
        'div.menu',
        v.jk && !v.pl[1] && item('Share invite link', () => shareInvite(v)),
        item('How to play', howToPlay),
        v.over && item('Rematch', rematch),
        item(v.over ? 'Remove from list' : match.kind === 'bot' ? 'Delete match' : 'Leave match (forfeit)', leave, v.over ? '' : '.danger'),
      ),
    );
  }

  async function leave() {
    const v = match.view;
    if (!v.over && match.kind !== 'bot' && v.pl[1] && !(await confirm('Leave match?', `${v.pl[1 - v.me]} will win.`, 'Leave', true))) return;
    try {
      await match.remove();
      go('/rush');
    } catch (e) {
      toast(e.message);
    }
  }

  async function rematch() {
    try {
      go(await match.rematch());
    } catch (e) {
      toast(e.message);
    }
  }

  const off = match.onChange(() => alive && render());
  render();
  match
    .refresh()
    .then(() => {
      if (!alive) return;
      render();
      if (match.kind === 'online' && match.view.pl[1] && !match.view.over) pushNudge(nudge, match.view.pl[1 - match.view.me]);
    })
    .catch(e => alive && !match.view && errorPage(el, e));
  return () => {
    alive = false;
    off();
    match.close();
  };
}

// /rush/<id>/<round>: play the round, or show its recap once played.
export function roundScreen(root, match, r) {
  let alive = true, cleanup = null;
  const el = h('div');
  root.append(el);

  function showRecap(recap) {
    const v = match.view;
    const next = v.next;
    const actions = [];
    if (next >= 0 && !v.over && next !== r) actions.push(h('a.button.primary', { href: `${match.base}/${next}` }, `Play round ${next + 1}`));
    actions.push(h('a.button' + (actions.length ? '' : '.primary'), { href: match.base }, 'Match overview'));
    set(el, h('div.page', h('header.top', h('a.icon-btn', { href: match.base, 'aria-label': 'Back' }, '‹'), h('h1', `Round ${r + 1}`)), recapView(recap, { opp: v.pl[1 - v.me] || 'Friend', actions })));
  }

  async function run() {
    try {
      if (!match.view || match.kind === 'online') await match.refresh();
    } catch (e) {
      if (!match.view) return errorPage(el, e);
    }
    if (!alive) return;
    const v = match.view;
    const mine = v.r[r]?.[v.me];
    if (mine?.done) {
      try {
        showRecap(await match.recap(r));
      } catch (e) {
        errorPage(el, e, match.base);
      }
      return;
    }
    if (v.over || v.next !== r) return go(match.base, true);
    const opp = v.r[r][1 - v.me];
    cleanup = playScreen(el, {
      title: `Round ${r + 1} of ${ROUNDS}`,
      note: opp?.done ? `${v.pl[1 - v.me]} scored ${opp.s} on this board. Can you beat it?` : ROUND_NOTES[r],
      resumed: !!mine?.st,
      saveKey: `wns.rp.${match.id}.${r}`,
      start: () => match.startRound(r),
      finish: words => match.submit(r, words),
      onDone: recap => {
        cleanup?.();
        cleanup = null;
        showRecap(recap);
      },
      quit: () => go(match.base),
    });
  }
  run();
  return () => {
    alive = false;
    cleanup?.();
    match.close();
  };
}

// /rush/daily: one board a day, the same for everyone.
export function dailyScreen(root) {
  let alive = true, cleanup = null;
  const daily = new Daily();
  const el = h('div');
  root.append(el);

  const shareText = r => {
    const d = new Date();
    return `Words and Stuff · Daily Word Rush ${d.getMonth() + 1}/${d.getDate()}\n${r.s} points · ${r.n}/${r.of} words${r.best ? ` · best: ${r.best}` : ''}\n${location.origin}/rush/daily`;
  };

  async function showRecap() {
    const recap = await daily.recap();
    if (!alive) return;
    const r = dailyResult();
    const streak = dailyStreak();
    const share = () => (navigator.share ? navigator.share({ text: shareText(r) }).catch(() => {}) : copyText(shareText(r), 'Score'));
    set(
      el,
      h(
        'div.page',
        h('header.top', h('a.icon-btn', { href: '/rush', 'aria-label': 'Back' }, '‹'), h('h1', 'Daily board')),
        h('p.center.streak', streak > 1 ? `🔥 ${streak}-day streak` : 'Come back tomorrow for a new board!'),
        recapView(recap, { actions: [h('button.primary', { onclick: share }, 'Share score'), h('a.button', { href: '/rush' }, 'Done')] }),
      ),
    );
  }

  if (dailyResult()) showRecap().catch(e => toast(e.message));
  else
    cleanup = playScreen(el, {
      title: 'Daily board',
      note: 'Everyone gets this board today. Compare scores with friends!',
      resumed: !!local.get('wns.dailyStart.' + today()),
      saveKey: 'wns.rp.daily.' + today(),
      start: () => daily.start(),
      finish: words => daily.submit(words),
      onDone: () => {
        cleanup?.();
        cleanup = null;
        showRecap().catch(e => toast(e.message));
      },
      quit: () => go('/rush'),
    });
  return () => {
    alive = false;
    cleanup?.();
  };
}
