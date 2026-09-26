// Tiny key/value + set storage used by the server. Backed by Redis (Render
// Key Value) when REDIS_URL is set, otherwise by memory, optionally
// snapshotted to a JSON file (DATA_FILE) for local development.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function createStore({ url, prefix = 'wns:', file } = {}) {
  const store = url ? await redisStore(url) : memoryStore(file);
  // Namespace every key so the store can be shared with other apps.
  const k = key => prefix + key;
  return {
    kind: store.kind,
    get: key => store.get(k(key)),
    mget: keys => (keys.length ? store.mget(keys.map(k)) : Promise.resolve([])),
    set: (key, val, ttl) => store.set(k(key), val, ttl),
    del: key => store.del(k(key)),
    sadd: (key, m, ttl) => store.sadd(k(key), m, ttl),
    srem: (key, m) => store.srem(k(key), m),
    smembers: key => store.smembers(k(key)),
    close: () => store.close(),
  };
}

async function redisStore(url) {
  const { createClient } = await import('@redis/client');
  const client = createClient({
    url,
    socket: { reconnectStrategy: n => Math.min(n * 200, 5000) },
  });
  client.on('error', e => console.error('redis:', e.message));
  await client.connect();
  return {
    kind: 'redis',
    get: key => client.get(key),
    mget: keys => client.mGet(keys),
    set: (key, val, ttl) => (ttl ? client.set(key, val, { expiration: { type: 'EX', value: ttl } }) : client.set(key, val)),
    del: key => client.del(key),
    async sadd(key, m, ttl) {
      await client.sAdd(key, m);
      if (ttl) await client.expire(key, ttl);
    },
    srem: (key, m) => client.sRem(key, m),
    smembers: key => client.sMembers(key),
    close: () => client.close(),
  };
}

function memoryStore(file) {
  const kv = new Map(); // key -> { v, exp }
  if (file) {
    try {
      for (const [key, e] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) {
        kv.set(key, { v: Array.isArray(e.v) ? new Set(e.v) : e.v, exp: e.exp });
      }
    } catch {}
  }
  let timer = null;
  const save = () => {
    if (!file || timer) return;
    timer = setTimeout(() => {
      timer = null;
      const out = {};
      for (const [key, e] of kv) out[key] = { v: e.v instanceof Set ? [...e.v] : e.v, exp: e.exp };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify(out));
      renameSync(file + '.tmp', file);
    }, 500);
  };
  const live = key => {
    const e = kv.get(key);
    if (e && e.exp && e.exp < Date.now()) {
      kv.delete(key);
      return undefined;
    }
    return e;
  };
  const exp = ttl => (ttl ? Date.now() + ttl * 1000 : 0);
  return {
    kind: file ? 'file' : 'memory',
    get: async key => live(key)?.v ?? null,
    mget: async keys => keys.map(key => live(key)?.v ?? null),
    async set(key, v, ttl) {
      kv.set(key, { v: String(v), exp: exp(ttl) });
      save();
    },
    async del(key) {
      kv.delete(key);
      save();
    },
    async sadd(key, m, ttl) {
      const e = live(key) || { v: new Set(), exp: 0 };
      e.v.add(m);
      if (ttl) e.exp = exp(ttl);
      kv.set(key, e);
      save();
    },
    async srem(key, m) {
      live(key)?.v.delete(m);
      save();
    },
    smembers: async key => [...(live(key)?.v || [])],
    close: async () => {},
  };
}
