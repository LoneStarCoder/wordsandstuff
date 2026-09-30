// Talking to the server: a small fetch wrapper with ETag caching, the player
// identity, and one WebSocket for live updates while the app is visible.
import { h, local, sheet, toast } from './dom.js';

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const me = {
  get token() {
    return local.get('wns.token');
  },
  get name() {
    return local.get('wns.name');
  },
  get id() {
    return (this.token || '').split('.')[0] || null;
  },
  save(token, name) {
    if (token) local.set('wns.token', token);
    if (name) local.set('wns.name', name);
  },
  forget() {
    local.del('wns.token');
    local.del('wns.rlist');
  },
};

// The free server naps when idle; tell people why the first request is slow.
let pending = 0, wakeTimer = null;
function busy(on) {
  pending += on ? 1 : -1;
  const banner = document.getElementById('waking');
  if (on && pending === 1) wakeTimer = setTimeout(() => banner?.classList.add('show'), 1500);
  if (!pending) {
    clearTimeout(wakeTimer);
    banner?.classList.remove('show');
  }
}

export async function api(method, path, body, { etag, quiet } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (me.token) headers.Authorization = 'Bearer ' + me.token;
  if (etag) headers['If-None-Match'] = etag;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  if (!quiet) busy(true);
  let res;
  try {
    res = await fetch('/api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: 'no-store' });
  } catch {
    throw new ApiError(0, navigator.onLine === false ? "You're offline." : "Couldn't reach the server.");
  } finally {
    clearTimeout(timer);
    if (!quiet) busy(false);
  }
  if (res.status === 304) return { status: 304, etag };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && me.token) me.forget();
    throw new ApiError(res.status, data.error || 'Something went wrong.', data);
  }
  return { status: res.status, data, etag: res.headers.get('ETag') };
}

// Makes sure we have a player identity, asking for a name the first time.
export function ensureMe(reason = 'Pick a name your friends will see.') {
  if (me.token) return Promise.resolve(true);
  return new Promise(resolve => {
    let done = false;
    const input = h('input', { type: 'text', maxLength: 20, placeholder: 'Your name', value: me.name || '', autocomplete: 'nickname', enterKeyHint: 'go' });
    const go = async () => {
      const name = input.value.trim();
      if (!name) return input.focus();
      btn.disabled = true;
      try {
        const { data } = await api('POST', 'hello', { name });
        me.save(data.token, data.n);
        done = true;
        s.close();
        live.connect();
        resolve(true);
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
      }
    };
    input.addEventListener('keydown', e => e.key === 'Enter' && go());
    const btn = h('button.primary.block', { onclick: go }, 'Continue');
    const s = sheet('Hi there!', h('div.stack', h('p.muted', reason), input, btn, h('p.small.muted', 'No sign-up needed. Your matches stay on this device (you can move them later).')), {
      onClose: () => !done && resolve(false),
    });
  });
}

// --- Live updates ---------------------------------------------------------

const listeners = new Set();
let ws = null, retry = 0, retryTimer = null, hideTimer = null, wanted = false;

export const live = {
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  connect() {
    wanted = true;
    if (!me.token || ws || document.hidden) return;
    clearTimeout(retryTimer);
    const sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws = sock;
    sock.onopen = () => sock.send(JSON.stringify({ t: 'auth', k: me.token }));
    sock.onmessage = e => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'hi') {
        // Reconnected: anything could have changed while we were away.
        if (retry > 0 || sock.resumed) listeners.forEach(fn => fn({ t: 'resync' }));
        retry = 0;
        sock.resumed = true;
        sock.authed = true;
      }
      listeners.forEach(fn => fn(msg));
    };
    sock.onclose = e => {
      if (ws === sock) ws = null;
      if (e.code === 4001) return me.forget();
      if (wanted && !document.hidden) {
        retry++;
        retryTimer = setTimeout(() => live.connect(), Math.min(30_000, 1000 * 2 ** Math.min(retry, 5)));
      }
    };
  },
  disconnect() {
    wanted = false;
    ws?.close();
    ws = null;
  },
};

// Only keep the socket open while someone is looking at the app.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hideTimer = setTimeout(() => {
      const keep = wanted;
      live.disconnect();
      wanted = keep;
    }, 20_000);
  } else {
    clearTimeout(hideTimer);
    if (wanted && !ws) {
      retry = 1; // triggers a resync once connected
      live.connect();
    }
  }
});

// Fallback for networks that block WebSockets: while the app is visible and
// the socket isn't up, check for changes every 30 s (usually a tiny 304).
setInterval(() => {
  const up = ws && ws.readyState === WebSocket.OPEN && ws.authed;
  if (wanted && me.token && !document.hidden && !up) listeners.forEach(fn => fn({ t: 'resync' }));
}, 30_000);
