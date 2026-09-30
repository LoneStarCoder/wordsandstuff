// /transfer#<token>: continue as the same player on another device.
import { h, set } from './dom.js';
import { me } from './net.js';
import { go } from './nav.js';

export function transferScreen(root) {
  const token = decodeURIComponent(location.hash.slice(1));
  history.replaceState(null, '', '/transfer'); // don't keep the token in history
  const box = h('div.page.center-page', h('p.muted', 'Checking link…'));
  root.append(box);
  const fail = msg => set(box, h('div.card.invite', h('h1', 'Link not valid'), h('p.muted', msg), h('a.button.primary', { href: '/rush' }, 'Go to Word Rush')));
  if (!token) {
    fail('This link is incomplete.');
    return;
  }
  fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })
    .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(data => {
      const replacing = me.token && me.token !== token ? me.name : null;
      set(box, 
        h(
          'div.card.invite',
          h('h1', `Continue as ${data.n}?`),
          h('p.muted', 'Your matches will show up on this device.'),
          replacing && h('p.small.warn', `This device is currently playing as ${replacing}. Those matches will no longer show here.`),
          h('button.primary.big-btn', {
            onclick: () => {
              me.forget();
              me.save(token, data.n);
              go('/rush', true);
            },
          }, `Continue as ${data.n}`),
        ),
      );
    })
    .catch(() => fail('It may have expired. Make a new link on your other device.'));
}
