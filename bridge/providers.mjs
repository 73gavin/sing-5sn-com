// AI providers. Each one is { name, model, complete({ system, prompt }) -> Promise<string> }.
// Adding a provider means adding one function here and one case in fromEnv().

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Claude Code in print mode, using whatever login `claude` already has.
// Runs with no tools, no MCP servers, no saved session, from an empty directory so no
// project CLAUDE.md gets pulled in: a plain text-in, text-out call.
export function claudeCli({ bin = 'claude', model, timeoutMs = 180_000 }) {
  const cwd = join(tmpdir(), 'voice-range-bridge');
  mkdirSync(cwd, { recursive: true });

  return {
    name: 'claude-cli',
    model,
    complete({ system, prompt }) {
      const args = ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--system-prompt', system];
      if (model) args.push('--model', model);
      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { cwd, windowsHide: true });
        let out = '', err = '';
        const timer = setTimeout(() => child.kill(), timeoutMs);
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(new Error(`could not run "${bin}": ${e.message} (set CLAUDE_BIN to the full path of claude.exe)`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          let j;
          try {
            j = JSON.parse(out);
          } catch {
            return reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 500)}`));
          }
          if (j.is_error) return reject(new Error(String(j.result || 'claude reported an error')));
          resolve(String(j.result ?? ''));
        });
        child.stdin.end(prompt);
      });
    },
  };
}

// Ollama (https://ollama.com), fully local open-weight models.
export function ollama({ url = 'http://127.0.0.1:11434', model = 'llama3.2' }) {
  return {
    name: 'ollama',
    model,
    async complete({ system, prompt }) {
      const r = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      });
      if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
      return (await r.json()).message.content;
    },
  };
}

// Anything that speaks the OpenAI chat completions API: llama.cpp server, LM Studio,
// vLLM, LocalAI, Jan, and most hosted services.
export function openaiCompat({ baseUrl = 'http://127.0.0.1:8080/v1', model = 'local', apiKey }) {
  return {
    name: 'openai-compatible',
    model,
    async complete({ system, prompt }) {
      const r = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      });
      if (!r.ok) throw new Error(`${baseUrl} ${r.status}: ${await r.text()}`);
      return (await r.json()).choices[0].message.content;
    },
  };
}

export function fromEnv(env = process.env) {
  const provider = env.AI_PROVIDER || 'claude';
  switch (provider) {
    case 'claude':
      return claudeCli({ bin: env.CLAUDE_BIN || 'claude', model: env.AI_MODEL });
    case 'ollama':
      return ollama({ url: env.OLLAMA_URL, model: env.AI_MODEL });
    case 'openai':
      return openaiCompat({ baseUrl: env.OPENAI_BASE_URL, model: env.AI_MODEL, apiKey: env.OPENAI_API_KEY });
    default:
      throw new Error(`unknown AI_PROVIDER "${provider}" (use claude, ollama, or openai)`);
  }
}
