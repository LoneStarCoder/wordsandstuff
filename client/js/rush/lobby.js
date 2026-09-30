// The Word Rush lobby: daily board, new matches, your matches, settings.
import { h, set, local, sheet, toast, timeAgo, initial } from '../dom.js';
import { api, me, ensureMe, live } from '../net.js';
import { go } from '../nav.js';
import { listBotMatches, newBotMatch, dailyResult, dailyStreak } from './sources.js';
import { shareInvite, howToPlay, copyText } from './common.js';
import { pushStatus, enablePush, disablePush, pushNudge } from '../push.js';

function picker(key, options, fallback) {
  let cur = local.get(key, fallback);
  if (!options.some(o => o.id === cur)) cur = fallback;
  const el = h(
    'div.seg.three',
    { role: 'radiogroup' },
    options.map(o =>
      h('button' + (o.id === cur ? '.on' : ''), {
        type: 'button', role: 'radio', 'aria-checked': String(o.id === cur), 'data-id': o.id,
        onclick: () => {
          cur = o.id;
          local.set(key, cur);
          for (const b of el.children) {
            b.classList.toggle('on', b.dataset.id === cur);
            b.setAttribute('aria-checked', String(b.dataset.id === cur));
          }
        },
      }, h('b', o.name), h('span', o.blurb)),
    ),
  );
  return { el, get value() { return cur; } };
}

// Whose move is it in a match? 'mine' | 'theirs' | 'invite' | 'over'
function stateOf(v) {
  if (v.over) return 'over';
  if (!v.pl[1] && v.next < 0) return 'invite';
  if (v.next >= 0) return 'mine';
  return 'theirs';
}

export function lobbyScreen(root) {
  let alive = true;
  let list = me.token ? local.get('wns.rlist') : null;
  let offline = false;

  const nameBtn = h('button.chip', { onclick: rename, 'aria-label': 'Change your name' });
  const notif = h('span');
  const lists = h('div.lists');
  const nudge = h('div.nudge-slot');
  const daily = h('div');
  root.append(
    h(
      'div.page.lobby',
      h('header.top', h('a.icon-btn', { href: '/', 'aria-label': 'Home' }, '‹'), h('h1', 'Word Rush'), nameBtn),
      daily,
      h(
        'div.new-game',
        h('button.big.primary', { onclick: friendMatch }, h('b', 'Play a friend'), h('span', 'Send an invite link')),
        h('button.big', { onclick: botMatch }, h('b', 'Play the bot'), h('span', 'Offline · 3 levels')),
      ),
      nudge,
      lists,
      h('footer.foot', h('button.link', { onclick: howToPlay }, 'How to play'), h('button.link', { onclick: transfer }, 'Use on another device'), notif),
    ),
  );

  function renderDaily() {
    const r = dailyResult();
    const streak = dailyStreak();
    set(
      daily,
      h(
        'a.daily-card' + (r ? '.done' : ''),
        { href: '/rush/daily' },
        h('div.daily-art', [...'DAY'].map(c => h('span.tile', h('span.l', c)))),
        h('div.card-body', h('b', 'Daily board'), h('span.small', r ? `Today: ${r.s} points · ${r.n} words` : 'Same board for everyone today')),
        h('span.daily-side', streak ? `🔥 ${streak}` : '', h('span.chev', r ? 'See' : 'Play')),
      ),
    );
  }

  function renderHeader() {
    nameBtn.hidden = !me.token;
    nameBtn.textContent = me.name || '';
    const st = pushStatus();
    set(
      notif,
      st === 'on' && h('button.link', { onclick: async () => (await disablePush().catch(() => {}), toast('Notifications off'), renderHeader()) }, 'Notifications: on'),
      st === 'off' && h('button.link', { onclick: async () => { try { await enablePush(); toast('Notifications on'); } catch (e) { toast(e.message); } renderHeader(); } }, 'Turn on notifications'),
      st === 'denied' && h('span.small.muted', 'Notifications blocked'),
    );
  }

  function row(v, bot) {
    const opp = v.pl[1 - v.me];
    const st = stateOf(v);
    const played = v.r.filter(x => x[v.me]?.done).length;
    const theirPlayed = v.r.filter(x => x[1 - v.me]?.done).length;
    let sub;
    if (st === 'over') sub = v.win === 2 ? 'Tie' : v.win === v.me ? 'You won' : `${opp} won`;
    else if (!opp) sub = played ? `Invite not accepted yet · you've played ${played}/3` : 'Invite not accepted yet';
    else if (st === 'mine') sub = v.r[v.next]?.[v.me]?.st ? `Round ${v.next + 1} in progress` : `Your turn · round ${v.next + 1}`;
    else sub = `Waiting for ${opp} · ${theirPlayed}/3 played`;
    const href = (bot ? '/rush/bot/' : '/rush/') + v.id;
    return h(
      'div.game-row' + (st === 'mine' ? '.mine' : '') + (bot ? '.bot' : ''),
      h('a.row-main', { href }, h('span.avatar', initial(opp || '?')), h('span.info', h('b', opp || 'Waiting for a friend'), h('span.sub', sub)), h('span.meta', h('span.score', `${v.tot[v.me]}–${v.tot[1 - v.me]}`), h('time', timeAgo(v.u)))),
      !opp && !bot && v.jk ? h('button.chip', { onclick: () => shareInvite(v) }, 'Share') : null,
    );
  }

  function render() {
    renderHeader();
    renderDaily();
    const online = (list?.data || []).map(v => ({ v, bot: false }));
    const bots = listBotMatches().map(v => ({ v, bot: true }));
    const all = [...online, ...bots].sort((a, b) => b.v.u - a.v.u);
    const withOpp = x => x.bot || x.v.pl[1];
    const group = st => all.filter(x => stateOf(x.v) === st);
    const invites = online.filter(x => !x.v.pl[1] && !x.v.over);
    const section = (title, items) => items.length && h('section', h('h2', title, h('span.count', String(items.length))), items.map(x => row(x.v, x.bot)));
    const sections = [
      section('Your turn', group('mine').filter(withOpp)),
      section('Waiting on friends', group('theirs').filter(withOpp)),
      section('Invites', invites),
      section('Finished', group('over').slice(0, 15)),
    ].filter(Boolean);
    set(
      lists,
      offline && h('p.small.muted.center', 'Offline — showing saved matches.'),
      sections.length ? sections : h('div.empty', h('p', 'No matches yet.'), h('p.muted.small', 'Invite a friend, warm up against the bot, or try the daily board.')),
    );
  }

  async function refresh() {
    if (!me.token) return;
    try {
      const res = await api('GET', 'rush', null, { etag: list?.etag, quiet: !!list });
      offline = false;
      if (res.status !== 304) {
        list = { etag: res.etag, data: res.data };
        local.set('wns.rlist', list);
      }
    } catch (e) {
      offline = e.status === 0;
      if (e.status === 401) list = null;
    }
    if (alive) render();
  }

  async function friendMatch(e) {
    if (!(await ensureMe())) return;
    renderHeader();
    e.target.closest('button').disabled = true;
    try {
      const res = await api('POST', 'rush', {});
      local.set('wns.m.' + res.data.id, { view: res.data, etag: res.etag });
      go('/rush/' + res.data.id);
      shareInvite(res.data);
    } catch (err) {
      toast(err.message);
    }
    e.target.closest('button') && (e.target.closest('button').disabled = false);
  }

  function botMatch() {
    const lp = picker('wns.level', [{ id: 'easy', name: 'Easy', blurb: 'Relaxed' }, { id: 'medium', name: 'Medium', blurb: 'A fair fight' }, { id: 'hard', name: 'Hard', blurb: 'Word nerd' }], 'medium');
    const s = sheet(
      'Play the bot',
      h(
        'div.stack',
        lp.el,
        h('button.primary.block', {
          onclick: async ev => {
            ev.target.disabled = true;
            ev.target.textContent = 'Getting the word list…';
            try {
              const id = await newBotMatch(lp.value, me.name);
              s.close();
              go('/rush/bot/' + id);
            } catch (err) {
              toast(err.message);
              ev.target.disabled = false;
              ev.target.textContent = 'Start match';
            }
          },
        }, 'Start match'),
        h('p.small.muted', 'Bot matches and the daily board need the word list on your device (about 190 KB, downloaded once).'),
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
    if (!me.token) return toast('Start a match with a friend first.');
    const url = `${location.origin}/transfer#${me.token}`;
    sheet(
      'Use on another device',
      h(
        'div.stack',
        h('p.muted', 'Open this link on your other phone or computer to continue your matches there.'),
        h('input.link', { type: 'text', readOnly: true, value: url, onfocus: e => e.target.select(), 'aria-label': 'Device link' }),
        h('p.small.warn', 'Anyone with this link can play as you — only send it to yourself.'),
        h('div.row.end', navigator.share && h('button', { onclick: () => navigator.share({ url }).catch(() => {}) }, 'Share…'), h('button.primary', { onclick: () => copyText(url) }, 'Copy link')),
      ),
    );
  }

  render();
  refresh();
  if (me.token) {
    live.connect();
    if ((list?.data || []).some(v => !v.over && v.pl[1])) pushNudge(nudge);
  }
  const off = live.on(msg => ['up', 'resync'].includes(msg.t) && refresh());
  return () => {
    alive = false;
    off();
  };
}
