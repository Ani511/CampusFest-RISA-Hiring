import React, { useEffect, useRef, useState } from 'react';
import { addDaysUtc, parseUtcDateMs } from '../lib/analytics';
import type { DiagnosisStatus } from '../types/growth';

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatShortDate(dateStr: string | null | undefined, includeYear = true): string {
  if (!dateStr) return '—';
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return clean;
  const [year, month, day] = parts;
  const mon = MONTHS_SHORT[month - 1] ?? '';
  return includeYear ? `${day} ${mon} ${year}` : `${day} ${mon}`;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface AnimatedNumberProps {
  value: number;
  formatter: (n: number) => string;
  durationMs?: number;
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  formatter,
  durationMs = 400,
}) => {
  const hasAnimatedRef = useRef(false);
  const [displayValue, setDisplayValue] = useState<number>(() =>
    prefersReducedMotion() ? value : 0
  );

  useEffect(() => {
    if (prefersReducedMotion() || hasAnimatedRef.current) {
      setDisplayValue(value);
      return;
    }

    hasAnimatedRef.current = true;
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayValue(value * eased);
      if (t < 1) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        setDisplayValue(value);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [value, durationMs]);

  return <span className="tabular-nums">{formatter(displayValue)}</span>;
};

export function getStatusVisual(status: DiagnosisStatus | 'Enabler'): {
  badgeClass: string;
  rowBorderColor: string;
  textColor: string;
} {
  switch (status) {
    case 'On track':
      return {
        badgeClass: 'badge-ontrack',
        rowBorderColor: '#4ECDC4',
        textColor: '#111111',
      };
    case 'At risk':
      return {
        badgeClass: 'badge-atrisk',
        rowBorderColor: '#FFCE5C',
        textColor: '#111111',
      };
    case 'Underperforming':
      return {
        badgeClass: 'badge-underperforming',
        rowBorderColor: '#FF6B6B',
        textColor: '#111111',
      };
    case 'Planned':
    case 'Enabler':
    default:
      return {
        badgeClass: 'badge-planned',
        rowBorderColor: '#6A7BB4',
        textColor: '#111111',
      };
  }
}

export function getCampaignRowStatus(
  isEnabler: boolean,
  isPlanned: boolean,
  projectedPctOfTarget: number | null
): DiagnosisStatus | 'Enabler' {
  if (isEnabler) return 'Enabler';
  if (isPlanned) return 'Planned';
  const pct = projectedPctOfTarget ?? 0;
  if (pct >= 90) return 'On track';
  if (pct >= 60) return 'At risk';
  return 'Underperforming';
}

export function getDaysListUtc(startDate: string, endDate: string): string[] {
  const startMs = parseUtcDateMs(startDate);
  const endMs = parseUtcDateMs(endDate);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return [];
  }
  const totalDays = Math.round((endMs - startMs) / 86_400_000);
  const days: string[] = [];
  for (let i = 0; i <= totalDays; i += 1) {
    days.push(addDaysUtc(startDate, i));
  }
  return days;
}

/* SVG Confetti Burst for task confirmation */
export const ConfettiBurst: React.FC<{ active: boolean; onComplete?: () => void }> = ({
  active,
  onComplete,
}) => {
  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => {
      onComplete?.();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [active, onComplete]);

  if (!active || prefersReducedMotion()) return null;

  const pieces = [
    { type: 'circle', color: '#FF71CE', x: 50, y: 50, dx: -45, dy: -60 },
    { type: 'rect', color: '#FFCE5C', x: 50, y: 50, dx: 55, dy: -50 },
    { type: 'triangle', color: '#4ECDC4', x: 50, y: 50, dx: -65, dy: 30 },
    { type: 'circle', color: '#FF6B6B', x: 50, y: 50, dx: 70, dy: 40 },
    { type: 'rect', color: '#6A7BB4', x: 50, y: 50, dx: -20, dy: -75 },
    { type: 'triangle', color: '#86CCCA', x: 50, y: 50, dx: 35, dy: 65 },
  ];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-50 flex items-center justify-center">
      <svg className="w-48 h-48" viewBox="0 0 100 100">
        {pieces.map((p, i) => (
          <g key={i}>
            {p.type === 'circle' && (
              <circle
                cx={p.x}
                cy={p.y}
                r="4"
                fill={p.color}
                stroke="#111"
                strokeWidth="1"
              >
                <animate
                  attributeName="transform"
                  type="translate"
                  to={`${p.dx},${p.dy}`}
                  dur="0.8s"
                  fill="freeze"
                />
                <animate
                  attributeName="opacity"
                  values="1;1;0"
                  dur="0.8s"
                  fill="freeze"
                />
              </circle>
            )}
            {p.type === 'rect' && (
              <rect
                x={p.x - 3}
                y={p.y - 3}
                width="7"
                height="7"
                fill={p.color}
                stroke="#111"
                strokeWidth="1"
              >
                <animate
                  attributeName="transform"
                  type="translate"
                  to={`${p.dx},${p.dy}`}
                  dur="0.8s"
                  fill="freeze"
                />
                <animate
                  attributeName="opacity"
                  values="1;1;0"
                  dur="0.8s"
                  fill="freeze"
                />
              </rect>
            )}
            {p.type === 'triangle' && (
              <polygon
                points={`${p.x},${p.y - 4} ${p.x - 4},${p.y + 3} ${p.x + 4},${p.y + 3}`}
                fill={p.color}
                stroke="#111"
                strokeWidth="1"
              >
                <animate
                  attributeName="transform"
                  type="translate"
                  to={`${p.dx},${p.dy}`}
                  dur="0.8s"
                  fill="freeze"
                />
                <animate
                  attributeName="opacity"
                  values="1;1;0"
                  dur="0.8s"
                  fill="freeze"
                />
              </polygon>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
};
