/**
 * Audits — nightly branded PDF reports
 * ====================================
 * A nightly Lambda writes one branded PDF per day to the EVENTS bucket under the
 * `audits/` prefix, named `audits/YYYY-MM-DD.pdf`. These helpers list those PDFs
 * (newest-first) and presign download URLs so the browser fetches them directly
 * from S3 rather than proxying through the server.
 *
 * Read-only, like the rest of the dashboard's S3 access.
 */
import { listAll, presignGet } from './s3';
import { config } from './config';

const AUDIT_PREFIX = 'audits/';

export interface AuditEntry {
  /** Parsed from the filename (YYYY-MM-DD); null if the name doesn't match. */
  date: string | null;
  key: string;
  sizeBytes: number;
  lastModified: string;
}

/**
 * List every audit PDF under the `audits/` prefix, newest-first.
 *
 * Returns:
 *   AuditEntry[] sorted by date (falling back to lastModified), newest first.
 */
export async function listAudits(): Promise<AuditEntry[]> {
  const objs = await listAll(config.eventsBucket, AUDIT_PREFIX);
  return objs
    .filter((o) => o.Key && /\.pdf$/i.test(o.Key))
    .map((o) => {
      const key = o.Key!;
      const name = key.split('/').pop() ?? key;
      const m = name.match(/(\d{4}-\d{2}-\d{2})/);
      return {
        date: m ? m[1] : null,
        key,
        sizeBytes: o.Size ?? 0,
        lastModified: (o.LastModified ?? new Date(0)).toISOString(),
      };
    })
    .sort((a, b) => {
      const ak = a.date ?? a.lastModified;
      const bk = b.date ?? b.lastModified;
      return bk.localeCompare(ak);
    });
}

/** Presign a 1-hour GET URL so the browser can download/preview the PDF directly. */
export async function auditDownloadUrl(key: string): Promise<string> {
  return presignGet(config.eventsBucket, key, 3600);
}
