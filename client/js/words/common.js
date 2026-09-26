import { h, sheet, toast } from '../dom.js';
import { VARIANTS } from '../../../shared/words/rules.js';

export const inviteUrl = g => `${location.origin}/join/${g.id}/${g.jk}`;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    toast("Couldn't copy — press and hold the link to copy it.");
  }
}

export function shareInvite(g) {
  const url = inviteUrl(g);
  const input = h('input.link', { type: 'text', readOnly: true, value: url, onfocus: e => e.target.select(), 'aria-label': 'Invite link' });
  const canShare = !!navigator.share;
  sheet(
    'Invite a friend',
    h(
      'div.stack',
      h('p.muted', 'Send this link to a friend. The first person to open it joins your game. You can play your first word now.'),
      input,
      h(
        'div.row.end',
        h('button' + (canShare ? '' : '.primary'), { onclick: () => copyText(url) }, 'Copy link'),
        canShare &&
          h('button.primary', { onclick: () => navigator.share({ title: 'Words and Stuff', text: "Let's play a word game!", url }).catch(() => {}) }, 'Share…'),
      ),
    ),
  );
}

export function howToPlay() {
  const li = (...kids) => h('li', ...kids);
  sheet(
    'How to play',
    h(
      'div.rules',
      h('p', 'Take turns making words on the board, crossword style. Highest score wins.'),
      h(
        'ul',
        li('The first word must cover the ', h('b', '★'), ' in the middle.'),
        li('Every new word must connect to tiles already on the board, in one row or column.'),
        li('All words formed — including sideways ones — must be real words.'),
        li(h('b.chip-dl', 'DL'), ' ', h('b.chip-tl', 'TL'), ' double or triple a letter. ', h('b.chip-dw', 'DW'), ' ', h('b.chip-tw', 'TW'), ' double or triple the whole word.'),
        li('Use all 7 tiles in one turn for a bingo bonus.'),
        li('Blank tiles can be any letter but score 0.'),
        li("Stuck? Swap tiles or pass. When the bag is empty and someone plays their last tile, the game ends and they get their opponent's leftover points."),
      ),
      h('p.muted.small', 'Drag tiles onto the board or tap a tile and then a square. On a computer, click a square and type.'),
      h('p.muted.small', Object.values(VARIANTS).map(v => `${v.name}: ${v.blurb}.`).join(' ')),
    ),
    { wide: true },
  );
}
