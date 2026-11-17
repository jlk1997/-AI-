import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const root = process.cwd();
const projectId = '9ac71e22-2a8b-421f-a325-697e643db15a';
// Correct UUID from deployment token/DB (48bc — NOT 4c8b)
const artifactFolder = 'de462470-a751-48bc-bdff-686adb137f2f';
const workspace = path.join(root, '.platform-work/projects', projectId, 'repo');
const distDir = path.join(workspace, 'dist');
const prefix = `projects/${projectId}/artifacts/${artifactFolder}/dist`;

console.log('build module-platform');
let r = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'build'],
  {
    cwd: path.join(root, 'packages/module-platform'),
    stdio: 'inherit',
    shell: true,
  },
);
if (r.status !== 0) process.exit(r.status ?? 1);

console.log('build game');
r = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'build'],
  { cwd: workspace, stdio: 'inherit', shell: true },
);
if (r.status !== 0) process.exit(r.status ?? 1);

const localHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const localJs = localHtml.match(/assets\/(index-[^"]+\.js)/)?.[1];
console.log('local js =', localJs);

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9002',
  forcePathStyle: true,
  credentials: { accessKeyId: 'minio', secretAccessKey: 'minio123' },
});
const bucket = 'opengame-platform';
const mod = await import(
  pathToFileURL(path.join(root, 'apps/platform-worker/dist/uploadDirectory.js'))
    .href,
);
await mod.uploadDirectoryToS3(s3, { s3Bucket: bucket }, prefix, distDir);

const after = await s3.send(
  new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/index.html` }),
);
const html = await after.Body!.transformToString('utf-8');
const afterJs = html.match(/assets\/(index-[^"]+\.js)/)?.[1];
console.log('s3 js =', afterJs);

const token =
  'eyJib2R5Ijoie1widlwiOjEsXCJkZXBsb3ltZW50SWRcIjpcImY4NTU4OWIxLTA3NzUtNGQ0Zi1hYmZjLTRiM2I4YzgzYmE1ZlwiLFwiZXhwXCI6MTc4NjQ3ODEyOSxcImRpc3RQcmVmaXhcIjpcInByb2plY3RzLzlhYzcxZTIyLTJhOGItNDIxZi1hMzI1LTY5N2U2NDNkYjE1YS9hcnRpZmFjdHMvZGU0NjI0NzAtYTc1MS00OGJjLWJkZmYtNjg2YWRiMTM3ZjJmL2Rpc3RcIn0iLCJzaWciOiIyX2hFVDdUUU1uUUhmV3hXdUw5NHhubXJlelRieEtLU1lUWU1jNEJ1cEFZIn0';
const apiHtml = await fetch(
  `http://127.0.0.1:3847/v1/preview-dist/f85589b1-0775-4d4f-abfc-4b3b8c83ba5f/${token}/index.html?cb=${Date.now()}`,
).then((res) => res.text());
const apiJs = apiHtml.match(/assets\/(index-[^"]+\.js)/)?.[1];
console.log('api js =', apiJs);
if (apiJs !== localJs) {
  console.error('API mismatch');
  process.exit(1);
}
console.log('OK — hard refresh preview');
