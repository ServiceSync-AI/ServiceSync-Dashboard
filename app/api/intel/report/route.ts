/**
 * GET /api/intel/report — Weekly Pilot Report
 * ============================================
 * Aggregates events (S3), assistant usage (DynamoDB), and recovery outreach
 * (DynamoDB) into a structured weekly summary.
 *
 * Query params:
 *   start (YYYY-MM-DD) — first day of the report window (default: 7 days ago)
 *   end   (YYYY-MM-DD) — last day of the report window (default: yesterday)
 *
 * POST /api/intel/report — Email the report
 * ==========================================
 * Triggers the weekly report Lambda to send an email for the given date range.
 * (Stub — invokes Lambda asynchronously if deployed; otherwise returns 501.)
 */
import { NextResponse } from 'next/server';
import { generateWeeklyReport } from '@/lib/weekly-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start') ?? undefined;
  const end = url.searchParams.get('end') ?? undefined;

  // Validate date format if provided
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (start && !datePattern.test(start)) {
    return NextResponse.json(
      { error: 'start must be YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (end && !datePattern.test(end)) {
    return NextResponse.json(
      { error: 'end must be YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (start && end && start > end) {
    return NextResponse.json(
      { error: 'start must be <= end' },
      { status: 400 },
    );
  }

  try {
    const report = await generateWeeklyReport(start, end);
    return NextResponse.json(report, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'weekly report generation failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  // Parse optional date range from request body
  let start: string | undefined;
  let end: string | undefined;
  try {
    const body = await request.json();
    start = body.start;
    end = body.end;
  } catch {
    // No body is fine — use defaults
  }

  // Try to invoke the Lambda
  try {
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    await lambda.send(
      new InvokeCommand({
        FunctionName: 'servicesync-weekly-report',
        InvocationType: 'Event', // async — don't wait
        Payload: Buffer.from(JSON.stringify({ start, end })),
      }),
    );
    return NextResponse.json({ success: true, message: 'Report email queued' });
  } catch (err) {
    const msg = String((err as Error).message);
    // If Lambda doesn't exist yet, return a helpful message
    if (msg.includes('ResourceNotFound') || msg.includes('Function not found')) {
      return NextResponse.json(
        {
          error: 'Lambda not deployed',
          detail: 'The servicesync-weekly-report Lambda has not been deployed yet. Deploy it to enable email reports.',
        },
        { status: 501 },
      );
    }
    return NextResponse.json(
      { error: 'failed to invoke report Lambda', detail: msg },
      { status: 500 },
    );
  }
}
