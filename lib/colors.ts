/**
 * System color map — shared between Tailwind classes and chart hex values
 * =======================================================================
 * Recharts and inline SVG need raw hex, not Tailwind class names, so the same
 * palette defined in tailwind.config (`sys.*`) is mirrored here for JS use.
 * Keep the two in sync.
 */
import type { SystemKey } from './analyze';

export const SYSTEM_COLORS: Record<SystemKey, string> = {
  asrpro: '#06B6D4',
  globalconnect: '#0A7AFF',
  prodemand: '#a371f7',
  dms: '#3fb950',
  other: '#8b949e',
  distraction: '#f85149',
};

/** Resolve a hex color for a system *label* by re-deriving its key. */
export function colorForLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('asr')) return SYSTEM_COLORS.asrpro;
  if (l.includes('global')) return SYSTEM_COLORS.globalconnect;
  if (l.includes('prodemand')) return SYSTEM_COLORS.prodemand;
  if (l.includes('dms') || l.includes('cdk') || l.includes('tekion'))
    return SYSTEM_COLORS.dms;
  if (l.includes('distraction')) return SYSTEM_COLORS.distraction;
  return SYSTEM_COLORS.other;
}
