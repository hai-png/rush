import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { loadEnv } from '@addis/shared';

const env = loadEnv();
const client = new S3Client({
  endpoint: env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

export const s3 = {
  async putObject(key: string, body: Buffer, contentType: string) {

    await client.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType,
      ServerSideEncryption: 'AES256',
    }));
  },

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      if (!res.Body) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as Readable) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  },
  async deleteObject(key: string) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    } catch (err) {

      console.error('[s3] deleteObject failed', { key, err: (err as Error).message });
      throw err;
    }
  },
  async presignGet(key: string, expiresInSec: number) {
    return getSignedUrl(client, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn: expiresInSec });
  },
};
