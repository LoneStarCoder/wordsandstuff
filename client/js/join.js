// /join/<game>/<key>: accept an invite link.
import { h, local, toast, set } from './dom.js';
import { api, me, ensureMe } from './net.js';
import { go } from './nav.js';

export function joinScreen(root, gid, jk) {
  const box = h('div.page.center-page', h('p.muted', 'Opening invite…'));
  root.append(box);
  let alive = true;

  let kind = 'rush';
  async function join(by) {
    if (!(await ensureMe(`${by} wants to play! Pick a name they'll see.`))) return;
    try {
      const res = await api('POST', `${kind === 'secret' ? 'secret' : 'rush'}/${gid}/join`, { jk });
      local.set((kind === 'secret' ? 'wns.sw.' : 'wns.m.') + gid, { view: res.data, etag: res.etag });
      go(`/${kind}/${gid}`, true);
    } catch (e) {
      toast(e.message);
    }
  }

  api('GET', `invite/${gid}/${jk}`)
    .then(({ data }) => {
      if (!alive) return;
      kind = data.t === 'secret' ? 'secret' : 'rush';
      const secret = kind === 'secret';
      set(box, 
        h(
          'div.card.invite',
          h('div.logo-mini', [...'GO'].map(c => h('span.tile', h('span.l', c)))),
          h('h1', secret ? `${data.by} picked a secret word for you` : `${data.by} challenged you to Word Rush`),
          h('p.muted', secret ? 'Can you crack it in 6 guesses? · no sign-up needed' : '3 quick rounds of finding words · no sign-up needed'),
          h('button.primary.big-btn', { onclick: () => join(data.by) }, 'Accept challenge'),
        ),
      );
    })
    .catch(async e => {
      if (!alive) return;
      // Already in this game (e.g. opened the link twice)? Just go there.
      if (me.token && e.status === 404) {
        try {
          for (const k of ['rush', 'secret']) {
            try {
              await api('GET', `${k}/${gid}`, null, { quiet: true });
              return go(`/${k}/${gid}`, true);
            } catch {}
          }
        } catch {}
      }
      set(box, 
        h('div.card.invite', h('h1', 'Invite not available'), h('p.muted', e.status === 404 ? 'This invite has expired or someone already joined.' : e.message), h('a.button.primary', { href: '/rush' }, 'Go to Word Rush')),
      );
    });
  return () => (alive = false);
}
