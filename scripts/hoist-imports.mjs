/**
 * Move mid-file import / re-export statements to the top of the file.
 */
import fs from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node hoist-imports.mjs <files...>');
  process.exit(1);
}

function collectStatement(lines, start) {
  let end = start;
  let buf = lines[start];
  while (!/;\s*$/.test(buf) && end + 1 < lines.length) {
    end += 1;
    buf += `\n${lines[end]}`;
  }
  return { end, text: buf };
}

function hoist(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const imports = [];
  const keep = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isImport = /^import\s/.test(line) || /^import['"]/.test(line);
    const isReexport = /^export\s+\{/.test(line) && /from\s+['"]/.test(line);
    const isExportStar = /^export\s+\*\s+from\s+['"]/.test(line);
    if (isImport || isReexport || isExportStar) {
      const stmt = collectStatement(lines, i);
      imports.push(stmt.text);
      i = stmt.end;
      continue;
    }
    keep.push(line);
  }

  // Drop leading blank lines in keep after license, then insert imports
  // after the first license / comment preamble.
  let insertAt = 0;
  while (insertAt < keep.length && (keep[insertAt].startsWith('/*') || keep[insertAt].startsWith(' *') || keep[insertAt].startsWith('*/') || keep[insertAt] === '' || keep[insertAt].startsWith('/**'))) {
    if (keep[insertAt] === '*/') {
      insertAt += 1;
      break;
    }
    insertAt += 1;
  }
  // skip extra blank
  while (insertAt < keep.length && keep[insertAt] === '') insertAt += 1;

  const unique = [];
  const seen = new Set();
  for (const imp of imports) {
    if (seen.has(imp)) continue;
    seen.add(imp);
    unique.push(imp);
  }

  const out = [
    ...keep.slice(0, insertAt),
    '',
    ...unique,
    '',
    ...keep.slice(insertAt),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return out.endsWith('\n') ? out : `${out}\n`;
}

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const after = hoist(before);
  fs.writeFileSync(file, after);
  console.log('hoisted', file);
}
