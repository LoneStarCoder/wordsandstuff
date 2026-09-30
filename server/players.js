// Players have no accounts: the browser keeps a token "<id>.<secret>" and we
// store only a hash of the secret. Anyone holding the token is that player,
// which is how "move to another device" links work.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { newId, HttpError, TTL } from './util.js';

const hash = s => createHash('sha256').update(s).digest();

export function cleanName(name) {
  const n = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  if (!n) throw new HttpError(400, 'Pick a name.');
  return n;
}

export function createPlayers({ store }) {
  const load = async id => {
    const raw = typeof id === 'string' && /^[\w-]{8,20}$/.test(id) ? await store.get('p:' + id) : null;
    return raw ? JSON.parse(raw) : null;
  };
  const save = p => store.set('p:' + p.id, JSON.stringify(p), TTL.list);

  return {
    load,
    save,

    async create(name) {
      const secret = randomBytes(24).toString('base64url');
      const p = { id: newId(), n: cleanName(name), h: hash(secret).toString('base64'), c: Date.now(), push: [] };
      await save(p);
      return { player: p, token: `${p.id}.${secret}` };
    },

    async fromToken(token) {
      if (typeof token !== 'string') return null;
      const dot = token.indexOf('.');
      if (dot < 0 || token.length > 100) return null;
      const p = await load(token.slice(0, dot));
      if (!p) return null;
      const want = Buffer.from(p.h, 'base64');
      const got = hash(token.slice(dot + 1));
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      // Refresh the expiry at most once a day.
      const today = Math.floor(Date.now() / 864e5);
      if (p.a !== today) {
        p.a = today;
        await save(p);
      }
      return p;
    },
  };
}
