/**
 * Advisor Directory (server-only)
 * ===============================
 * Multi-advisor foundation for the dashboard. The pilot began single-advisor
 * (hardcoded `siltaylor`), but the extension now self-registers each advisor in
 * the `servicesync-advisors` DynamoDB table. This module reads that table so the
 * UI can offer an advisor selector while everything stays additive and
 * non-breaking: if the table is empty/unavailable we fall back to the single
 * `config.advisorId` so the existing pilot keeps working unchanged.
 *
 * Table: servicesync-advisors
 *   PK advisor_id (S) · attrs advisor_name, dealership, station, created_at
 */
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDoc } from './tracker/dynamo';
import { config } from './config';

// Table name comes from env so the deploy can inject the real name; default
// matches the extension's self-registration target.
const TABLE_ADVISORS = process.env.TABLE_ADVISORS ?? 'servicesync-advisors';

export interface Advisor {
  advisorId: string;
  advisorName: string;
  dealership: string;
}

/** The single-advisor fallback derived from config — the original pilot. */
function fallbackAdvisor(): Advisor {
  return {
    advisorId: config.advisorId,
    advisorName: config.advisorId,
    dealership: 'Chevyland Chevrolet',
  };
}

/**
 * List every registered advisor from the `servicesync-advisors` table.
 *
 * A Scan is fine here: the table holds one row per advisor (tens of rows at
 * pilot scale, not a hot path). On empty/error we degrade gracefully to the
 * single configured advisor so the dashboard never renders an empty selector.
 */
export async function listAdvisors(): Promise<Advisor[]> {
  try {
    const { Items } = await getDoc().send(
      new ScanCommand({ TableName: TABLE_ADVISORS }),
    );
    const advisors = (Items ?? [])
      .filter((it) => typeof it.advisor_id === 'string' && it.advisor_id)
      .map<Advisor>((it) => ({
        advisorId: it.advisor_id as string,
        advisorName:
          typeof it.advisor_name === 'string' && it.advisor_name
            ? it.advisor_name
            : (it.advisor_id as string),
        dealership: typeof it.dealership === 'string' ? it.dealership : '',
      }))
      .sort((a, b) => a.advisorName.localeCompare(b.advisorName));

    return advisors.length > 0 ? advisors : [fallbackAdvisor()];
  } catch {
    // Table missing, no IAM, or offline — keep the pilot working single-advisor.
    return [fallbackAdvisor()];
  }
}

/**
 * Resolve a selected advisor id to a valid one.
 *
 * Returns `explicit` when it's a non-empty string (best-effort: we trust the
 * cookie/query since the source of truth is DynamoDB and callers scope reads by
 * this id), otherwise the configured default (`siltaylor`).
 */
export function resolveAdvisorId(explicit?: string): string {
  const trimmed = explicit?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : config.advisorId;
}
