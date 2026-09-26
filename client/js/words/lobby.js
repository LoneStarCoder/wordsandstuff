// The Words lobby: your games, new game buttons, settings.
import { h, local, sheet, toast, timeAgo, initial, confirm, set } from '../dom.js';
import { api, me, ensureMe, live } from '../net.js';
import { go } from '../nav.js';
import { listBotGames, newBotGame, deleteBotGame, BOT_NAMES } from './sources.js';
import { shareInvite, howToPlay, copyText } from './common.js';
import { pushStatus, enablePush, disablePush, pushNudge } from '../push.js';
import { VARIANTS } from '../../../shared/words/rules.js';

function picker(key, options, fallback) {
  let cur = local.get(key, fallback);
  if (!options.some(o => o.id === cur)) cur = fallback;
  const el = h(
    'div.seg',
    { role: 'radiogroup' },
    options.map(o =>
      h('button' + (o.id === cur ? '.on' : ''), {
        type: 'button',
        role: 'radio',
        'aria-checked': String(o.id === cur),
        'data-id': o.id,
        onclick: () => {
          cur = o.id;
          local.set(key, cur);
          for (const b of el.children) {
            b.classList.toggle('on', b.dataset.id === cur);
            b.setAttribute('aria-checked', String(b.dataset.id === cur));
          }
        },
      }, h('b', o.name), o.blurb && h('span', o.blurb)),
    ),
  );
  return { el, get value() { return cur; } };
}

const variantPicker = () => picker('wns.variant', Object.entries(VARIANTS).map(([id, v]) => ({ id, name: v.name, blurb: v.blurb })), 'modern');

export function lobbyScreen(root) {
  let alive = true;
  let list = me.token ? local.get('wns.list') : null;
  let offline = false;

  const nameBtn = h('button.chip', { onclick: rename });
  const notif = h('span');
  const lists = h('div.lists');
  const nudge = h('div.nudge-slot');
  root.append(
    h(
      'div.page.lobby',
      h('header.top', h('a.icon-btn', { href: '/', 'aria-label': 'Home' }, '‹'), h('h1', 'Words'), nameBtn),
      h(
        'div.new-game',
        h('button.big.primary', { onclick: friendGame }, h('b', 'Play a friend'), h('span', 'Send an invite link')),
        h('button.big', { onclick: botGame }, h('b', 'Play the bot'), h('span', 'Offline · 3 levels')),
      ),
      nudge,
      lists,
      h(
        'footer.foot',
        h('button.link', { onclick: howToPlay }, 'How to play'),
        h('button.link', { onclick: transfer }, 'Use on another device'),
        notif,
      ),
    ),
  );

  function renderHeader() {
    nameBtn.hidden = !me.token;
    nameBtn.textContent = me.name || '';
    nameBtn.setAttribute('aria-label', 'Change your name');
    const st = pushStatus();
    set(notif, 
      st === 'on' ? h('button.link', { onclick: async () => (await disablePush().catch(() => {}), toast('Notifications off'), renderHeader()) }, 'Notifications: on') : null,
      st === 'off' ? h('button.link', { onclick: async () => { try { await enablePush(); toast('Notifications on'); } catch (e) { toast(e.message); } renderHeader(); } }, 'Turn on notifications') : null,
      st === 'denied' ? h('span.small.muted', 'Notifications blocked') : null,
    );
  }

  function row({ href, name, sub, score, time, mine, cls = '', action }) {
    return h(
      'div.game-row' + cls,
      h('a.row-main', { href }, h('span.avatar', initial(name)), h('span.info', h('b', name), h('span.sub', sub)), h('span.meta', score && h('span.score', score), time && h('time', time))),
      action,
    );
  }

  function onlineRow(g) {
    const opp = g.opp || 'Waiting for a friend';
    let sub;
    if (!g.opp) sub = 'Invite not accepted yet';
    else if (g.over) sub = g.win === 2 ? 'Tie game' : g.win === g.me ? 'You won' : `${g.opp} won`;
    else if (g.last) {
      const who = g.last.p === g.me ? 'You' : g.opp;
      sub = g.last.k === 'play' ? `${who} played ${g.last.w} (+${g.last.s})` : g.last.k === 'swap' ? `${who} swapped` : g.last.k === 'pass' ? `${who} passed` : `${who} resigned`;
    } else sub = g.turn === g.me ? 'You go first' : `${g.opp} goes first`;
    const unread = g.cc - local.get('wns.chat.' + g.id, 0);
    if (unread > 0 && !g.over) sub = `💬 ${unread} new · ` + sub;
    const action = !g.opp
      ? h('button.chip', { onclick: () => shareInvite(g) }, 'Share')
      : g.over
        ? h('button.icon-btn.small', { 'aria-label': 'Remove game', onclick: () => remove(g) }, '✕')
        : null;
    return row({ href: '/words/' + g.id, name: opp, sub, score: `${g.s[g.me]}–${g.s[1 - g.me]}`, time: timeAgo(g.u), action, cls: g.turn === g.me && !g.over ? '.mine' : '' });
  }

  function botRow(b) {
    const st = b.st;
    const name = BOT_NAMES[b.level] || 'Bot';
    const last = st.m[st.m.length - 1];
    let sub;
    if (st.over) sub = st.win === 2 ? 'Tie game' : st.win === 0 ? 'You won' : 'Bot won';
    else if (!last) sub = 'You go first';
    else {
      const who = last.p === 0 ? 'You' : 'Bot';
      sub = last.k === 'play' ? `${who} played ${last.w[0]} (+${last.s})` : `${who} ${last.k === 'swap' ? 'swapped' : last.k === 'pass' ? 'passed' : 'resigned'}`;
    }
    const action = st.over ? h('button.icon-btn.small', { 'aria-label': 'Delete game', onclick: () => (deleteBotGame(b.id), render()) }, '✕') : null;
    return row({ href: '/words/bot/' + b.id, name, sub, score: `${st.s[0]}–${st.s[1]}`, time: timeAgo(b.u), action, cls: '.bot' });
  }

  function render() {
    renderHeader();
    const online = list?.data || [];
    const bots = listBotGames();
    const yours = online.filter(g => !g.over && g.opp && g.turn === g.me);
    const theirs = online.filter(g => !g.over && g.opp && g.turn !== g.me);
    const waiting = online.filter(g => !g.over && !g.opp);
    const activeBots = bots.filter(b => !b.st.over);
    const done = [...online.filter(g => g.over).map(g => ({ u: g.u, el: () => onlineRow(g) })), ...bots.filter(b => b.st.over).map(b => ({ u: b.u, el: () => botRow(b) }))]
      .sort((a, b) => b.u - a.u)
      .slice(0, 15);
    const section = (title, items) => items.length && h('section', h('h2', title, h('span.count', String(items.length))), items);
    const sections = [
      section('Your turn', yours.map(onlineRow)),
      section('Their turn', theirs.map(onlineRow)),
      section('Invites', waiting.map(onlineRow)),
      section('Bot games', activeBots.map(botRow)),
      section('Finished', done.map(d => d.el())),
    ].filter(Boolean);
    set(lists, 
      offline ? h('p.small.muted.center', 'Offline — showing saved games.') : null,
      ...(sections.length
        ? sections
        : [h('div.empty', h('div.empty-tiles', [...'PLAY'].map(c => h('span.tile', h('span.l', c)))), h('p', 'No games yet.'), h('p.muted.small', 'Invite a friend with a link, or warm up against the bot.'))]),
    );
  }

  async function refresh() {
    if (!me.token) return;
    try {
      const res = await api('GET', 'games', null, { etag: list?.etag, quiet: !!list });
      offline = false;
      if (res.status !== 304) {
        list = { etag: res.etag, data: res.data };
        local.set('wns.list', list);
        prune(res.data);
      }
    } catch (e) {
      offline = e.status === 0;
      if (e.status === 401) list = null;
    }
    if (alive) render();
  }

  // Forget cached game views that are no longer in the list.
  function prune(games) {
    try {
      const keep = new Set(games.map(g => 'wns.g.' + g.id));
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith('wns.g.') && !keep.has(k)) localStorage.removeItem(k);
      }
    } catch {}
  }

  async function friendGame() {
    if (!(await ensureMe())) return;
    renderHeader();
    const vp = variantPicker();
    const s = sheet(
      'Play a friend',
      h(
        'div.stack',
        vp.el,
        h('button.primary.block', {
          onclick: async e => {
            e.target.disabled = true;
            try {
              const res = await api('POST', 'games', { v: vp.value });
              local.set('wns.g.' + res.data.id, { view: res.data, etag: res.etag });
              s.close();
              go('/words/' + res.data.id);
              shareInvite(res.data);
            } catch (err) {
              toast(err.message);
              e.target.disabled = false;
            }
          },
        }, 'Create invite link'),
      ),
    );
  }

  function botGame() {
    const vp = variantPicker();
    const lp = picker('wns.level', [{ id: 'easy', name: 'Easy' }, { id: 'medium', name: 'Medium' }, { id: 'hard', name: 'Hard' }], 'medium');
    lp.el.classList.add('three');
    const s = sheet(
      'Play the bot',
      h(
        'div.stack',
        vp.el,
        lp.el,
        h('button.primary.block', { onclick: () => (s.close(), go('/words/bot/' + newBotGame(vp.value, lp.value))) }, 'Start game'),
        h('p.small.muted', 'The first bot game downloads the word list (about 190 KB, once).'),
      ),
    );
  }

  async function rename() {
    const input = h('input', { type: 'text', maxLength: 20, value: me.name || '', 'aria-label': 'Your name' });
    const save = async () => {
      try {
        const { data } = await api('POST', 'me', { name: input.value });
        me.save(null, data.n);
        s.close();
        render();
        refresh();
      } catch (e) {
        toast(e.message);
      }
    };
    input.addEventListener('keydown', e => e.key === 'Enter' && save());
    const s = sheet('Your name', h('div.stack', input, h('button.primary.block', { onclick: save }, 'Save')));
  }

  function transfer() {
    if (!me.token) return toast('Start a game with a friend first.');
    const url = `${location.origin}/transfer#${me.token}`;
    sheet(
      'Use on another device',
      h(
        'div.stack',
        h('p.muted', 'Open this link on your other phone or computer to continue your games there.'),
        h('input.link', { type: 'text', readOnly: true, value: url, onfocus: e => e.target.select(), 'aria-label': 'Device link' }),
        h('p.small.warn', 'Anyone with this link can play as you — only send it to yourself.'),
        h('div.row.end', navigator.share && h('button', { onclick: () => navigator.share({ url }).catch(() => {}) }, 'Share…'), h('button.primary', { onclick: () => copyText(url) }, 'Copy link')),
      ),
    );
  }

  async function remove(g) {
    if (!(await confirm('Remove game?', 'It will disappear from your list.', 'Remove'))) return;
    try {
      await api('DELETE', 'games/' + g.id);
      list.data = list.data.filter(x => x.id !== g.id);
      list.etag = null;
      render();
    } catch (e) {
      toast(e.message);
    }
  }

  render();
  refresh();
  if (me.token) {
    live.connect();
    if ((list?.data || []).some(g => !g.over && g.opp)) pushNudge(nudge);
  }
  const off = live.on(msg => ['mv', 'join', 'new', 'chat', 'resync'].includes(msg.t) && refresh());
  return () => {
    alive = false;
    off();
  };
}
