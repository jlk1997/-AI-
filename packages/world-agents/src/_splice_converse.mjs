import fs from 'node:fs';

const p = new URL('./converse.ts', import.meta.url);
const s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('  const llmAttempted = Boolean(input.llm);');
const end = s.indexOf('  const asciiSummary = isAsciiCopy(');
if (start < 0 || end < 0) throw new Error(`markers ${start} ${end}`);
const mid = `  const llmAttempted = Boolean(input.llm);
  if (!turns.length) {
    // Visible speech comes from the model. Stock paraphrases used to fill the
    // log, then the next retrieval treated that filler as news.
    skipEvent = true;
    degraded = true;
    skipReason ??= llmAttempted ? 'error' : 'filtered';
  }

`;
fs.writeFileSync(p, s.slice(0, start) + mid + s.slice(end));
console.log('spliced', end - start);
