/**
 * One-shot: upload society presenter dist for a project to its latest artifact prefix.
 * Usage: node scripts/upload-world-preview-dist.mjs <projectId>
 */
import { createRequire } from 'node:module';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const postgres = require('postgres');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const envText = await fsp.readFile(path.join(root, '.env'), 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l.slice(i + 1).trim().replace(/^["']|["']$/g, ''),
      ];
    }),
);

const projectId = process.argv[2];
if (!projectId) {
  console.error('usage: node scripts/upload-world-preview-dist.mjs <projectId>');
  process.exit(1);
}

const distDir = path.join(
  root,
  '.platform-work',
  'projects',
  projectId,
  'repo',
  'dist',
);
try {
  await fsp.access(path.join(distDir, 'index.html'));
} catch {
  console.error('missing dist:', distDir);
  process.exit(1);
}

const sql = postgres(env.PLATFORM_DATABASE_URL, { max: 1 });
const rows = await sql`
  select a.id as artifact_id, a.manifest, a.storage_prefix
  from deployments d
  join artifacts a on a.id = d.artifact_id
  where d.project_id = ${projectId}::uuid
  order by d.created_at desc nulls last
  limit 5
`;
await sql.end({ timeout: 5 });

let distPrefix = null;
for (const row of rows) {
  const m = row.manifest;
  const parsed =
    typeof m === 'string'
      ? JSON.parse(m)
      : m && typeof m === 'object'
        ? m
        : null;
  if (parsed?.distPrefix) {
    distPrefix = String(parsed.distPrefix).replace(/\/+$/, '');
    console.log('using artifact', row.artifact_id, 'prefix', distPrefix);
    break;
  }
  if (row.storage_prefix) {
    distPrefix = `${String(row.storage_prefix).replace(/\/+$/, '')}/dist`;
    console.log('using artifact', row.artifact_id, 'storage', distPrefix);
    break;
  }
}
if (!distPrefix) {
  console.error('no deployment with distPrefix for project', projectId);
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: env.PLATFORM_S3_ENDPOINT,
  region: env.PLATFORM_S3_REGION || 'us-east-1',
  forcePathStyle: env.PLATFORM_S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: env.PLATFORM_S3_ACCESS_KEY,
    secretAccessKey: env.PLATFORM_S3_SECRET_KEY,
  },
});

async function walk(dir) {
  const out = [];
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function ctype(p) {
  const ext = path.extname(p).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.mp3': 'audio/mpeg',
    }[ext] || 'application/octet-stream'
  );
}

const files = await walk(distDir);
let n = 0;
for (const abs of files) {
  const rel = path.relative(distDir, abs).split(path.sep).join('/');
  await s3.send(
    new PutObjectCommand({
      Bucket: env.PLATFORM_S3_BUCKET,
      Key: `${distPrefix}/${rel}`,
      Body: await fsp.readFile(abs),
      ContentType: ctype(abs),
    }),
  );
  n += 1;
}
console.log(`uploaded ${n} files to ${distPrefix}`);
