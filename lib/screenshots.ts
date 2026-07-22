/**
 * @file lib/screenshots.ts
 * @description Paginated S3 screenshots helper for the ServiceSync Dashboard.
 *
 * Fetches screenshot metadata from S3, generates presigned URLs, and returns
 * paginated results sorted by capture timestamp. Screenshots are stored with
 * the key pattern: screenshots/{advisorId}/{YYYY}/{MM}/{DD}/{epoch_ms}.{ext}
 */

import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from './s3';
import { config } from './config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Screenshot {
  /** Full S3 object key */
  key: string;
  /** ISO-8601 timestamp derived from the filename (epoch_ms) */
  timestamp: string;
  /** Presigned GET URL (5-minute expiry) */
  url: string;
  /** Object size in kilobytes */
  sizeKB: number;
}

export interface ScreenshotPage {
  /** Array of screenshot entries for the current page */
  screenshots: Screenshot[];
  /** Opaque cursor for fetching the next page, or null if no more pages */
  nextCursor: string | null;
  /** Convenience flag indicating additional pages exist */
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed image extensions for filtering S3 objects */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Presigned URL expiry in seconds (5 minutes) */
const PRESIGN_EXPIRY_SECONDS = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the file extension from an S3 key (lowercased).
 */
function getExtension(key: string): string {
  const dotIndex = key.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return key.slice(dotIndex).toLowerCase();
}

/**
 * Parses an epoch-millisecond filename (e.g. "1719331200000.jpg") into an
 * ISO-8601 timestamp string.
 */
function parseTimestampFromFilename(key: string): string {
  const filename = key.split('/').pop() ?? '';
  const epochStr = filename.split('.')[0];
  const epochMs = Number(epochStr);

  if (Number.isNaN(epochMs)) {
    // Fallback: return epoch 0 so it sorts predictably
    return new Date(0).toISOString();
  }

  return new Date(epochMs).toISOString();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetches a paginated list of screenshots from S3 for a given advisor and date.
 *
 * @param date      - Target date in YYYY-MM-DD format
 * @param advisorId - Advisor identifier (e.g. 'siltaylor-chevyland')
 * @param cursor    - Optional continuation token for pagination
 * @param limit     - Maximum number of objects to retrieve per page (default 50)
 * @returns A page of screenshot metadata with presigned URLs
 */
export async function getScreenshotPage(
  date: string,
  advisorId: string,
  cursor?: string,
  limit = 50,
): Promise<ScreenshotPage> {
  // 1. Parse date components and build the S3 prefix
  const [year, month, day] = date.split('-');
  const prefix = `screenshots/${advisorId}/${year}/${month}/${day}/`;

  // 2. List objects under the prefix
  const result = await s3().send(
    new ListObjectsV2Command({
      Bucket: config.eventsBucket,
      Prefix: prefix,
      MaxKeys: limit,
      ContinuationToken: cursor || undefined,
    }),
  );

  const objects = result.Contents ?? [];

  // 3. Filter to supported image file types
  const imageObjects = objects.filter((obj) => {
    if (!obj.Key) return false;
    return IMAGE_EXTENSIONS.has(getExtension(obj.Key));
  });

  // 4. Build Screenshot entries with presigned URLs
  const screenshots: Screenshot[] = await Promise.all(
    imageObjects.map(async (obj) => {
      const key = obj.Key!;

      // Parse capture timestamp from the epoch_ms filename
      const timestamp = parseTimestampFromFilename(key);

      // Generate a presigned GET URL (5-minute expiry)
      const url = await getSignedUrl(
        s3(),
        new GetObjectCommand({
          Bucket: config.eventsBucket,
          Key: key,
        }),
        { expiresIn: PRESIGN_EXPIRY_SECONDS },
      );

      // Convert bytes to KB (rounded to 2 decimal places)
      const sizeKB = Math.round(((obj.Size ?? 0) / 1024) * 100) / 100;

      return { key, timestamp, url, sizeKB };
    }),
  );

  // 5. Sort by timestamp ascending
  screenshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // 6. Return the paginated result
  const nextCursor = result.NextContinuationToken || null;

  return {
    screenshots,
    nextCursor,
    hasMore: !!result.NextContinuationToken,
  };
}
