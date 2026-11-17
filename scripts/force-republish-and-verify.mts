import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectId = '9ac71e22-2a8b-421f-a325-697e643db15a';
const artifactId = 'de462470-a751-4c8b-bdff-686adb137f2f';
const workspace = path.join(root, '.platform-work/projects', projectId, 'repo');
const distDir = path.join(workspace, 'dist');
const prefix = `projects/${projectId}/artifacts/${artifactId}/dist`;

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9002',
  forcePathStyle: true,
  credentials: { accessKeyId: 'minio', secretAccessKey: 'minio123' },
});
const bucket = 'opengame-platform';

async function readKey(key: string): Promise<string> {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return (await out.Body!.transformToString('utf-8')) as string;
}

console.log('1) S3 before:');
const listed = await s3.send(
  new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix + '/', MaxKeys: 40 }),
);
for (const o of listed.Contents ?? []) {
  console.log(' ', o.Key, o.Size, o.LastModified?.toISOString());
}
const beforeHtml = await readKey(prefix + '/index.html');
const beforeJs = beforeHtml.match(/assets\/(index-[^"]+\.js)/)?.[1] ?? '?';
console.log(' before index ->', beforeJs);

console.log('2) Rebuild workspace');
const build = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'build'],
  { cwd: workspace, stdio: 'inherit', shell: true },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const localHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const localJs = localHtml.match(/assets\/(index-[^"]+\.js)/)?.[1] ?? '?';
console.log(' local index ->', localJs);

const jsPath = path.join(distDir, 'assets', localJs);
const jsBlob = fs.readFileSync(jsPath, 'utf8');
const selectedCount = (jsBlob.match(/on\("selected"/g) ?? []).length;
const hasDim = jsBlob.includes('dimDialogueForChoices');
console.log(' local selectedCount=', selectedCount, 'dimDialogue=', hasDim);
if (selectedCount < 2 || !hasDim) {
  console.error('Local build still missing WorldScene choice wiring — abort');
  process.exit(1);
}

console.log('3) Upload overwrite');
const uploadMod = await import(
  pathToFileURL(path.join(root, 'apps/platform-worker/dist/uploadDirectory.js')).href
);
await uploadMod.uploadDirectoryToS3(s3, { s3Bucket: bucket }, prefix, distDir);

console.log('4) S3 after verify:');
const afterHtml = await readKey(prefix + '/index.html');
const afterJs = afterHtml.match(/assets\/(index-[^"]+\.js)/)?.[1] ?? '?';
console.log(' after index ->', afterJs);
if (afterJs !== localJs) {
  console.error('Upload mismatch! S3 still has', afterJs);
  process.exit(1);
}
const afterBlob = await readKey(prefix + '/assets/' + afterJs);
console.log(
  ' after selectedCount=',
  (afterBlob.match(/on\("selected"/g) ?? []).length,
  'dimDialogue=',
  afterBlob.includes('dimDialogueForChoices'),
);
console.log('OK — hard refresh preview now');
