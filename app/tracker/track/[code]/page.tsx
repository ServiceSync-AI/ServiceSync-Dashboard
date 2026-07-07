/**
 * Tracker Page — /track/[code]
 * ====================================
 * Server component shell. The actual live view (fetch + 30s polling) lives in
 * the TrackerClient client component; this just hands it the code from the URL.
 */
import TrackerClient from '@/components/TrackerClient';
import { normalizeTrackingCode } from '@/lib/tracker/codes';

export const dynamic = 'force-dynamic';

export default function TrackPage({ params }: { params: { code: string } }) {
  const code = normalizeTrackingCode(params.code);
  return <TrackerClient code={code} />;
}
