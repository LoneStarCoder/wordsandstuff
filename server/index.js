// Entry point. Environment:
//   PORT            port to listen on (Render sets this)
//   REDIS_URL       Render Key Value connection string; memory store if unset
//   KEY_PREFIX      namespace for keys in a shared store (default "wns:")
//   DATA_FILE       with no REDIS_URL, snapshot memory to this JSON file
//   PUBLIC_URL      site URL (defaults to Render's RENDER_EXTERNAL_URL)
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   optional fixed push keys
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { Dawg } from '../shared/dict/dawg.js';
import { unpack } from '../shared/dict/pack.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

async function loadDict() {
  const manifest = join(dist, 'manifest.json');
  if (existsSync(manifest)) {
    const { dict } = JSON.parse(readFileSync(manifest, 'utf8'));
    return new Dawg(unpack(readFileSync(join(dist, dict))));
  }
  // No build yet (tests / first run): build from the word list.
  const { loadWords, buildDawg } = await import('../tools/dawg-build.js');
  return new Dawg(buildDawg(loadWords([join(root, 'data/enable1.txt'), join(root, 'data/supplement.txt')])));
}

const env = process.env;
const store = await createStore({ url: env.REDIS_URL, prefix: env.KEY_PREFIX || 'wns:', file: env.DATA_FILE });
const dict = await loadDict();
const app = await createApp({
  store,
  dict,
  staticDir: dist,
  publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || 'http://localhost',
});
const port = +env.PORT || 3000;
app.server.listen(port, () => console.log(`Words and Stuff on :${port} (store: ${store.kind})`));

const stop = () => {
  app.close();
  store.close().finally(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
