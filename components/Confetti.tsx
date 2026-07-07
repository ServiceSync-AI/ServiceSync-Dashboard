'use client';

/**
 * Confetti — one-shot celebration when the vehicle is ready
 * ====================================
 * Fires a burst of cyan/magenta/violet confetti once per mount. Respects the
 * user's reduced-motion preference (no burst if they've opted out).
 */
import { useEffect } from 'react';
import confetti from 'canvas-confetti';

export default function Confetti() {
  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    // Two angled bursts from the bottom corners for a fuller spread on mobile.
    const colors = ['#06B6D4', '#D946EF', '#8B5CF6'];
    confetti({ particleCount: 80, spread: 70, origin: { x: 0.2, y: 1 }, angle: 60, colors });
    confetti({ particleCount: 80, spread: 70, origin: { x: 0.8, y: 1 }, angle: 120, colors });
  }, []);

  return null;
}
