// Minimal DOM helpers: no framework, just a hyperscript function.

// h('button#go.primary', { onclick }, 'Play') → <button id="go" class="primary">Play</button>
export function h(tag, props, ...kids) {
  const [base, ...classes] = tag.split('.');
  const [name, id] = base.split('#');
  const el = document.createElement(name || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : String(k));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

// Like el.replaceChildren(), but skips null/false and flattens arrays.
export function set(el, ...kids) {
  el.textContent = '';
  append(el, kids);
  return el;
}

let toastTimer;
export function toast(msg, ms = 2600) {
  let el = $('#toast');
  if (!el) document.body.append((el = h('div#toast', { role: 'status', 'aria-live': 'polite' })));
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// A bottom sheet / dialog. Returns { el, close }.
export function sheet(title, body, { onClose, wide } = {}) {
  const prevFocus = document.activeElement;
  const close = () => {
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 200);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = e => e.key === 'Escape' && close();
  const panel = h(
    'div.sheet' + (wide ? '.wide' : ''),
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.sheet-head', h('h2', title), h('button.icon-btn', { 'aria-label': 'Close', onclick: close }, '✕')),
    body,
  );
  const overlay = h('div.overlay', { onclick: e => e.target === overlay && close() }, panel);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    (panel.querySelector('input, .primary') || panel.querySelector('button'))?.focus();
  });
  return { el: panel, close };
}

export function confirm(title, text, ok = 'OK', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      s.close();
      resolve(v);
    };
    const s = sheet(
      title,
      h('div', h('p.muted', text), h('div.row.end', h('button', { onclick: () => finish(false) }, 'Cancel'), h('button' + (danger ? '.danger' : '.primary'), { onclick: () => finish(true) }, ok))),
      { onClose: () => finish(false) },
    );
  });
}

export function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd';
  return new Date(ms).toLocaleDateString();
}

export const initial = name => (name || '?').trim().charAt(0).toUpperCase() || '?';

// localStorage that never throws (private mode, quota, disabled storage).
export const local = {
  get(k, fallback = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};
