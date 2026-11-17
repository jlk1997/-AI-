#!/usr/bin/env node
/**
 * @imgly/background-removal-node pins sharp@0.32.x under its own node_modules.
 * On Windows, loading that build together with the hoisted sharp breaks with
 * ERR_DLOPEN_FAILED. Remove the nested copy so both use the workspace sharp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nested = path.join(
  root,
  'node_modules',
  '@imgly',
  'background-removal-node',
  'node_modules',
  'sharp',
);

if (fs.existsSync(nested)) {
  fs.rmSync(nested, { recursive: true, force: true });
  console.log('[dedupe-sharp] removed nested @imgly/background-removal-node/sharp');
}
