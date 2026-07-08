/**
 * EC2 Instance Info (server-only)
 * ===============================
 * Fetches all non-terminated EC2 instances in the account and returns metadata
 * + estimated monthly cost. Used by both the usage page (server component) and
 * the /api/intel/instances route (API).
 *
 * Gracefully returns null on failure so the page can render a fallback card
 * instead of crashing. Common failure: AccessDenied (role lacks
 * ec2:DescribeInstances).
 */
import {
  EC2Client,
  DescribeInstancesCommand,
  type Instance,
} from '@aws-sdk/client-ec2';

// On-Demand monthly estimates (us-east-1, Linux) — hourly rate × 730 hrs/mo
const MONTHLY_COST: Record<string, number> = {
  't3.nano': 3.80,
  't3.micro': 7.59,
  't3.small': 15.18,
  't3.medium': 30.37,
  't3.large': 60.74,
  't3.xlarge': 121.47,
  't3.2xlarge': 242.94,
  't2.nano': 4.18,
  't2.micro': 8.47,
  't2.small': 16.79,
  't2.medium': 33.41,
  't2.large': 66.82,
  'm5.large': 70.08,
  'm5.xlarge': 140.16,
  'm6i.large': 70.08,
  'm6i.xlarge': 140.16,
  'c5.large': 62.05,
  'c5.xlarge': 124.10,
  'r5.large': 91.98,
  'r5.xlarge': 183.96,
};

export interface InstanceInfo {
  instanceId: string;
  instanceType: string;
  state: string;
  launchTime: string | null;
  name: string | null;
  estimatedMonthlyCost: number | null;
  /** If running, hours since launch. */
  uptimeHours: number | null;
}

export interface InstancesResponse {
  instances: InstanceInfo[];
  totalEstimatedMonthlyCost: number;
  generatedAt: string;
  region: string;
}

let ec2Client: EC2Client | null = null;

function ec2(): EC2Client {
  if (!ec2Client) {
    ec2Client = new EC2Client({ region: 'us-east-1' });
  }
  return ec2Client;
}

function getNameTag(instance: Instance): string | null {
  return instance.Tags?.find((t) => t.Key === 'Name')?.Value ?? null;
}

function estimateMonthlyCost(instanceType: string, state: string): number | null {
  if (state !== 'running') return 0;
  return MONTHLY_COST[instanceType] ?? null;
}

function uptimeHours(launchTime: Date | undefined, state: string): number | null {
  if (state !== 'running' || !launchTime) return null;
  return Math.round((Date.now() - launchTime.getTime()) / (1000 * 60 * 60));
}

/**
 * Fetch all non-terminated EC2 instances. Returns null on any failure.
 */
export async function getInstancesInfo(): Promise<InstancesResponse | null> {
  try {
    const result = await ec2().send(new DescribeInstancesCommand({}));

    const instances: InstanceInfo[] = [];

    for (const reservation of result.Reservations ?? []) {
      for (const inst of reservation.Instances ?? []) {
        const state = inst.State?.Name ?? 'unknown';
        if (state === 'terminated') continue;

        const instanceType = inst.InstanceType ?? 'unknown';
        const cost = estimateMonthlyCost(instanceType, state);

        instances.push({
          instanceId: inst.InstanceId ?? 'unknown',
          instanceType,
          state,
          launchTime: inst.LaunchTime?.toISOString() ?? null,
          name: getNameTag(inst),
          estimatedMonthlyCost: cost,
          uptimeHours: uptimeHours(inst.LaunchTime, state),
        });
      }
    }

    // Sort: running first, then by name
    instances.sort((a, b) => {
      if (a.state === 'running' && b.state !== 'running') return -1;
      if (a.state !== 'running' && b.state === 'running') return 1;
      return (a.name ?? a.instanceId).localeCompare(b.name ?? b.instanceId);
    });

    const totalEstimatedMonthlyCost = instances.reduce(
      (sum, i) => sum + (i.estimatedMonthlyCost ?? 0),
      0,
    );

    return {
      instances,
      totalEstimatedMonthlyCost,
      generatedAt: new Date().toISOString(),
      region: 'us-east-1',
    };
  } catch {
    return null;
  }
}
