/**
 * S3 helpers — Pilot Intelligence Dashboard
 * =========================================
 * Thin wrappers over the AWS SDK v3 S3 client: a shared singleton client, full
 * (paginated) prefix listing, object body fetching as buffer/string, gunzip for
 * the gzipped JSONL event files, and presigned URLs for browser audio playback.
 *
 * All functions read only — the dashboard never mutates the pilot buckets.
 */
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { gunzipSync } from 'node:zlib';
import { config } from './config';

// Single client reused across invocations (warm Lambda / dev server).
let client: S3Client | null = null;

export function s3(): S3Client {
  if (!client) {
    client = new S3Client({ region: config.aws.region });
  }
  return client;
}

/**
 * List every object under a prefix, following pagination to completion.
 *
 * Args:
 *   bucket: bucket name.
 *   prefix: key prefix to list (e.g. "siltaylor/").
 *
 * Returns:
 *   All matching objects (Key, Size, LastModified), oldest-or-newest order as
 *   returned by S3 — callers sort as needed.
 */
export async function listAll(bucket: string, prefix: string): Promise<_Object[]> {
  const out: _Object[] = [];
  let token: string | undefined;
  do {
    const res = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    if (res.Contents) out.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Fetch an object's raw bytes. */
export async function getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Fetch an object's body as a UTF-8 string. */
export async function getObjectText(bucket: string, key: string): Promise<string> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return res.Body!.transformToString();
}

/**
 * Fetch a gzipped object and return the decompressed UTF-8 text.
 * Used for the gzipped JSONL browser-event files. Tolerates objects that are
 * already plain text (e.g. re-uploaded uncompressed) by detecting the gzip
 * magic bytes first.
 */
export async function getGzippedText(bucket: string, key: string): Promise<string> {
  const buf = await getObjectBuffer(bucket, key);
  // gzip magic number: 0x1f 0x8b
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf).toString('utf-8');
  }
  return buf.toString('utf-8');
}

/**
 * Presign a GET URL for an object so the browser can stream it directly.
 * Used for audio playback to avoid proxying large MP3s through the server.
 */
export async function presignGet(
  bucket: string,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn,
  });
}
