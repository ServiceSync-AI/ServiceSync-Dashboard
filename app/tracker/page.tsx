import TrackerClient from '@/components/TrackerClient';

export const dynamic = 'force-dynamic';

export default function TrackerPage() {
  // Default to the pilot test order — in production this would list all active or take a code param
  return <TrackerClient code="X9AY4K" />;
}
