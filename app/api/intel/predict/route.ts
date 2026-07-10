/**
 * GET /api/intel/predict — Predictive Scheduling
 * ===============================================
 * Loads the last 21 days of browser events, aggregates activity by day-of-week
 * and hour-of-day, and returns a heatmap with peak/quiet analysis plus a
 * tomorrow forecast.
 *
 * Returns: { heatmap, busiestDay, busiestHours, quietestDay, quietestHours,
 *            prediction: { tomorrow: { peakHours, expectedLoad } }, weeklyPattern }
 */
import { NextResponse } from 'next/server';
import { loadEventsInRange } from '@/lib/events';

export const runtime = 'nodejs';
export const revalidate = 300; // cache 5 minutes

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function GET() {
  try {
    // Load last 21 days of events
    const now = new Date();
    const endISO = now.toISOString();
    const start = new Date(now.getTime() - 21 * 86_400_000);
    const startISO = start.toISOString();

    const events = await loadEventsInRange(startISO, endISO);

    // Aggregate: day-of-week (0=Sun..6=Sat) x hour-of-day (0-23)
    // Track total events and total days seen per weekday for averaging.
    const grid: Record<string, Record<string, number>> = {};
    const dayCounts: Record<string, Set<string>> = {}; // day-of-week -> set of dates

    for (const dayName of DAY_NAMES) {
      grid[dayName] = {};
      dayCounts[dayName] = new Set();
      for (let h = 0; h < 24; h++) {
        grid[dayName][h.toString()] = 0;
      }
    }

    for (const event of events) {
      const d = new Date(event.timestamp_utc);
      const dayOfWeek = d.getUTCDay(); // 0=Sun
      const hour = d.getUTCHours();
      const dateStr = d.toISOString().slice(0, 10);
      const dayName = DAY_NAMES[dayOfWeek];

      grid[dayName][hour.toString()] += 1;
      dayCounts[dayName].add(dateStr);
    }

    // Convert raw counts to averages (events per slot per occurrence of that weekday)
    const heatmap: Record<string, Record<string, number>> = {};
    for (const dayName of DAY_NAMES) {
      heatmap[dayName] = {};
      const numOccurrences = Math.max(1, dayCounts[dayName].size);
      for (let h = 0; h < 24; h++) {
        heatmap[dayName][h.toString()] = Math.round(
          grid[dayName][h.toString()] / numOccurrences
        );
      }
    }

    // Compute per-day totals for weekly pattern
    const weeklyPattern: Record<string, number> = {};
    for (const dayName of DAY_NAMES) {
      weeklyPattern[dayName] = Object.values(heatmap[dayName]).reduce(
        (sum, v) => sum + v,
        0
      );
    }

    // Busiest / quietest day
    const sortedDays = Object.entries(weeklyPattern).sort(([, a], [, b]) => b - a);
    const busiestDay = sortedDays[0][0];
    const quietestDay = sortedDays[sortedDays.length - 1][0];

    // Busiest / quietest hours (across all days, averaged)
    const hourTotals: Record<number, number> = {};
    for (let h = 0; h < 24; h++) {
      hourTotals[h] = 0;
      for (const dayName of DAY_NAMES) {
        hourTotals[h] += heatmap[dayName][h.toString()];
      }
    }

    const sortedHours = Object.entries(hourTotals)
      .map(([h, v]) => ({ hour: parseInt(h), total: v }))
      .sort((a, b) => b.total - a.total);

    const busiestHours = sortedHours.slice(0, 3).map((h) => h.hour);
    const quietestHours = sortedHours
      .filter((h) => h.hour >= 7 && h.hour <= 18) // business hours only
      .slice(-3)
      .map((h) => h.hour);

    // Tomorrow prediction
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const tomorrowDayName = DAY_NAMES[tomorrow.getUTCDay()];
    const tomorrowSlots = heatmap[tomorrowDayName];
    const tomorrowTotal = Object.values(tomorrowSlots).reduce((s, v) => s + v, 0);
    const tomorrowPeakHours = Object.entries(tomorrowSlots)
      .map(([h, v]) => ({ hour: parseInt(h), intensity: v }))
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 3)
      .map((h) => h.hour);

    return NextResponse.json(
      {
        heatmap,
        busiestDay,
        busiestHours,
        quietestDay,
        quietestHours,
        prediction: {
          tomorrow: {
            day: tomorrowDayName,
            peakHours: tomorrowPeakHours,
            expectedLoad: tomorrowTotal,
          },
        },
        weeklyPattern,
      },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to generate prediction', detail: String((err as Error).message) },
      { status: 500 }
    );
  }
}
