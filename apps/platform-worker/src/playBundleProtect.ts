/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Light hardening applied to a play bundle *after* Vite has already minified
 * it. This is not DRM — a determined reader can still recover the JavaScript —
 * but it raises the cost of a casual "save as" scrape: comments go, a handful
 * of remaining identifiers get renamed, and PNG files pick up an author tEXt
 * chunk so a stolen atlas still points back here.
 */

const RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'await',
  'enum',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'undefined',
  'NaN',
  'Infinity',
  'window',
  'document',
  'globalThis',
  'self',
  'exports',
  'module',
  'require',
  'define',
  'Phaser',
  'bootstrap',
  '__ogPlayProbe',
  '__ogMobileInput',
  '__ogGame',
  '__OG_PLAY_KEY',
]);

const IDENT = /\b([A-Za-z_][A-Za-z0-9_]{5,})\b/g;

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const REGEX_PREFIX_KW =
  /^(?:return|case|throw|new|delete|void|typeof|yield|await|in|of|instanceof|else|do)$/;

/**
 * Naive `/\/\*[\s\S]*?\*\/` + `\/\/[^\n]*` destroy a Vite one-liner the moment
 * a string contains `//` (`"//cdn"`, `"foo//bar"`, SVG path data). The file
 * is already minified — comments are almost gone — so this walk only drops
 * real comments and leaves strings / regex / templates alone.
 */
function lastCodeWord(src: string, before: number): string {
  let i = before - 1;
  while (i >= 0 && /\s/.test(src[i]!)) i -= 1;
  if (i < 0) return '';
  if (!IDENT_CHAR.test(src[i]!)) return src[i]!;
  let start = i;
  while (start > 0 && IDENT_CHAR.test(src[start - 1]!)) start -= 1;
  return src.slice(start, i + 1);
}

function slashStartsRegex(src: string, slashAt: number): boolean {
  let i = slashAt - 1;
  while (i >= 0 && /\s/.test(src[i]!)) i -= 1;
  if (i < 0) return true;
  if ((src[i] === '+' || src[i] === '-') && src[i - 1] === src[i]) return false;
  const ch = src[i]!;
  if ('({[=,;:!&|?~%<>'.includes(ch) || ch === '+' || ch === '-') return true;
  if (')]}'.includes(ch) || ch === '`' || ch === '"' || ch === "'") return false;
  if (IDENT_CHAR.test(ch)) return REGEX_PREFIX_KW.test(lastCodeWord(src, slashAt));
  return true;
}

function readLineComment(src: string, from: number): number {
  let i = from + 2;
  while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i += 1;
  return i;
}

function readBlockComment(src: string, from: number): number {
  let i = from + 2;
  while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
  return i < src.length ? i + 2 : src.length;
}

function readQuoted(src: string, from: number, quote: '"' | "'"): number {
  let i = from + 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === '\n') return i;
    i += 1;
  }
  return i;
}

function readRegex(src: string, from: number): number {
  let i = from + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']' && inClass) inClass = false;
    else if (c === '/' && !inClass) {
      i += 1;
      while (i < src.length && /[a-z]/i.test(src[i]!)) i += 1;
      return i;
    } else if (c === '\n') return i;
    i += 1;
  }
  return i;
}

function readTemplate(src: string, from: number): { readonly end: number; readonly unclosed: boolean } {
  let i = from + 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return { end: i + 1, unclosed: false };
    if (c === '$' && src[i + 1] === '{') {
      const inner = scanJsRange(src, i + 2, true);
      if (inner.unclosed) return { end: inner.end, unclosed: true };
      i = inner.end;
      continue;
    }
    i += 1;
  }
  return { end: i, unclosed: true };
}

type ScanResult = { readonly text: string; readonly end: number; readonly unclosed: boolean };

function scanJsRange(src: string, start: number, stopAtBrace: boolean): ScanResult {
  let i = start;
  let out = '';
  let depth = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (stopAtBrace) {
      if (c === '{') depth += 1;
      else if (c === '}') {
        if (depth === 0) return { text: out, end: i + 1, unclosed: false };
        depth -= 1;
      }
    }
    if (c === '"' || c === "'") {
      const end = readQuoted(src, i, c);
      if (end <= i + 1 || src[end - 1] !== c) {
        return { text: out + src.slice(i), end: src.length, unclosed: true };
      }
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '`') {
      const tpl = readTemplate(src, i);
      out += src.slice(i, tpl.end);
      if (tpl.unclosed) return { text: out, end: tpl.end, unclosed: true };
      i = tpl.end;
      continue;
    }
    if (c === '/' && n === '/') {
      i = readLineComment(src, i);
      continue;
    }
    if (c === '/' && n === '*') {
      i = readBlockComment(src, i);
      continue;
    }
    if (c === '/') {
      if (n === '=' && !slashStartsRegex(src, i)) {
        out += '/=';
        i += 2;
        continue;
      }
      if (slashStartsRegex(src, i)) {
        const end = readRegex(src, i);
        if (end <= i + 1) {
          return { text: out + src.slice(i), end: src.length, unclosed: true };
        }
        out += src.slice(i, end);
        i = end;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return { text: out, end: i, unclosed: stopAtBrace };
}

export function stripComments(js: string): string {
  return scanJsRange(js, 0, false).text;
}

/** True when a walk ended inside a string / template / regex — typical of a eaten minified file. */
export function jsLiteralsUnclosed(js: string): boolean {
  const t = js.trimStart();
  if (!t) return true;
  if (t.startsWith('<')) return true;
  return scanJsRange(js, 0, false).unclosed;
}

/**
 * The old regex stripper could delete 90%+ of a one-line Vite bundle. If a
 * transform shrinks that much, keep the original — Vite already stripped comments.
 */
export function protectDestroyedBundle(before: string, after: string): boolean {
  if (jsLiteralsUnclosed(after)) return true;
  return before.length > 400 && after.length < Math.floor(before.length * 0.85);
}

export function protectPlayJs(js: string, obfuscate: boolean): string {
  const next = obfuscate ? obfuscatePlayJs(js) : stripComments(js);
  if (protectDestroyedBundle(js, next)) return js;
  return next;
}

/**
 * Renames long identifiers that appear at least twice and are not reserved.
 * Short names are left alone — Vite already mangled those, and touching them
 * is how a transform accidentally breaks `Phaser` or a scene key.
 */
export function mangleLocalIdents(js: string): string {
  const counts = new Map<string, number>();
  for (const match of js.matchAll(IDENT)) {
    const name = match[1]!;
    if (RESERVED.has(name)) continue;
    if (name.startsWith('__og') || name.startsWith('og_')) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const candidates = [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name]) => name);
  if (candidates.length === 0) return js;
  let out = js;
  let i = 0;
  for (const name of candidates) {
    const repl = `_${i.toString(36)}${i}`;
    i += 1;
    out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), repl);
  }
  return out;
}

export function obfuscatePlayJs(js: string): string {
  return mangleLocalIdents(stripComments(js));
}

/**
 * Inserts a `tEXt` chunk (`OpenGame` = handle) just before IEND. A mirrored
 * PNG still carries the author even after the corner watermark is cropped.
 */
export function embedPngAuthorText(png: Buffer, handle: string): Buffer {
  if (png.length < 16 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    return png;
  }
  const keyword = 'OpenGame';
  const text = handle.replace(/[^\x20-\x7e]/g, '_').slice(0, 40);
  const data = Buffer.concat([
    Buffer.from(keyword, 'ascii'),
    Buffer.from([0]),
    Buffer.from(text, 'ascii'),
  ]);
  const crcSrc = Buffer.concat([Buffer.from('tEXt'), data]);
  const crc = crc32(crcSrc);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc, 8 + data.length);

  const iend = png.lastIndexOf(Buffer.from('IEND'));
  if (iend < 4) return png;
  const insertAt = iend - 4;
  return Buffer.concat([png.subarray(0, insertAt), chunk, png.subarray(insertAt)]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
