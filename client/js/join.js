// /join/<game>/<key>: accept an invite link.
import { h, local, toast, set } from './dom.js';
import { api, me, ensureMe } from './net.js';
import { go } from './nav.js';

export function joinScreen(root, gid, jk) {
  const box = h('div.page.center-page', h('p.muted', 'Opening invite…'));
  root.append(box);
  let alive = true;

  async function join(by) {
    if (!(await ensureMe(`${by} wants to play! Pick a name they'll see.`))) return;
    try {
      const res = await api('POST', `rush/${gid}/join`, { jk });
      local.set('wns.m.' + gid, { view: res.data, etag: res.etag });
      go('/rush/' + gid, true);
    } catch (e) {
      toast(e.message);
    }
  }

  api('GET', `invite/${gid}/${jk}`)
    .then(({ data }) => {
      if (!alive) return;
      set(box, 
        h(
          'div.card.invite',
          h('div.logo-mini', [...'GO'].map(c => h('span.tile', h('span.l', c)))),
          h('h1', `${data.by} challenged you to Word Rush`),
          h('p.muted', '3 quick rounds of finding words · no sign-up needed'),
          h('button.primary.big-btn', { onclick: () => join(data.by) }, 'Accept challenge'),
        ),
      );
    })
    .catch(async e => {
      if (!alive) return;
      // Already in this game (e.g. opened the link twice)? Just go there.
      if (me.token && e.status === 404) {
        try {
          await api('GET', 'rush/' + gid, null, { quiet: true });
          return go('/rush/' + gid, true);
        } catch {}
      }
      set(box, 
        h('div.card.invite', h('h1', 'Invite not available'), h('p.muted', e.status === 404 ? 'This invite has expired or someone already joined.' : e.message), h('a.button.primary', { href: '/rush' }, 'Go to Word Rush')),
      );
    });
  return () => (alive = false);
}
