/**
 * Shared Types
 * ====================================
 * Item shapes mirroring the DynamoDB tables (see lib/dynamo.ts) plus the
 * trimmed, PII-free payload the tracker page consumes. Keeping the public
 * payload separate from the stored item is deliberate: customer_phone never
 * reaches the browser.
 */
import type { RepairStatus } from './statuses';

// Dealerships table — PK dealership_id, GSI by_slug.
export interface Dealership {
  dealership_id: string;
  slug: string;
  name: string;
  phone: string | null;
  logo_url: string | null;
  google_review_url: string | null;
  reward_name: string;
  reward_threshold: number;
  points_per_visit: number;
}

// RepairOrders table — PK tracking_code, GSI by_dealership (dealership_id, created_at).
export interface RepairOrder {
  tracking_code: string;
  dealership_id: string;
  ro_number: string | null;
  customer_name: string | null;
  customer_phone: string;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  advisor_name: string | null;
  status: RepairStatus;
  created_at: string;
  updated_at: string;
}

// Rewards table — PK dealership_id, SK phone. Loyalty is scoped per dealership.
export interface Reward {
  dealership_id: string;
  phone: string;
  name: string | null;
  points: number;
  visit_count: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Public status payload returned by GET /api/status and rendered by the tracker.
 * Intentionally omits customer_phone and internal ids.
 */
export interface TrackerView {
  tracking_code: string;
  ro_number: string | null;
  status: RepairStatus;
  updated_at: string;
  vehicle: {
    year: string | null;
    make: string | null;
    model: string | null;
  };
  advisor_name: string | null;
  dealership: {
    name: string;
    phone: string | null;
    logo_url: string | null;
    google_review_url: string | null;
  };
  rewards: {
    points: number;
    threshold: number;
    reward_name: string;
  };
}
