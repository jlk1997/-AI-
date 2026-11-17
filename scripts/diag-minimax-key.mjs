import { config } from 'dotenv';
import { readFileSync } from 'node:fs';

config();

function inspect(name) {
  const raw = process.env[name] ?? '';
  const trimmed = raw.trim();
  console.log('---', name);
  console.log('rawLen', raw.length, 'trimLen', trimmed.length);
  console.log('prefix', trimmed.slice(0, 12));
  console.log('suffix', trimmed.slice(-8));
  console.log('hasQuotes', /^["']|["']$/.test(raw));
  console.log('hasNewline', /[\r\n]/.test(raw));
  console.log('hasSpace', /\s/.test(trimmed));
  console.log('looksJwt', trimmed.startsWith('eyJ'));
}

for (const name of [
  'OPENGAME_REASONING_API_KEY',
  'MINIMAX_API_KEY',
  'OPENAI_API_KEY',
]) {
  inspect(name);
}

const baseUrl = (
  process.env.OPENGAME_REASONING_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  'https://api.minimaxi.com/v1'
).replace(/\/+$/, '');
const model =
  process.env.OPENGAME_SOCIETY_MODEL?.trim() ||
  process.env.OPENGAME_REASONING_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  'MiniMax-M2.7-highspeed';

async function probe(label, apiKey) {
  const key = apiKey.trim();
  const url = `${baseUrl}/chat/completions`;
  console.log('\n=== probe', label, '===');
  console.log('url', url, 'model', model);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回复：ok' }],
        max_completion_tokens: 32,
        temperature: 0.2,
        stream: false,
      }),
    });
    const text = await res.text();
    console.log('status', res.status);
    console.log('body', text.slice(0, 400));
  } catch (err) {
    console.log('fetch error', err instanceof Error ? err.message : err);
  }
}

const reasoning = process.env.OPENGAME_REASONING_API_KEY ?? '';
const minimax = process.env.MINIMAX_API_KEY ?? '';
await probe('REASONING', reasoning);
if (minimax.trim() !== reasoning.trim()) {
  await probe('MINIMAX', minimax);
}
