// Turn notifications (Web Push). Optional and opt-in.
import { h, local, toast, set } from './dom.js';
import { api, me } from './net.js';

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

export function pushStatus() {
  if (!me.token) return 'no-player';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS && !standalone ? 'ios-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && local.get('wns.push') ? 'on' : 'off';
}

const b64 = s => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked for this site.');
  const reg = await navigator.serviceWorker.ready;
  const { data } = await api('GET', 'config');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(data.push) }));
  await api('POST', 'push', { sub: sub.toJSON() });
  local.set('wns.push', true);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('DELETE', 'push', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  local.set('wns.push', false);
}

// A small, dismissible prompt to turn notifications on.
export function pushNudge(slot, who = 'your friend') {
  const st = pushStatus();
  if ((st !== 'off' && st !== 'ios-install') || local.get('wns.nudged')) return;
  const dismiss = () => {
    local.set('wns.nudged', 1);
    set(slot);
  };
  const text = st === 'ios-install' ? `Add this app to your Home Screen (Share → Add to Home Screen) to get notified when ${who} plays.` : `Get a notification when ${who} plays?`;
  set(slot, 
    h(
      'div.nudge',
      h('span', text),
      st === 'off' &&
        h('button.chip.primary', {
          onclick: async () => {
            try {
              await enablePush();
              toast("Notifications on — we'll tell you when it's your turn.");
              dismiss();
            } catch (e) {
              toast(e.message);
            }
          },
        }, 'Turn on'),
      h('button.icon-btn.small', { 'aria-label': 'Dismiss', onclick: dismiss }, '✕'),
    ),
  );
}
