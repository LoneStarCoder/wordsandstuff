// Home screen: the catalog of games. Words is the first; more to come.
import { h, local } from './dom.js';

const tiles = word => [...word].map(c => h('span.tile', h('span.l', c)));

export function hubScreen(root) {
  const list = local.get('wns.list')?.data || [];
  const myTurn = list.filter(g => !g.over && g.opp && g.turn === g.me).length;
  root.append(
    h(
      'div.page.hub',
      h('div.logo', { role: 'img', 'aria-label': 'Words and Stuff' }, h('div.logo-row', tiles('WORDS')), h('div.logo-row', h('span.amp', '&'), tiles('STUFF'))),
      h('p.tagline', 'Little games to play with friends.'),
      h(
        'div.cards',
        h(
          'a.card.game-card',
          { href: '/words' },
          h('div.card-art', tiles('AB')),
          h('div.card-body', h('h2', 'Words'), h('p', 'The crossword tile game. Challenge a friend or practise against the bot.')),
          myTurn ? h('span.badge', { title: 'Games waiting for you' }, String(myTurn)) : h('span.chev', '›'),
        ),
        h('div.card.soon', h('div.card-art', h('span.tile.q', h('span.l', '?'))), h('div.card-body', h('h2', 'More games'), h('p', 'Coming soon.'))),
      ),
      h('p.foot.small.muted', 'No ads · no accounts · tiny downloads'),
    ),
  );
}
