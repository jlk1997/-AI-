/**
 * Incremental platform:dev prepare.
 * Rebuilds a workspace only when dist/ is missing or older than src/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WORKSPACES = [
  '@opengame/platform-db',
  '@opengame/vision-qa',
  '@opengame/asset-forge',
  '@opengame/world-agents',
  '@opengame/module-systems',
  '@opengame/design-compiler',
  '@opengame/world-spec',
  '@opengame/world-sim',
  '@opengame/world-ops',
  '@opengame/world-memory',
  '@opengame/world-planner',
  '@opengame/game-planner',
  '@opengame/world-neural',
  '@opengame/world-runtime',
  '@opengame/runtime',
  '@opengame/module-dialogue',
  '@opengame/module-combat',
  '@opengame/module-world',
  '@opengame/module-td',
  '@opengame/module-board',
  '@opengame/module-cards',
  '@opengame/module-emitter',
  '@opengame/module-platform',
];

function packageDir(name) {
  return path.join(root, 'packages', name.replace('@opengame/', ''));
}

function newestMtime(dir) {
  if (!fs.existsSync(dir)) return 0;
  let newest = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const t = fs.statSync(full).mtimeMs;
        if (t > newest) newest = t;
      }
    }
  };
  walk(dir);
  return newest;
}

function needsBuild(pkgName) {
  const dir = packageDir(pkgName);
  const distJs = path.join(dir, 'dist', 'index.js');
  const src = path.join(dir, 'src');
  if (!fs.existsSync(distJs)) return true;
  if (!fs.existsSync(src)) return false;
  return newestMtime(src) > fs.statSync(distJs).mtimeMs;
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('node', [path.join('scripts', 'dedupe-sharp.mjs')]);

const stale = WORKSPACES.filter((name) => needsBuild(name));
if (stale.length === 0) {
  console.log('platform-dev-prepare: all package dist/ up to date');
} else {
  console.log('platform-dev-prepare: building', stale.join(', '));
  for (const name of stale) {
    run('npm', ['run', 'build', `--workspace=${name}`]);
  }
}

run('npm', ['run', 'migrate', '--workspace=@opengame/platform-db']);
