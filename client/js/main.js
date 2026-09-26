import { $, set } from './dom.js';
import { setRenderer, go, reloadOnNextNav } from './nav.js';
import { me } from './net.js';
import { hubScreen } from './hub.js';
import { joinScreen } from './join.js';
import { transferScreen } from './transfer.js';
import { lobbyScreen } from './words/lobby.js';
import { gameScreen } from './words/game.js';
import { OnlineSource, BotSource } from './words/sources.js';

// Each route returns a cleanup function, or a path to redirect to.
const routes = [
  [/^\/$/, 'Words and Stuff', root => hubScreen(root)],
  [/^\/words$/, 'Words', root => lobbyScreen(root)],
  [/^\/words\/bot\/([\w-]+)$/, 'Words', (root, id) => gameScreen(root, new BotSource(id))],
  [/^\/words\/([\w-]+)$/, 'Words', (root, id) => (me.token ? gameScreen(root, new OnlineSource(id)) : '/words')],
  [/^\/join\/([\w-]+)\/([\w-]+)$/, 'Join a game', (root, gid, jk) => joinScreen(root, gid, jk)],
  [/^\/transfer$/, 'Words and Stuff', root => transferScreen(root)],
];

let cleanup = null;
function render() {
  cleanup?.();
  cleanup = null;
  document.querySelectorAll('.overlay').forEach(o => o.remove());
  const app = $('#app');
  set(app);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  for (const [re, title, screen] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.title = title === 'Words and Stuff' ? title : `${title} · Words and Stuff`;
    const r = screen(app, ...m.slice(1).map(decodeURIComponent));
    if (typeof r === 'string') return go(r, true);
    cleanup = r || null;
    window.scrollTo(0, 0);
    return;
  }
  go('/', true);
}

setRenderer(render);
addEventListener('popstate', render);
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/')) return;
  e.preventDefault();
  go(href);
});
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) reloadOnNextNav();
    hadController = true;
  });
  // Notification taps while the app is open.
  navigator.serviceWorker.addEventListener('message', e => e.data?.go && go(e.data.go));
}
