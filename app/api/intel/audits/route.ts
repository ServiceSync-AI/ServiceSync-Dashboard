/**
 * GET /api/intel/audits — list nightly audit PDFs
 * ===============================================
 * Lists every PDF under the `audits/` prefix in the EVENTS bucket, newest-first,
 * each entry carrying a fresh 1-hour presigned download URL.
 *
 * Returns: (AuditEntry & { url })[]
 */
import { NextResponse } from 'next/server';
import { listAudits, auditDownloadUrl } from '@/lib/audits';

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET() {
  try {
    const audits = await listAudits();
    const withUrls = await Promise.all(
      audits.map(async (a) => ({ ...a, url: await auditDownloadUrl(a.key) })),
    );
    return NextResponse.json(withUrls, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to list audits', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
