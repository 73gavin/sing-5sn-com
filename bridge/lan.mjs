// LAN mode helpers: this machine's IPv4 addresses, a self-signed certificate covering
// them (phones only allow the mic over HTTPS), and a pairing key so other devices on
// the network cannot use the AI provider. Everything lives in bridge/certs/ (gitignored).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./certs/', import.meta.url));

// Git for Windows ships openssl but does not put it on the PowerShell PATH.
function openssl() {
  const candidates = [process.env.OPENSSL, 'C:/Program Files/Git/mingw64/bin/openssl.exe', 'C:/Program Files/Git/usr/bin/openssl.exe'];
  return candidates.find((p) => p && existsSync(p)) || 'openssl';
}

// [{ ip, adapter }] for every non-internal IPv4 address.
export function lanAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([adapter, list]) =>
    list.filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ ip: a.address, adapter })));
}

// Regenerated when the machine's addresses change, since the cert must name them.
export function loadCert(ips) {
  mkdirSync(DIR, { recursive: true });
  const key = DIR + 'key.pem', cert = DIR + 'cert.pem', names = DIR + 'names.txt';
  const want = ['localhost', '127.0.0.1', ...ips].join(',');
  if (!existsSync(cert) || !existsSync(names) || readFileSync(names, 'utf8') !== want) {
    const san = ['DNS:localhost', ...want.split(',').slice(1).map((ip) => `IP:${ip}`)].join(',');
    execFileSync(openssl(), [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-keyout', key, '-out', cert, '-subj', '/CN=voice-range-local', '-addext', `subjectAltName=${san}`,
    ], { stdio: 'ignore' });
    writeFileSync(names, want);
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

export function pairingKey() {
  mkdirSync(DIR, { recursive: true });
  const file = DIR + 'pairing-key.txt';
  if (!existsSync(file)) writeFileSync(file, randomBytes(12).toString('base64url'));
  return readFileSync(file, 'utf8').trim();
}
