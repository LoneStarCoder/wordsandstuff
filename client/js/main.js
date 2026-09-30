import { $, set } from './dom.js';
import { setRenderer, go, reloadOnNextNav } from './nav.js';
import { me } from './net.js';
import { hubScreen } from './hub.js';
import { joinScreen } from './join.js';
import { transferScreen } from './transfer.js';
import { lobbyScreen } from './rush/lobby.js';
import { matchScreen, roundScreen, dailyScreen } from './rush/match.js';
import { OnlineMatch, BotMatch } from './rush/sources.js';
import { secretLobby, challengeScreen, secretDaily, secretPractice } from './secret/screens.js';

// Each route returns a cleanup function, or a path to redirect to.
const routes = [
  [/^\/$/, 'Words and Stuff', root => hubScreen(root)],
  [/^\/rush$/, 'Word Rush', root => lobbyScreen(root)],
  [/^\/rush\/daily$/, 'Daily board', root => dailyScreen(root)],
  [/^\/rush\/bot\/([\w-]+)$/, 'Word Rush', (root, id) => matchScreen(root, new BotMatch(id))],
  [/^\/rush\/bot\/([\w-]+)\/([0-2])$/, 'Word Rush', (root, id, r) => roundScreen(root, new BotMatch(id), +r)],
  [/^\/rush\/([\w-]+)$/, 'Word Rush', (root, id) => (me.token ? matchScreen(root, new OnlineMatch(id)) : '/rush')],
  [/^\/rush\/([\w-]+)\/([0-2])$/, 'Word Rush', (root, id, r) => (me.token ? roundScreen(root, new OnlineMatch(id), +r) : '/rush')],
  [/^\/secret$/, 'Secret Word', root => secretLobby(root)],
  [/^\/secret\/daily$/, 'Daily word', root => secretDaily(root)],
  [/^\/secret\/practice$/, 'Secret Word', root => secretPractice(root)],
  [/^\/secret\/([\w-]+)$/, 'Secret Word', (root, id) => (me.token ? challengeScreen(root, id) : '/secret')],
  [/^\/words(\/.*)?$/, 'Word Rush', () => '/rush'],
  [/^\/join\/([\w-]+)\/([\w-]+)$/, 'Join a match', (root, gid, jk) => joinScreen(root, gid, jk)],
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
  const reg = navigator.serviceWorker.register('/sw.js').catch(() => null);
  // Look for a new version whenever the app comes back to the screen.
  document.addEventListener('visibilitychange', () => !document.hidden && reg.then(r => r?.update().catch(() => {})));
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version is ready: switch now unless a round is being played.
    if (hadController) document.querySelector('.play .grid') ? reloadOnNextNav() : location.reload();
    hadController = true;
  });
  // Notification taps while the app is open.
  navigator.serviceWorker.addEventListener('message', e => e.data?.go && go(e.data.go));
}
