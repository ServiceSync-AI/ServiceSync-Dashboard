/**
 * AppUsageChart — time-per-system breakdown
 * =========================================
 * Horizontal bar chart (recharts) of minutes spent per DMS tool / category,
 * colored with the shared system palette. Sorted most-used first. Falls back to
 * a friendly empty state when there's no data for the window.
 */
'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { colorForLabel } from '@/lib/colors';
import { formatMinutes } from '@/lib/format';

interface Props {
  breakdown: Record<string, number>; // label -> minutes
}

export default function AppUsageChart({ breakdown }: Props) {
  const data = Object.entries(breakdown)
    .map(([label, minutes]) => ({ label, minutes: Math.round(minutes) }))
    .filter((d) => d.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted">
        No activity recorded in this window.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 38)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={110}
          tick={{ fill: '#8b949e', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: '#ffffff08' }}
          contentStyle={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: '#e6edf3' }}
          formatter={(value: number) => [formatMinutes(value), 'time']}
        />
        <Bar dataKey="minutes" radius={[0, 4, 4, 0]} barSize={20}>
          {data.map((d) => (
            <Cell key={d.label} fill={colorForLabel(d.label)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
