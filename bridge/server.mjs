// Local server: serves public/ and exposes the AI bridge.
//
//   node bridge/server.mjs                          # 127.0.0.1 only, uses `claude -p`
//   node bridge/server.mjs --lan                    # HTTPS on the LAN, for phones/tablets
//   AI_PROVIDER=ollama AI_MODEL=qwen3 node bridge/server.mjs
//   AI_PROVIDER=openai OPENAI_BASE_URL=http://127.0.0.1:8080/v1 node bridge/server.mjs
//
// GET  /api/health  -> { ok, provider, model, tasks }
// POST /api/ai      { task, input } -> { text, provider, model }
// GET  /api/local/<file>  -> a file from local/ (your own song library, say), for your other
//                            devices; local/ is outside public/ and not in git, so it is never
//                            published
//
// In LAN mode, API calls from other devices must send the pairing key (x-bridge-key);
// the printed URL carries it once (?key=...) and the page remembers it.

import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromEnv } from './providers.mjs';
import { tasks } from './tasks.mjs';
import { lanAddresses, loadCert, pairingKey } from './lan.mjs';

const PORT = Number(process.env.PORT || 8787);
const LAN = process.argv.includes('--lan') || ['1', 'true', 'yes'].includes((process.env.LAN || '').toLowerCase());
const ROOT = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const LOCAL = resolve(fileURLToPath(new URL('../local', import.meta.url)));
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BODY = 64 * 1024;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const ai = fromEnv();
const addrs = LAN ? lanAddresses() : [];
const ips = addrs.map((a) => a.ip);
const KEY = LAN ? pairingKey() : null;

const hostname = (host) => (host || '').replace(/:\d+$/, '');
const isLoopback = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname(host));
const isOurs = (host) => isLoopback(host) || ips.includes(hostname(host));
const fromLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function keyOk(req) {
  if (!LAN || fromLoopback(req)) return true;
  const got = Buffer.from(String(req.headers['x-bridge-key'] || ''));
  const want = Buffer.from(KEY);
  return got.length === want.length && timingSafeEqual(got, want);
}

function allowedOrigin(origin) {
  if (!origin) return true; // curl, same-origin GET
  try {
    return isOurs(new URL(origin).host) || EXTRA_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(status, { 'content-type': json ? 'application/json' : 'text/plain', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error('request too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(ROOT + sep)) return send(res, 403, 'forbidden');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, 'not found');
  }
}

async function handle(req, res) {
  // Refuse other hostnames (DNS rebinding) and other sites' pages.
  if (!isOurs(req.headers.host)) return send(res, 403, 'forbidden host');
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) return send(res, 403, { error: 'origin not allowed; add it to ALLOWED_ORIGINS' });
  const cors = origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};

  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      ...cors,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'content-type, x-bridge-key',
      'access-control-allow-private-network': 'true',
    });
  }
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/') && !keyOk(req)) {
    return send(res, 401, { error: 'pairing key missing or wrong; open the URL the server printed' }, cors);
  }

  if (url.pathname.startsWith('/api/local/') && req.method === 'GET') {
    const name = decodeURIComponent(url.pathname.slice('/api/local/'.length));
    const file = normalize(join(LOCAL, name));
    if (!file.startsWith(LOCAL + sep) || name.includes('/')) return send(res, 403, { error: 'forbidden' }, cors);
    try {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...cors });
      return res.end(await readFile(file));
    } catch {
      return send(res, 404, { error: 'not found' }, cors);
    }
  }

  if (url.pathname === '/api/health') {
    return send(res, 200, { ok: true, provider: ai.name, model: ai.model || null, tasks: Object.keys(tasks) }, cors);
  }

  if (url.pathname === '/api/ai' && req.method === 'POST') {
    const started = Date.now();
    try {
      const { task, input } = await readJson(req);
      const t = tasks[task];
      if (!t) return send(res, 400, { error: `unknown task "${task}"` }, cors);
      const text = await ai.complete({ system: t.system, prompt: t.prompt(input) });
      console.log(`${task}: ${ai.name} ${Date.now() - started} ms`);
      return send(res, 200, { text, provider: ai.name, model: ai.model || null }, cors);
    } catch (e) {
      console.error(`ai error: ${e.message}`);
      return send(res, 500, { error: e.message }, cors);
    }
  }

  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, 'method not allowed');
}

const server = LAN ? createHttpsServer(loadCert(ips), handle) : createServer(handle);
server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`AI provider: ${ai.name}${ai.model ? ` (${ai.model})` : ''}`);
  if (!LAN) return console.log(`Voice range app: http://localhost:${PORT}`);
  console.log(`Voice range app on this PC: https://localhost:${PORT}`);
  console.log('On a phone or tablet on the same network, open one of:');
  for (const { ip, adapter } of addrs) console.log(`  https://${ip}:${PORT}/?key=${KEY}   (${adapter})`);
  console.log('The browser will warn about the self-signed certificate: choose Advanced, then proceed.');
});
