import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9002',
  forcePathStyle: true,
  credentials: { accessKeyId: 'minio', secretAccessKey: 'minio123' },
});

const key =
  'projects/9ac71e22-2a8b-421f-a325-697e643db15a/artifacts/de462470-a751-4c8b-bdff-686adb137f2f/dist/index.html';
const out = await s3.send(
  new GetObjectCommand({ Bucket: 'opengame-platform', Key: key }),
);
const html = await out.Body!.transformToString('utf-8');
console.log('S3 RAW index.html:');
console.log(html);
