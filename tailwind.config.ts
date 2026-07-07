/**
 * Tailwind Configuration — Pilot Intelligence Dashboard
 * =====================================================
 * Encodes ServiceSync branding tokens (dark mode, cyan/blue accents, Space
 * Grotesk / Inter type) plus a small set of semantic colors used to tag DMS
 * systems on the activity timeline. Centralizing these here keeps every chart
 * and badge visually consistent.
 */
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Core surfaces — Bloomberg-terminal dark.
        bg: '#0d1117',
        surface: '#161b22',
        'surface-2': '#1c2128',
        border: '#30363d',
        muted: '#8b949e',
        fg: '#e6edf3',
        // Brand accents.
        cyan: '#06B6D4',
        brand: '#0A7AFF',
        // Status semantics.
        ok: '#3fb950',
        warn: '#d29922',
        danger: '#f85149',
        // DMS system tags — one stable hue per system for the timeline.
        sys: {
          asrpro: '#06B6D4',
          globalconnect: '#0A7AFF',
          prodemand: '#a371f7',
          dms: '#3fb950',
          other: '#8b949e',
          distraction: '#f85149',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'var(--font-inter)', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};

export default config;
