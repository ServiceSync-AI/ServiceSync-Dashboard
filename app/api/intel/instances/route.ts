/**
 * GET /api/intel/instances — live EC2 infrastructure view
 * =======================================================
 * Calls ec2:DescribeInstances to list all running/stopped instances in the
 * account, returning instance metadata + estimated monthly cost based on
 * instance type.
 *
 * Returns: InstancesResponse (from lib/ec2)
 */
import { NextResponse } from 'next/server';
import { getInstancesInfo } from '@/lib/ec2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getInstancesInfo();

  if (!data) {
    return NextResponse.json(
      { error: 'EC2 describe failed', detail: 'ec2:DescribeInstances permission may be missing' },
      { status: 500 },
    );
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
  });
}
