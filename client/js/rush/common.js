import { h, set, sheet, toast } from '../dom.js';
import { VALUES, spell, pathsFor, SIZE } from '../../../shared/rush/board.js';

const BONUS = { dl: 'DL', tl: 'TL', dw: '2×W', tw: '3×W' };

export function tileEl(ch, bonus = '') {
  return h(
    'div.rtile' + (bonus ? '.' + bonus : ''),
    h('span.l', spell(ch) === 'QU' ? 'Qu' : ch),
    h('span.v', String(VALUES[ch])),
    bonus && h('span.bonus', BONUS[bonus]),
  );
}

export const bonusOf = (b, i) => (i === b.dl ? 'dl' : i === b.tl ? 'tl' : i === b.dw ? 'dw' : i === b.tw ? 'tw' : '');

export const inviteUrl = g => `${location.origin}/join/${g.id}/${g.jk}`;

export async function copyText(text, what = 'Link') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast("Couldn't copy — press and hold to copy it.");
  }
}

export function shareInvite(g) {
  const url = inviteUrl(g);
  const canShare = !!navigator.share;
  sheet(
    'Invite a friend',
    h(
      'div.stack',
      h('p.muted', 'Send this link to a friend. The first person to open it joins. You can play your rounds right away — they play theirs whenever they like.'),
      h('input.link', { type: 'text', readOnly: true, value: url, onfocus: e => e.target.select(), 'aria-label': 'Invite link' }),
      h(
        'div.row.end',
        h('button' + (canShare ? '' : '.primary'), { onclick: () => copyText(url) }, 'Copy link'),
        canShare && h('button.primary', { onclick: () => navigator.share({ title: 'Words and Stuff', text: 'Think you can beat me at Word Rush?', url }).catch(() => {}) }, 'Share…'),
      ),
    ),
  );
}

export function howToPlay() {
  sheet(
    'How to play Word Rush',
    h(
      'div.rules',
      h('p', 'Find as many words as you can in 90 seconds.'),
      h(
        'ul',
        h('li', 'Swipe through touching letters, including diagonals. Let go to play the word.'),
        h('li', 'Words need 3+ letters, and each tile can be used once per word. ', h('b', 'Qu'), ' is one tile.'),
        h('li', 'The path lights up ', h('b.good-text', 'green'), ' when you’re on a real word.'),
        h('li', h('b.chip-dl', 'DL'), ' ', h('b.chip-tl', 'TL'), ' double or triple a letter. ', h('b.chip-dw', '2×W'), ' ', h('b.chip-tw', '3×W'), ' multiply the whole word.'),
        h('li', 'Long words earn bonus points: +5 for 5 letters, up to +25 for 8 or more.'),
        h('li', 'A match is 3 rounds on the same boards for both players. Play your rounds whenever you like; highest total wins.'),
      ),
      h('p.muted.small', 'On a computer you can also type a word and press Enter.'),
    ),
    { wide: true },
  );
}

// The round's results: both players' words and everything that was there.
export function recapView(recap, { me = 'You', opp = null, actions = [] } = {}) {
  const b = recap.b;
  const mine = new Set(recap.mine.map(x => x.w));
  const theirs = new Set((recap.opp?.w || []).map(x => x.w));
  const mini = [...b.l].map((ch, i) => tileEl(ch, bonusOf(b, i)));
  const board = h('div.mini-grid', mini);
  const show = w => {
    const p = pathsFor(b, w)[0] || [];
    mini.forEach((t, i) => t.classList.toggle('on', p.includes(i)));
  };

  const best = recap.all[0];
  const found = recap.mine.length;
  let tab = 'all';
  const body = h('div');
  const tabs = h('div.tabs');
  const row = x =>
    h(
      'button.word-row' + (mine.has(x.w) ? '.mine' : '') + (theirs.has(x.w) ? '.theirs' : ''),
      { onclick: () => show(x.w) },
      h('span.ww', x.w),
      h('span.marks', mine.has(x.w) && h('span.mark.you', 'you'), theirs.has(x.w) && h('span.mark.them', opp || 'them')),
      h('span.pts', String(x.s)),
    );
  const render = () => {
    const lists = { all: recap.all, mine: recap.mine.slice().sort((a, c) => c.s - a.s), opp: (recap.opp?.w || []).slice().sort((a, c) => c.s - a.s) };
    set(
      tabs,
      h('button' + (tab === 'mine' ? '.on' : ''), { onclick: () => ((tab = 'mine'), render()) }, `You (${found})`),
      recap.opp && h('button' + (tab === 'opp' ? '.on' : ''), { onclick: () => ((tab = 'opp'), render()) }, `${opp} (${recap.opp.w.length})`),
      h('button' + (tab === 'all' ? '.on' : ''), { onclick: () => ((tab = 'all'), render()) }, `All (${recap.all.length})`),
    );
    const items = lists[tab];
    set(body, items.length ? h('div.word-list', items.slice(0, tab === 'all' ? 400 : 200).map(row)) : h('p.muted.center.small', 'No words.'));
  };
  render();

  const oppScore = recap.opp ? recap.opp.s : null;
  const verdict = oppScore == null ? null : recap.s > oppScore ? 'You win this round!' : recap.s < oppScore ? `${opp} takes this round` : 'Dead heat!';
  return h(
    'div.recap',
    h(
      'div.recap-head',
      h('div.rscore', h('span.small.muted', me), h('b', String(recap.s)), h('span.small.muted', `${found} words`)),
      oppScore != null ? h('div.rscore', h('span.small.muted', opp), h('b', String(oppScore)), h('span.small.muted', `${recap.opp.w.length} words`)) : opp && h('div.rscore.wait', h('span.small.muted', opp), h('b', '…'), h('span.small.muted', "hasn't played yet")),
    ),
    verdict && h('p.verdict', verdict),
    h('div.recap-body', board, h('div.recap-stats', h('p', h('b', `${Math.round((found / Math.max(1, recap.all.length)) * 100)}%`), ` of ${recap.all.length} words found`), best && h('p', 'Best word: ', h('button.linkish', { onclick: () => show(best.w) }, best.w), ` (${best.s})`), h('p.small.muted', 'Tap any word to see it on the board.'))),
    h('div.row.center-row', actions),
    tabs,
    body,
  );
}
