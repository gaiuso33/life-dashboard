// Static server for the built app that sends the same security headers as production (from vercel.json),
// so the tests exercise the real Content-Security-Policy. Usage: node e2e/serve.mjs <dir> <port>
// CSP_EXTRA_CONNECT adds an origin to connect-src (used to let the cloud build talk to the local mock server).
import http from 'http';
import fs from 'fs';
import path from 'path';

const [dir = 'dist-e2e', port = '4173'] = process.argv.slice(2);
const root = path.resolve(dir);
const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const headers = {};
for (const block of config.headers ?? []) if (block.source === '/(.*)') for (const h of block.headers) headers[h.key] = h.value;
if (process.env.CSP_EXTRA_CONNECT && headers['Content-Security-Policy']) {
  headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('connect-src', `connect-src ${process.env.CSP_EXTRA_CONNECT}`);
}
const rewrites = Object.fromEntries((config.rewrites ?? []).map((r) => [r.source, r.destination]));
const redirects = Object.fromEntries((config.redirects ?? []).map((r) => [r.source, r.destination]));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Test hook: GET /__bump makes sw.js and the page differ from now on, like a new deploy would, so update behaviour can be tested.
let bumps = 0;

http
  .createServer((req, res) => {
    const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (raw === '/__bump') {
      bumps++;
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(String(bumps));
    }
    if (redirects[raw]) {
      res.writeHead(307, { location: redirects[raw] + new URL(req.url, 'http://x').search });
      return res.end();
    }
    const name = rewrites[raw] ?? raw;
    const file = path.join(root, name === '/' ? 'index.html' : name);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { ...headers, 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    let body = fs.readFileSync(file);
    if (bumps && raw === '/sw.js') body = Buffer.concat([body, Buffer.from(`\n// bump ${bumps}\n`)]);
    else if (bumps && file.endsWith('.html')) body = Buffer.from(body.toString('utf8').replace('<head>', `<head><meta name="bump" content="${bumps}">`));
    res.end(body);
  })
  .listen(Number(port), () => console.log(`serving ${dir} on ${port}`));
