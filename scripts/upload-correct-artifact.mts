import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const root = process.cwd();
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9002',
  forcePathStyle: true,
  credentials: { accessKeyId: 'minio', secretAccessKey: 'minio123' },
});
const bucket = 'opengame-platform';
// CORRECT prefix from DB/token (48bc), NOT the mis-read 4c8b path
const prefix =
  'projects/9ac71e22-2a8b-421f-a325-697e643db15a/artifacts/de462470-a751-48bc-bdff-686adb137f2f/dist';
const distDir = path.join(
  root,
  '.platform-work/projects/9ac71e22-2a8b-421f-a325-697e643db15a/repo/dist',
);

const localHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const localJs = localHtml.match(/assets\/(index-[^"]+\.js)/)?.[1];
console.log('local js =', localJs);

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

const js = await s3.send(
  new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/assets/${afterJs}` }),
);
const blob = await js.Body!.transformToString('utf-8');
console.log(
  'selectedCount=',
  (blob.match(/on\("selected"/g) ?? []).length,
  'hasDim=',
  blob.includes('dimDialogueForChoices'),
);

// Verify via API
const token =
  'eyJib2R5Ijoie1widlwiOjEsXCJkZXBsb3ltZW50SWRcIjpcImY4NTU4OWIxLTA3NzUtNGQ0Zi1hYmZjLTRiM2I4YzgzYmE1ZlwiLFwiZXhwXCI6MTc4NjQ4MDQ0NSxcImRpc3RQcmVmaXhcIjpcInByb2plY3RzLzlhYzcxZTIyLTJhOGItNDIxZi1hMzI1LTY5N2U2NDNkYjE1YS9hcnRpZmFjdHMvZGU0NjI0NzAtYTc1MS00OGJjLWJkZmYtNjg2YWRiMTM3ZjJmL2Rpc3RcIn0iLCJzaWciOiJpY0UxMThKWE1CaC1PZzVqQ25kUlg4MDV1cG5VcTdkRUhGLXJGT0xnYm1BIn0';
const apiHtml = await fetch(
  `http://127.0.0.1:3847/v1/preview-dist/f85589b1-0775-4d4f-abfc-4b3b8c83ba5f/${token}/index.html?cb=${Date.now()}`,
).then((r) => r.text());
const apiJs = apiHtml.match(/assets\/(index-[^"]+\.js)/)?.[1];
console.log('api js =', apiJs);
if (apiJs !== localJs) {
  console.error('API still serving old bundle!');
  process.exit(1);
}
console.log('OK — preview API serves new bundle');
