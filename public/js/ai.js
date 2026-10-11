// Client for the optional local AI bridge (bridge/server.mjs). The app works without it.
//
// Served by the bridge on this PC (http://localhost, any port) it just works. On a phone in
// LAN mode, the URL the server prints carries ?key=..., which is remembered here and
// sent with every call. From any other origin it stays silent unless opted in once with
// ?ai=http://127.0.0.1:8787, because probing localhost from a public site makes browsers
// show a permission prompt.

const BASE_KEY = 'voiceRange.aiBridge';
const PAIR_KEY = 'voiceRange.aiKey';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);

const params = new URLSearchParams(location.search);
if (params.get('ai') === 'off') localStorage.removeItem(BASE_KEY);
else if (params.get('ai')) localStorage.setItem(BASE_KEY, params.get('ai'));
if (params.get('key')) {
  localStorage.setItem(PAIR_KEY, params.get('key'));
  params.delete('key');
  history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
}

const pairKey = localStorage.getItem(PAIR_KEY);
const base = localStorage.getItem(BASE_KEY)
  ?? (local || pairKey ? '' : null); // a page the bridge serves has the API on its own address
const auth = pairKey ? { 'x-bridge-key': pairKey } : {};

export async function aiStatus() {
  if (base == null) return null;
  try {
    const r = await fetch(base + '/api/health', { headers: auth, signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// A file from the bridge's local/ folder (your own library, shared with your phone), sent
// with the pairing key like any bridge call.
export async function bridgeFile(path) {
  if (base == null) throw new Error('This page is not connected to the local helper.');
  const r = await fetch(base + path, { headers: auth });
  if (!r.ok) throw new Error(`The helper answered ${r.status} ${r.statusText}.`);
  return r.json();
}

export async function aiAsk(task, input) {
  const r = await fetch(base + '/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ task, input }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `${r.status} ${r.statusText}`);
  return body; // { text, provider, model }
}
