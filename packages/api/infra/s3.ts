import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const client = new S3Client({
  endpoint: env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

export const s3 = {
  async putObject(key: string, body: Buffer, contentType: string) {
    // Server-side encryption: contractor documents (licenses, insurance,
    // inspection certificates) are PII. Without SSE, a misconfigured bucket
    // (or a snapshot leak) leaves them in plaintext at rest. AES256 is free
    // on S3/MinIO and has zero performance impact.
    await client.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType,
      ServerSideEncryption: 'AES256',
    }));
  },
  async deleteObject(key: string) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    } catch (err) {
      // Don't swallow — log and rethrow so the caller can decide. The
      // previous implementation silently ignored S3 delete failures,
      // leaving orphaned objects in the bucket.
      console.error('[s3] deleteObject failed', { key, err: (err as Error).message });
      throw err;
    }
  },
  async presignGet(key: string, expiresInSec: number) {
    return getSignedUrl(client, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn: expiresInSec });
  },
};
