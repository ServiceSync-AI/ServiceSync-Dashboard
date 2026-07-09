/**
 * servicesync-weekly-report — Lambda function
 * ============================================
 * Runs every Sunday at 9 AM ET (via EventBridge) or on-demand via invoke.
 * 
 * 1. Aggregates last 7 days of pilot data (events from S3, assistant usage +
 *    recovery outreach from DynamoDB).
 * 2. Generates a clean HTML email with the weekly summary.
 * 3. Sends via SES to frazier@servicesync.io.
 *
 * Environment variables:
 *   EVENTS_BUCKET       — S3 bucket for browser events (servicesync-advisor-data)
 *   EVENTS_PREFIX       — key prefix for events (raw-events/chevyland_chevrolet/)
 *   TABLE_ASSISTANT_USAGE — DynamoDB usage table
 *   TABLE_OUTREACH      — DynamoDB recovery outreach table
 *   RECIPIENT_EMAIL     — email to send the report to
 *   SENDER_EMAIL        — verified SES sender
 */
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const {
  DynamoDBClient,
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  SESClient,
  SendEmailCommand,
} = require('@aws-sdk/client-ses');
const { gunzipSync } = require('node:zlib');

// ─── Config ─────────────────────────────────────────────────────────────────

const REGION = process.env.AWS_REGION || 'us-east-1';
const EVENTS_BUCKET = process.env.EVENTS_BUCKET || 'servicesync-advisor-data';
const EVENTS_PREFIX = process.env.EVENTS_PREFIX || 'raw-events/chevyland_chevrolet/';
const TABLE_USAGE = process.env.TABLE_ASSISTANT_USAGE || 'servicesync-assistant-usage';
const TABLE_OUTREACH = process.env.TABLE_OUTREACH || 'servicesync-recovery-outreach';
const RECIPIENT = process.env.RECIPIENT_EMAIL || 'frazier@servicesync.io';
const SENDER = process.env.SENDER_EMAIL || 'frazier@servicesync.io';

const s3 = new S3Client({ region: REGION });
const ddbBase = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbBase, {
  marshallOptions: { removeUndefinedValues: true },
});
const ses = new SESClient({ region: REGION });

// ─── Helpers ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function daysAgo(n, from = new Date()) {
  return new Date(from.getTime() - n * DAY_MS).toISOString().slice(0, 10);
}

/** List all S3 objects under a prefix (paginated). */
async function listAll(bucket, prefix) {
  const out = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    if (res.Contents) out.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Fetch + decompress a gzipped S3 object to text. */
async function getGzippedText(bucket, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await res.Body.transformToByteArray();
  const buf = Buffer.from(bytes);
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf).toString('utf-8');
  }
  return buf.toString('utf-8');
}

/** Parse gzipped JSONL into events. */
function parseJsonl(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.timestamp_utc) out.push(obj);
    } catch { /* skip */ }
  }
  return out;
}

/** Load events in a date range from S3. */
async function loadEvents(start, end) {
  const startMs = new Date(start + 'T00:00:00.000Z').getTime();
  const endMs = new Date(end + 'T23:59:59.999Z').getTime();

  const objs = await listAll(EVENTS_BUCKET, EVENTS_PREFIX);
  const candidates = objs.filter((o) => {
    const lm = (o.LastModified || new Date(0)).getTime();
    return lm >= startMs - DAY_MS && lm <= endMs + DAY_MS;
  });

  const events = [];
  // Process in batches of 8
  for (let i = 0; i < candidates.length; i += 8) {
    const batch = candidates.slice(i, i + 8);
    const results = await Promise.all(
      batch.map(async (o) => {
        try { return await getGzippedText(EVENTS_BUCKET, o.Key); }
        catch { return ''; }
      }),
    );
    for (const text of results) {
      for (const ev of parseJsonl(text)) {
        const t = new Date(ev.timestamp_utc).getTime();
        if (t >= startMs && t <= endMs) events.push(ev);
      }
    }
  }
  return events;
}

/** Count assistant queries from DynamoDB in date range. */
async function getAssistantQueries(start, end) {
  let total = 0;
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE_USAGE,
        FilterExpression: '#d >= :start AND #d <= :end',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':start': start, ':end': end },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items || []) {
      total += Number(it.msg_count) || 0;
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return total;
}

/** Sum declined $ from outreach table in date range. */
async function getDeclinedDollars(start, end) {
  let total = 0;
  let ExclusiveStartKey;
  const startISO = start + 'T00:00:00.000Z';
  const endISO = end + 'T23:59:59.999Z';
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE_OUTREACH,
        FilterExpression: 'ts >= :start AND ts <= :end',
        ExpressionAttributeValues: { ':start': startISO, ':end': endISO },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items || []) {
      total += Number(it.est_dollars) || 0;
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return total;
}

/** Distinct hours with events. */
function activeHours(events) {
  const hours = new Set();
  for (const e of events) {
    if (e.timestamp_utc) hours.add(e.timestamp_utc.slice(0, 13));
  }
  return hours.size;
}

/** Count system switches (simplified — uses url domain changes). */
function countSwitches(events) {
  if (events.length < 2) return 0;
  let switches = 0;
  let prevDomain = '';
  for (const e of events) {
    const domain = e.url ? new URL(e.url).hostname : e.window_title || '';
    if (domain && domain !== prevDomain) {
      switches++;
      prevDomain = domain;
    }
  }
  return Math.max(0, switches - 1);
}

// ─── HTML Email Template ────────────────────────────────────────────────────

function buildEmailHtml(report) {
  const { start, end, current, prior } = report;

  function trend(cur, prev) {
    if (prev === 0) return cur > 0 ? '<span style="color:#10b981">↑ new</span>' : '—';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return '<span style="color:#6b7280">→ flat</span>';
    return pct > 0
      ? `<span style="color:#10b981">↑ ${pct}%</span>`
      : `<span style="color:#ef4444">↓ ${Math.abs(pct)}%</span>`;
  }

  const highlightsHtml = report.highlights.length > 0
    ? report.highlights
        .map(
          (h) => `
      <div style="background:#f8fafc;border-left:3px solid #06b6d4;padding:12px 16px;margin-bottom:8px;border-radius:4px;">
        <strong style="color:#0f172a">${h.title}</strong>
        ${h.metric ? `<span style="float:right;font-size:12px;background:#ecfeff;color:#06b6d4;padding:2px 8px;border-radius:4px">${h.metric}</span>` : ''}
        <br><span style="color:#64748b;font-size:13px">${h.detail}</span>
      </div>`,
        )
        .join('')
    : '<p style="color:#94a3b8">No notable insights this week.</p>';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#ffffff;color:#1e293b">
  <div style="border-bottom:2px solid #06b6d4;padding-bottom:12px;margin-bottom:24px">
    <h1 style="font-size:20px;margin:0;color:#0f172a">⚡ ServiceSync Weekly Report</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#64748b">${start} → ${end} · Chevyland Chevrolet</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr style="background:#f1f5f9">
      <th style="text-align:left;padding:8px 12px;font-size:12px;color:#64748b;font-weight:500">Metric</th>
      <th style="text-align:right;padding:8px 12px;font-size:12px;color:#64748b;font-weight:500">This Week</th>
      <th style="text-align:right;padding:8px 12px;font-size:12px;color:#64748b;font-weight:500">Prior Week</th>
      <th style="text-align:right;padding:8px 12px;font-size:12px;color:#64748b;font-weight:500">Trend</th>
    </tr>
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">Total Events</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:600">${current.totalEvents.toLocaleString()}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#64748b">${prior.totalEvents.toLocaleString()}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9">${trend(current.totalEvents, prior.totalEvents)}</td>
    </tr>
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">Active Hours</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:600">${current.activeHours}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#64748b">${prior.activeHours}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9">${trend(current.activeHours, prior.activeHours)}</td>
    </tr>
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">Declined Work $</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:600">$${current.declinedDollars.toLocaleString()}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#64748b">$${prior.declinedDollars.toLocaleString()}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9">${trend(current.declinedDollars, prior.declinedDollars)}</td>
    </tr>
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">Assistant Queries</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:600">${current.assistantQueries.toLocaleString()}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#64748b">${prior.assistantQueries.toLocaleString()}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #f1f5f9">${trend(current.assistantQueries, prior.assistantQueries)}</td>
    </tr>
    <tr>
      <td style="padding:10px 12px">Avg Switches/hr</td>
      <td style="text-align:right;padding:10px 12px;font-weight:600">${current.avgSwitchesPerHour}</td>
      <td style="text-align:right;padding:10px 12px;color:#64748b">${prior.avgSwitchesPerHour}</td>
      <td style="text-align:right;padding:10px 12px">${trend(current.avgSwitchesPerHour, prior.avgSwitchesPerHour)}</td>
    </tr>
  </table>

  <h2 style="font-size:15px;color:#0f172a;margin:24px 0 12px">🔍 Top Insights</h2>
  ${highlightsHtml}

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
    ServiceSync Pilot Intelligence · Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
    <br>View full report: <a href="https://dashboard.servicesync.io/intel/report" style="color:#06b6d4">dashboard.servicesync.io/intel/report</a>
  </div>
</body>
</html>`;
}

// ─── Handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  console.log('Weekly report Lambda invoked', JSON.stringify(event));

  // Allow overriding date range from event payload
  const end = event?.end || daysAgo(1);
  const start = event?.start || daysAgo(7, new Date(end + 'T12:00:00Z'));

  // Prior week for comparison
  const daySpan = Math.round(
    (new Date(end + 'T23:59:59Z').getTime() - new Date(start + 'T00:00:00Z').getTime()) / DAY_MS,
  ) + 1;
  const priorEnd = daysAgo(1, new Date(start + 'T12:00:00Z'));
  const priorStart = daysAgo(daySpan, new Date(priorEnd + 'T12:00:00Z'));

  console.log(`Report period: ${start} → ${end}, prior: ${priorStart} → ${priorEnd}`);

  // Gather current + prior metrics in parallel
  const [curEvents, curQueries, curDollars, priorEvents, priorQueries, priorDollars] =
    await Promise.all([
      loadEvents(start, end),
      getAssistantQueries(start, end),
      getDeclinedDollars(start, end),
      loadEvents(priorStart, priorEnd),
      getAssistantQueries(priorStart, priorEnd),
      getDeclinedDollars(priorStart, priorEnd),
    ]);

  const curActiveHrs = activeHours(curEvents);
  const curSwitches = countSwitches(curEvents);
  const priorActiveHrs = activeHours(priorEvents);
  const priorSwitches = countSwitches(priorEvents);

  const current = {
    totalEvents: curEvents.length,
    activeHours: curActiveHrs,
    declinedDollars: Math.round(curDollars),
    assistantQueries: curQueries,
    avgSwitchesPerHour: curActiveHrs > 0 ? Math.round((curSwitches / curActiveHrs) * 10) / 10 : 0,
  };
  const prior = {
    totalEvents: priorEvents.length,
    activeHours: priorActiveHrs,
    declinedDollars: Math.round(priorDollars),
    assistantQueries: priorQueries,
    avgSwitchesPerHour: priorActiveHrs > 0 ? Math.round((priorSwitches / priorActiveHrs) * 10) / 10 : 0,
  };

  // Generate highlights
  const highlights = [];
  if (prior.totalEvents > 0) {
    const pct = Math.round(((current.totalEvents - prior.totalEvents) / prior.totalEvents) * 100);
    if (Math.abs(pct) >= 5) {
      highlights.push({
        title: pct > 0 ? 'Activity trending up' : 'Activity dipped',
        detail: `${Math.abs(pct)}% ${pct > 0 ? 'more' : 'fewer'} events vs prior week`,
        metric: `${current.totalEvents} vs ${prior.totalEvents}`,
      });
    }
  }
  if (current.declinedDollars > 0) {
    highlights.push({
      title: 'Declined work detected',
      detail: `$${current.declinedDollars.toLocaleString()} in declined/deferred work this week`,
      metric: `$${current.declinedDollars.toLocaleString()}`,
    });
  }
  if (current.assistantQueries > 0) {
    highlights.push({
      title: 'Assistant engaged',
      detail: `${current.assistantQueries} queries this week`,
      metric: `${current.assistantQueries} queries`,
    });
  }

  const report = { start, end, current, prior, highlights: highlights.slice(0, 3) };

  // Build HTML email
  const html = buildEmailHtml(report);

  // Send via SES
  try {
    await ses.send(
      new SendEmailCommand({
        Source: SENDER,
        Destination: { ToAddresses: [RECIPIENT] },
        Message: {
          Subject: { Data: `⚡ ServiceSync Weekly Report — ${start} → ${end}` },
          Body: {
            Html: { Data: html },
            Text: {
              Data: `ServiceSync Weekly Report (${start} → ${end})\n\nTotal Events: ${current.totalEvents} (${prior.totalEvents} prior)\nActive Hours: ${current.activeHours} (${prior.activeHours} prior)\nDeclined $: $${current.declinedDollars} ($${prior.declinedDollars} prior)\nAssistant Queries: ${current.assistantQueries} (${prior.assistantQueries} prior)\nAvg Switches/hr: ${current.avgSwitchesPerHour} (${prior.avgSwitchesPerHour} prior)\n\nView: https://dashboard.servicesync.io/intel/report`,
            },
          },
        },
      }),
    );
    console.log(`Email sent to ${RECIPIENT}`);
  } catch (err) {
    console.error('SES send failed:', err.message);
    // Don't throw — log the report data even if email fails
    console.log('Report data (email failed):', JSON.stringify(report, null, 2));
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, report }),
  };
};
