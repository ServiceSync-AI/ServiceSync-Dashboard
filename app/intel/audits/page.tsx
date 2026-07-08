/**
 * Audits (/intel/audits) — nightly branded PDF reports
 * ====================================================
 * Browse and download the nightly audit PDFs a Lambda writes to the EVENTS
 * bucket under `audits/` (one per day, `audits/YYYY-MM-DD.pdf`). The latest
 * report is embedded inline for a quick preview; every report has a presigned
 * Download link (1-hour URLs, minted server-side).
 *
 * Server-rendered; presigned URLs are generated per request so they never go
 * stale. Degrades to a graceful "unavailable" card if the S3 read fails
 * (mirrors the Recovery page).
 */
import { listAudits, auditDownloadUrl, type AuditEntry } from '@/lib/audits';
import { formatBytes } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AuditsPage() {
  let audits: AuditEntry[] = [];
  let latestUrl: string | null = null;
  const urls: Record<string, string> = {};
  let error: string | null = null;

  try {
    audits = await listAudits();
    // Presign every entry's download link + the latest for the inline preview.
    await Promise.all(
      audits.map(async (a) => {
        urls[a.key] = await auditDownloadUrl(a.key);
      }),
    );
    latestUrl = audits.length > 0 ? urls[audits[0].key] : null;
  } catch (err) {
    error = String((err as Error).message);
  }

  return (
    <div className="px-6 py-5">
      <header className="mb-5">
        <h1 className="font-display text-xl font-bold tracking-tight">Nightly Audits</h1>
        <p className="text-2xs text-muted">
          Branded PDF reports · one per day (~3am ET) · {audits.length} report
          {audits.length === 1 ? '' : 's'}
        </p>
      </header>

      {error ? (
        <div className="card border-l-2 border-l-danger">
          <span className="stat-label text-danger">Audits unavailable</span>
          <p className="mt-2 text-sm text-fg/90">
            The audit reports couldn&apos;t be listed. Most likely the dashboard&apos;s AWS identity is
            missing S3 read access on the{' '}
            <span className="font-mono text-cyan">audits/</span> prefix.
          </p>
          <p className="mt-2 font-mono text-2xs text-muted">{error}</p>
        </div>
      ) : audits.length === 0 ? (
        <div className="card text-xs text-muted">
          No audits yet — the nightly job writes one per day (~3am ET).
        </div>
      ) : (
        <>
          {/* Inline preview of the latest report. */}
          {latestUrl && (
            <div className="card mb-5 p-0">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                <span className="stat-label">Latest · {audits[0].date ?? audits[0].key}</span>
                <a
                  href={latestUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="badge bg-cyan/15 text-cyan hover:bg-cyan/25"
                >
                  Download PDF
                </a>
              </div>
              <iframe
                src={latestUrl}
                title={`Audit ${audits[0].date ?? audits[0].key}`}
                className="w-full h-[600px] rounded-b border-0"
              />
            </div>
          )}

          {/* All reports. */}
          <div className="card overflow-x-auto p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="text-right">Size</th>
                  <th className="text-right">Report</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.key}>
                    <td className="text-fg">{a.date ?? a.key.split('/').pop()}</td>
                    <td className="text-right text-muted">{formatBytes(a.sizeBytes)}</td>
                    <td className="text-right">
                      <a
                        href={urls[a.key]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan hover:underline"
                      >
                        Download PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 text-2xs text-muted">
            Download links are presigned and expire ~1 hour after this page loads · refresh to renew.
          </p>
        </>
      )}
    </div>
  );
}
