// Serves the built client from memory. Fingerprinted files under /a/ are
// cached forever; everything else revalidates with an ETag. Brotli and gzip
// versions are precompressed at build time.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

export function loadStatic(dir) {
  const files = new Map();
  if (!existsSync(dir)) return files;
  const walk = d => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (!/\.(br|gz)$/.test(name)) {
        const body = readFileSync(full);
        const url = '/' + relative(dir, full).split('\\').join('/');
        files.set(url, {
          body,
          type: TYPES[extname(name)] || 'application/octet-stream',
          etag: '"' + createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"',
          br: existsSync(full + '.br') ? readFileSync(full + '.br') : null,
          gz: existsSync(full + '.gz') ? readFileSync(full + '.gz') : null,
          immutable: url.startsWith('/a/'),
        });
      }
    }
  };
  walk(dir);
  return files;
}

export function serveFile(req, res, file, headers = {}) {
  const h = {
    'Content-Type': file.type,
    'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: file.etag,
    Vary: 'Accept-Encoding',
    ...headers,
  };
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, h);
    return res.end();
  }
  const accept = req.headers['accept-encoding'] || '';
  let body = file.body;
  if (file.br && /\bbr\b/.test(accept)) {
    body = file.br;
    h['Content-Encoding'] = 'br';
  } else if (file.gz && /\bgzip\b/.test(accept)) {
    body = file.gz;
    h['Content-Encoding'] = 'gzip';
  }
  h['Content-Length'] = body.length;
  res.writeHead(200, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}
