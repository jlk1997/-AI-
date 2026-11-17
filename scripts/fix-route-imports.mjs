import fs from 'node:fs';

const files = [
  'apps/platform-api/src/routes/auth.ts',
  'apps/platform-api/src/routes/billing.ts',
  'apps/platform-api/src/routes/world.ts',
  'apps/platform-api/src/routes/jobs.ts',
  'apps/platform-api/src/routes/community.ts',
  'apps/platform-api/src/routes/public.ts',
  'apps/platform-api/src/routes/projects.ts',
  'apps/platform-api/src/routes/v1Context.ts',
];

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  src = src.replaceAll("from './lib/", "from '../lib/");
  src = src.replaceAll("from './env.js'", "from '../env.js'");
  src = src.replaceAll("from './routes/", "from './");
  // Drop the extra type import of Hono if Hono is already imported as a value.
  src = src.replace(
    "import type { Hono } from 'hono';\n",
    '',
  );
  fs.writeFileSync(file, src);
  console.log('fixed paths', file);
}
