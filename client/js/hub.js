// Home screen: the catalog of games. Word Rush is the first; more to come.
import { h, local } from './dom.js';
import { dailyResult } from './rush/sources.js';

const tiles = word => [...word].map(c => h('span.tile', h('span.l', c)));

export function hubScreen(root) {
  const list = local.get('wns.rlist')?.data || [];
  const myTurn = list.filter(v => !v.over && v.pl[1] && v.next >= 0).length;
  const secretTurn = (local.get('wns.slist')?.data || []).filter(c => !c.done && c.role === 'guesser').length;
  root.append(
    h(
      'div.page.hub',
      h('div.logo', { role: 'img', 'aria-label': 'Words and Stuff' }, h('div.logo-row', tiles('WORDS')), h('div.logo-row', h('span.amp', '&'), tiles('STUFF'))),
      h('p.tagline', 'Little games to play with friends.'),
      h(
        'div.cards',
        h(
          'a.card.game-card',
          { href: '/rush' },
          h('div.card-art.rush-art', tiles('RUSH')),
          h('div.card-body', h('h2', 'Word Rush'), h('p', '90 seconds. 16 letters. Swipe out as many words as you can, then see if your friend can beat you.')),
          myTurn ? h('span.badge', { title: 'Matches waiting for you' }, String(myTurn)) : h('span.chev', '›'),
        ),
        h(
          'a.card.game-card',
          { href: '/rush/daily' },
          h('div.card-art', tiles('D')),
          h('div.card-body', h('h2', 'Word Rush daily'), h('p', dailyResult() ? `You scored ${dailyResult().s} today. Back tomorrow!` : 'One board a day, the same for everyone.')),
          h('span.chev', '›'),
        ),
        h(
          'a.card.game-card',
          { href: '/secret' },
          h('div.card-art.sw-art', [...'WORD'].map((c, i) => h('span.tile' + (i === 1 ? '.sw-g' : i === 3 ? '.sw-y' : ''), h('span.l', c)))),
          h('div.card-body', h('h2', 'Secret Word'), h('p', 'Pick a 5-letter word and dare a friend to crack it in six guesses. Plus a daily word.')),
          secretTurn ? h('span.badge', { title: 'Words waiting for you' }, String(secretTurn)) : h('span.chev', '›'),
        ),
        h('div.card.soon', h('div.card-art', h('span.tile.q', h('span.l', '?'))), h('div.card-body', h('h2', 'More games'), h('p', 'Coming soon.'))),
      ),
      h('p.foot.small.muted', 'No ads · no accounts · tiny downloads'),
    ),
  );
}
