/**
 * Polls an HTTP(S) URL until it returns 2xx or timeout (for dev startup ordering).
 * Usage: node scripts/wait-http.mjs <url> [timeoutSeconds]
 * @example node scripts/wait-http.mjs http://127.0.0.1:3847/health 120
 */
const url = process.argv[2] ?? 'http://127.0.0.1:3847/health';
const timeoutSec = Math.max(1, Number(process.argv[3] ?? 120));
const deadline = Date.now() + timeoutSec * 1000;
const intervalMs = 400;

// eslint-disable-next-line no-console
console.error(`wait-http: waiting for ${url} (up to ${timeoutSec}s)...`);

while (Date.now() < deadline) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      // eslint-disable-next-line no-console
      console.error(`wait-http: ${url} is ready (${res.status})`);
      process.exit(0);
    }
  } catch {
    // still starting
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}

// eslint-disable-next-line no-console
console.error(`wait-http: timed out after ${timeoutSec}s — ${url}`);
process.exit(1);
