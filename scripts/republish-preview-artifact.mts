/**
 * One-shot: rebuild game workspace and overwrite the preview-dist artifact on MinIO
 * so localhost preview-dist URLs pick up ChoicePanel / UI fixes without a full regen job.
 *
 * Usage (from repo root):
 *   npx tsx scripts/republish-preview-artifact.mts <projectId> <artifactId>
 *   npx tsx scripts/republish-preview-artifact.mts <projectId> <artifactId> --skip-build
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const k = m[1]!;
    let v = m[2] ?? '';
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const args = process.argv.slice(2).filter((a) => a !== '--skip-build');
const skipBuild = process.argv.includes('--skip-build');
const projectId = args[0];
const artifactId = args[1];
if (!projectId || !artifactId) {
  console.error(
    'Usage: npx tsx scripts/republish-preview-artifact.mts <projectId> <artifactId> [--skip-build]',
  );
  process.exit(1);
}

const workspace = path.join(
  root,
  '.platform-work',
  'projects',
  projectId,
  'repo',
);
if (!fs.existsSync(workspace)) {
  console.error('workspace missing:', workspace);
  process.exit(1);
}

if (!skipBuild) {
  console.log('Building', workspace);
  const build = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'build'],
    { cwd: workspace, stdio: 'inherit', shell: true },
  );
  if (build.status !== 0) {
    console.error('build failed');
    process.exit(build.status ?? 1);
  }
}

const distDir = path.join(workspace, 'dist');
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/index.html missing after build');
  process.exit(1);
}

// Sanity: rebuilt bundle must include scene-level ChoicePanel click fix
const assetsDir = path.join(distDir, 'assets');
const jsFiles = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  : [];
let blob = '';
for (const f of jsFiles) {
  blob += fs.readFileSync(path.join(assetsDir, f), 'utf8');
}
if (!/selectChoice/.test(blob)) {
  console.error('Built JS missing selectChoice — aborting upload');
  process.exit(1);
}
if (!/scene-level GameObjects|CHOICE_PANEL_DEPTH|pointerdown/.test(blob)) {
  console.warn(
    'Warning: ChoicePanel click markers not obvious in bundle (still uploading)',
  );
}

const uploadMod = await import(
  pathToFileURL(
    path.join(root, 'apps/platform-worker/dist/uploadDirectory.js'),
  ).href
);
const uploadDirectoryToS3 = uploadMod.uploadDirectoryToS3 as (
  client: S3Client,
  env: { s3Bucket: string },
  s3Prefix: string,
  localDir: string,
) => Promise<{ entryKey: string }>;

const endpoint = process.env.PLATFORM_S3_ENDPOINT ?? 'http://127.0.0.1:9002';
const region = process.env.PLATFORM_S3_REGION ?? 'us-east-1';
const bucket = process.env.PLATFORM_S3_BUCKET ?? 'opengame-platform';
const accessKey = process.env.PLATFORM_S3_ACCESS_KEY ?? 'minio';
const secretKey = process.env.PLATFORM_S3_SECRET_KEY ?? 'minio123';

const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
});

const distPrefix = `projects/${projectId}/artifacts/${artifactId}/dist`;
console.log('Uploading to s3://' + bucket + '/' + distPrefix);
const { entryKey } = await uploadDirectoryToS3(
  s3,
  { s3Bucket: bucket },
  distPrefix,
  distDir,
);
console.log('OK entryKey=', entryKey);
console.log('Hard-refresh the preview (Ctrl+F5). Same deployment URL still works.');
