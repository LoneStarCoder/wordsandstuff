// Builds dist/: bundles and minifies the client, packs the dictionary,
// fingerprints files that can be cached forever, and precompresses
// everything with brotli and gzip.
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { loadWords, buildDawg } from './dawg-build.js';
import { pack } from '../shared/dict/pack.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'client');
const dist = join(root, 'dist');
const hash = buf => createHash('sha256').update(buf).digest('base64url').slice(0, 10);

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'a'), { recursive: true });

const emit = (name, ext, contents) => {
  const file = `a/${name}.${hash(contents)}.${ext}`;
  writeFileSync(join(dist, file), contents);
  return file;
};

// 1. Dictionary
const words = loadWords([join(root, 'data/enable1.txt'), join(root, 'data/supplement.txt')]);
const dict = emit('dict', 'bin', pack(buildDawg(words)));

// 2. Scripts
const bundle = async (entry, define) => {
  const res = await build({
    entryPoints: [join(client, entry)],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
    define,
    write: false,
    legalComments: 'none',
  });
  return res.outputFiles[0].contents;
};
const app = emit('app', 'js', await bundle('js/main.js', { DICT_URL: JSON.stringify('/' + dict) }));

// 3. Styles
const css = emit(
  'app',
  'css',
  (await transform(readFileSync(join(client, 'css/app.css'), 'utf8'), { loader: 'css', minify: true, target: ['chrome100', 'safari15', 'firefox100'] })).code,
);

// 4. HTML, manifest, icons
const html = readFileSync(join(client, 'index.html'), 'utf8')
  .replace('__CSS__', '/' + css)
  .replace('__JS__', '/' + app)
  .replace(/\n\s*/g, '\n');
writeFileSync(join(dist, 'index.html'), html);
writeFileSync(join(dist, 'manifest.webmanifest'), JSON.stringify(JSON.parse(readFileSync(join(client, 'manifest.webmanifest'), 'utf8'))));
cpSync(join(client, 'icons'), join(dist, 'icons'), { recursive: true });

// 5. Service worker: precache only the small app shell; the word list is
//    cached the first time someone plays the bot or the daily board.
const shell = ['/', '/' + app, '/' + css, '/manifest.webmanifest', '/icons/icon.svg'];
const version = hash(shell.join() + dict);
const sw = readFileSync(join(client, 'sw.js'), 'utf8')
  .replace('__VERSION__', version)
  .replace('__SHELL__', JSON.stringify(shell))
  .replace('__LAZY__', JSON.stringify(['/' + dict]));
writeFileSync(join(dist, 'sw.js'), (await transform(sw, { minify: true, target: 'es2020' })).code);

writeFileSync(join(dist, 'manifest.json'), JSON.stringify({ dict, app, css, version }));

// 6. Precompress
const report = [];
const walk = d => {
  for (const name of readdirSync(d)) {
    const full = join(d, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name !== 'manifest.json' && !['.png'].includes(extname(name))) {
      const raw = readFileSync(full);
      const br = zlib.brotliCompressSync(raw, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
      });
      const gz = zlib.gzipSync(raw, { level: 9 });
      if (br.length < raw.length) writeFileSync(full + '.br', br);
      if (gz.length < raw.length) writeFileSync(full + '.gz', gz);
      report.push([full.slice(dist.length + 1), raw.length, Math.min(br.length, raw.length)]);
    }
  }
};
walk(dist);

const kb = n => (n / 1024).toFixed(1).padStart(7) + ' KB';
console.log('file'.padEnd(34), '    raw', '   brotli');
for (const [f, raw, br] of report.sort((a, b) => b[2] - a[2])) console.log(f.padEnd(34), kb(raw), kb(br));
const first = report.filter(([f]) => ['index.html', app, css].includes(f)).reduce((s, r) => s + r[2], 0);
console.log(`\nFirst visit (html + js + css, brotli): ${kb(first).trim()} · ${words.length} words`);
