import React, { useMemo, useRef, useState } from 'react';
import { formatNumber } from '../lib/analytics';
import type {
  CampaignComputed,
  DailyMetric,
  DashboardSummary,
  GrowthSettings,
} from '../types/growth';
import { formatShortDate, getDaysListUtc } from './uiHelpers';

interface RoadToFestivalChartProps {
  dailyMetrics: DailyMetric[];
  campaignRows: CampaignComputed[];
  summary: DashboardSummary;
  settings: GrowthSettings;
  selectedCampaignId: string | null;
  onSelectCampaign: (campaignId: string | null) => void;
}

interface ChartPoint {
  date: string;
  cumulative: number;
  daily: number;
  isProjected: boolean;
}

export const RoadToFestivalChart: React.FC<RoadToFestivalChartProps> = ({
  dailyMetrics,
  campaignRows,
  summary,
  settings,
  selectedCampaignId,
  onSelectCampaign,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const acquisitionRows = useMemo(
    () => campaignRows.filter((r) => !r.isEnabler),
    [campaignRows]
  );

  const selectedRow = useMemo(
    () =>
      selectedCampaignId
        ? acquisitionRows.find((r) => r.campaign.id === selectedCampaignId) ?? null
        : null,
    [acquisitionRows, selectedCampaignId]
  );

  const chartData = useMemo(() => {
    const asOfDate = settings.as_of_date.slice(0, 10) || '2026-03-21';
    const eventDate = settings.event_date.slice(0, 10) || '2026-04-11';
    const yearPrefix = asOfDate.slice(0, 4) || '2026';
    const defaultStart = `${yearPrefix}-01-15`;

    const acquisitionIds = new Set(acquisitionRows.map((r) => r.campaign.id));

    const regByDate = new Map<string, number>();
    let earliestDate = defaultStart;

    for (const m of dailyMetrics) {
      const d = String(m.metric_date ?? '').slice(0, 10);
      if (!d || d > asOfDate) continue;
      if (selectedCampaignId) {
        if (m.campaign_id !== selectedCampaignId) continue;
      } else {
        if (!acquisitionIds.has(m.campaign_id)) continue;
      }
      if (d < earliestDate) earliestDate = d;
      regByDate.set(d, (regByDate.get(d) ?? 0) + (Number(m.registrations) || 0));
    }

    const startDate = earliestDate < defaultStart ? earliestDate : defaultStart;
    const allDates = getDaysListUtc(startDate, eventDate);

    const dailyPace = selectedRow
      ? selectedRow.avgDailyRegLast7
      : acquisitionRows.reduce((s, r) => s + r.avgDailyRegLast7, 0);

    const points: ChartPoint[] = [];
    let running = 0;
    let asOfIndex = -1;

    for (let i = 0; i < allDates.length; i += 1) {
      const d = allDates[i];
      if (d <= asOfDate) {
        const dayVal = regByDate.get(d) ?? 0;
        running += dayVal;
        points.push({
          date: d,
          cumulative: running,
          daily: dayVal,
          isProjected: false,
        });
        asOfIndex = i;
      } else {
        const daysAfter = points.length - 1 - Math.max(0, asOfIndex);
        const projectedCum = running + dailyPace * (daysAfter + 1);
        points.push({
          date: d,
          cumulative: projectedCum,
          daily: dailyPace,
          isProjected: true,
        });
      }
    }

    if (asOfIndex === -1 && points.length > 0) {
      asOfIndex = points.length - 1;
    }

    const maxPointVal = points.reduce((m, p) => Math.max(m, p.cumulative), 0);
    // The curve plots registrations, so only registration targets belong on this axis
    const registrationTarget = selectedRow
      ? selectedRow.campaign.target_registrations || 0
      : acquisitionRows.reduce((s, r) => s + (r.campaign.target_registrations || 0), 0);

    const rawMaxY = Math.max(maxPointVal, registrationTarget, 50);
    const step = rawMaxY > 2000 ? 500 : rawMaxY > 600 ? 200 : 100;
    const maxY = Math.ceil((rawMaxY * 1.08) / step) * step;

    return {
      points,
      asOfIndex,
      startDate,
      asOfDate,
      eventDate,
      maxY,
      registrationTarget,
      dailyPace,
      actualAtAsOf: running,
      projectedEndReg: points.length > 0 ? points[points.length - 1].cumulative : running,
    };
  }, [dailyMetrics, acquisitionRows, selectedCampaignId, selectedRow, settings]);

  const W = 1080;
  const H = 420; // Taller chart for better readability
  const PAD = { top: 60, right: 40, bottom: 60, left: 80 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { points, asOfIndex, maxY } = chartData;
  const count = Math.max(1, points.length - 1);

  const xAt = (idx: number) => PAD.left + (idx / count) * plotW;
  const yAt = (val: number) => PAD.top + plotH - (val / Math.max(1, maxY)) * plotH;

  const actualPoints = points.slice(0, asOfIndex + 1);
  const projectedPoints = asOfIndex >= 0 ? points.slice(asOfIndex) : [];

  const actualPathD =
    actualPoints.length > 0
      ? actualPoints
          .map(
            (p, idx) =>
              `${idx === 0 ? 'M' : 'L'} ${xAt(idx).toFixed(1)} ${yAt(p.cumulative).toFixed(1)}`
          )
          .join(' ')
      : '';

  // Soft gradient area path under actual line
  const actualAreaPathD =
    actualPoints.length > 0
      ? `${actualPathD} L ${xAt(actualPoints.length - 1).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`
      : '';

  const projectedPathD =
    projectedPoints.length > 1
      ? projectedPoints
          .map(
            (p, idx) =>
              `${idx === 0 ? 'M' : 'L'} ${xAt(asOfIndex + idx).toFixed(1)} ${yAt(p.cumulative).toFixed(1)}`
          )
          .join(' ')
      : '';

  const approxActualLength = useMemo(() => {
    let len = 0;
    for (let i = 1; i < actualPoints.length; i += 1) {
      const dx = xAt(i) - xAt(i - 1);
      const dy = yAt(actualPoints[i].cumulative) - yAt(actualPoints[i - 1].cumulative);
      len += Math.hypot(dx, dy);
    }
    return Math.max(100, Math.ceil(len) + 40);
  }, [actualPoints, count, maxY]);

  const yTicks = useMemo(() => {
    const tickCount = 5;
    const ticks: number[] = [];
    for (let i = 0; i <= tickCount; i += 1) {
      ticks.push(Math.round((maxY / tickCount) * i));
    }
    return ticks;
  }, [maxY]);

  const xTickIndices = useMemo(() => {
    if (points.length === 0) return [];
    const seen = new Set<number>();
    const result: number[] = [];
    const pushIdx = (idx: number) => {
      if (idx >= 0 && idx < points.length && !seen.has(idx)) {
        seen.add(idx);
        result.push(idx);
      }
    };
    pushIdx(0);
    points.forEach((p, idx) => {
      if (p.date.endsWith('-02-01') || p.date.endsWith('-03-01') || p.date.endsWith('-04-01')) {
        if (Math.abs(idx - asOfIndex) > 5 && idx > 5 && idx < points.length - 5) {
          pushIdx(idx);
        }
      }
    });
    if (asOfIndex >= 0) pushIdx(asOfIndex);
    pushIdx(points.length - 1);
    return result.sort((a, b) => a - b);
  }, [points, asOfIndex]);

  const updateIndexFromClientX = (clientX: number) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = W / rect.width;
    const svgX = (clientX - rect.left) * scaleX;
    const ratio = (svgX - PAD.left) / plotW;
    const clamped = Math.max(0, Math.min(1, ratio));
    const idx = Math.round(clamped * (points.length - 1));
    setHoverIdx(idx);
  };

  const handleKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const current = hoverIdx ?? Math.max(0, asOfIndex);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHoverIdx(Math.min(points.length - 1, current + 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHoverIdx(Math.max(0, current - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHoverIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHoverIdx(points.length - 1);
    } else if (e.key === 'Escape') {
      setHoverIdx(null);
    }
  };

  const activePoint = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : null;
  const activeX = hoverIdx !== null ? xAt(hoverIdx) : null;
  const activeY = activePoint ? yAt(activePoint.cumulative) : null;

  const todayX = asOfIndex >= 0 ? xAt(asOfIndex) : PAD.left;
  const eventX = xAt(points.length - 1);

  return (
    <section
      aria-label="Road to the festival cumulative registrations chart"
      className="calm-card p-6 md:p-8 space-y-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-[#1F1B16]">
            Road to the festival
          </h2>
          <p className="mt-2 text-base text-[#4F4A3F] leading-relaxed">
            {selectedRow ? (
              <>
                <span className="font-semibold text-[#1F1B16]">{selectedRow.campaign.name}</span>
                {': '}
                <span className="tabular-nums font-semibold">
                  {formatNumber(chartData.actualAtAsOf)}
                </span>{' '}
                actual registrations so far, projected pace to{' '}
                <span className="tabular-nums font-semibold">
                  {formatNumber(Math.round(chartData.projectedEndReg))}
                </span>{' '}
                registrations ({formatNumber(Math.round(selectedRow.projectedAttendees))} projected attendees at{' '}
                {Math.round(selectedRow.campaign.assumed_showup * 100)}% show-up)
              </>
            ) : (
              <>
                Cumulative acquisition registrations from {formatShortDate(chartData.startDate, false)} to{' '}
                {formatShortDate(chartData.eventDate, false)}:{' '}
                <span className="tabular-nums font-semibold text-[#1F1B16]">
                  {formatNumber(chartData.actualAtAsOf)}
                </span>{' '}
                actual registrations (solid line), projected pace to{' '}
                <span className="tabular-nums font-semibold text-[#1F1B16]">
                  {formatNumber(Math.round(chartData.projectedEndReg))}
                </span>{' '}
                registrations (dashed line). Projected attendees, including walk-ins:{' '}
                <span className="tabular-nums font-semibold text-[#1F1B16]">
                  {formatNumber(Math.round(summary.totalProjectedAttendees))}
                </span>{' '}
                against a base target of {formatNumber(settings.total_target_base)} and a stretch target of{' '}
                {formatNumber(settings.total_target_stretch)}.
              </>
            )}
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-6 text-sm font-semibold text-[#4F4A3F]">
          <div className="flex items-center gap-2">
            <span className="w-4 h-1 bg-[#3B4A8C] rounded-full inline-block" />
            <span>Actual registrations</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-1 border-t-2 border-dashed border-[#3B4A8C] inline-block" />
            <span>Projected pace</span>
          </div>
          <div className="text-[13px] text-[#6C757D]">
            Hover or arrow keys to inspect
          </div>
        </div>
      </div>

      <div className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          tabIndex={0}
          role="img"
          aria-label={`Cumulative registrations chart from ${formatShortDate(chartData.startDate)} to ${formatShortDate(chartData.eventDate)}`}
          onPointerDown={(e) => {
            setIsDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
            updateIndexFromClientX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (isDragging || e.pointerType === 'mouse') {
              updateIndexFromClientX(e.clientX);
            }
          }}
          onPointerUp={(e) => {
            setIsDragging(false);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerLeave={() => {
            if (!isDragging) setHoverIdx(null);
          }}
          onKeyDown={handleKeyDown}
          className="w-full h-auto block select-none cursor-crosshair bg-white border border-[#DDD5C4] rounded-lg shadow-sm"
        >
          <defs>
            <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B4A8C" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#3B4A8C" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Y-axis gridlines & readable text (15px) */}
          {yTicks.map((tick) => {
            const y = yAt(tick);
            return (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  y1={y}
                  x2={W - PAD.right}
                  y2={y}
                  stroke="#ECE6D8"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 16}
                  y={y + 5}
                  textAnchor="end"
                  fill="#4F4A3F"
                  fontSize="15"
                  fontWeight="600"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatNumber(tick)}
                </text>
              </g>
            );
          })}

          {/* Reference line: registration target */}
          {chartData.registrationTarget > 0 && (
            <g>
              <line
                x1={PAD.left}
                y1={yAt(chartData.registrationTarget)}
                x2={W - PAD.right}
                y2={yAt(chartData.registrationTarget)}
                stroke="#6C757D"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
              <text
                x={W - PAD.right - 12}
                y={yAt(chartData.registrationTarget) - 8}
                textAnchor="end"
                fill="#4F4A3F"
                fontSize="14"
                fontWeight="600"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {selectedRow ? 'Campaign registration target' : 'Registration target (all campaigns)'}:{' '}
                {formatNumber(chartData.registrationTarget)}
              </text>
            </g>
          )}

          {/* Today marker */}
          {asOfIndex >= 0 && (
            <g>
              <line
                x1={todayX}
                y1={PAD.top - 15}
                x2={todayX}
                y2={PAD.top + plotH}
                stroke="#F4C430"
                strokeWidth={2.5}
              />
              <rect
                x={todayX - 30}
                y={PAD.top - 36}
                width="60"
                height="22"
                fill="#FEF9E7"
                stroke="#F4C430"
                strokeWidth="1.5"
                rx="4"
              />
              <text
                x={todayX}
                y={PAD.top - 21}
                textAnchor="middle"
                fill="#1F1B16"
                fontSize="13"
                fontWeight="700"
              >
                Today
              </text>
            </g>
          )}

          {/* Event day marker */}
          <g>
            <line
              x1={eventX}
              y1={PAD.top - 15}
              x2={eventX}
              y2={PAD.top + plotH}
              stroke="#3B4A8C"
              strokeWidth={2}
            />
            <text
              x={eventX}
              y={PAD.top - 21}
              textAnchor="middle"
              fill="#3B4A8C"
              fontSize="13"
              fontWeight="700"
            >
              Event Day
            </text>
          </g>

          {/* Soft Gradient Fill under actual curve */}
          {actualAreaPathD && (
            <path
              d={actualAreaPathD}
              fill="url(#actualGradient)"
            />
          )}

          {/* Actual line (solid indigo 3.5px) */}
          {actualPathD && (
            <path
              key={`actual-${selectedCampaignId ?? 'all'}`}
              d={actualPathD}
              fill="none"
              stroke="#3B4A8C"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-line-draw"
              style={{ '--line-length': approxActualLength } as React.CSSProperties}
            />
          )}

          {/* Projected pace (dashed indigo line) */}
          {projectedPathD && (
            <path
              d={projectedPathD}
              fill="none"
              stroke="#3B4A8C"
              strokeWidth={3}
              strokeDasharray="6 6"
              strokeLinecap="round"
              opacity={0.7}
            />
          )}

          {/* X axis labels (15px) */}
          <line
            x1={PAD.left}
            y1={PAD.top + plotH}
            x2={W - PAD.right}
            y2={PAD.top + plotH}
            stroke="#DDD5C4"
            strokeWidth={2}
          />
          {xTickIndices.map((idx) => {
            const p = points[idx];
            const anchor =
              idx === 0 ? 'start' : idx === points.length - 1 ? 'end' : 'middle';
            return (
              <text
                key={p.date}
                x={xAt(idx)}
                y={PAD.top + plotH + 28}
                textAnchor={anchor}
                fill="#4F4A3F"
                fontSize="15"
                fontWeight="600"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatShortDate(p.date, false)}
              </text>
            );
          })}

          {/* Scrub cursor */}
          {activePoint && activeX !== null && activeY !== null && (
            <g pointerEvents="none">
              <line
                x1={activeX}
                y1={PAD.top}
                x2={activeX}
                y2={PAD.top + plotH}
                stroke="#3B4A8C"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <circle
                cx={activeX}
                cy={activeY}
                r={6}
                fill="#3B4A8C"
                stroke="#FFFFFF"
                strokeWidth={2.5}
              />
            </g>
          )}
        </svg>

        {/* Tooltip Card */}
        {activePoint && hoverIdx !== null && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute top-12 z-10 bg-white border border-[#DDD5C4] shadow-lg rounded-lg px-4 py-3 text-sm min-w-[220px]"
            style={{
              left: `clamp(8px, calc(${((xAt(hoverIdx) / W) * 100).toFixed(2)}% - 110px), calc(100% - 240px))`,
            }}
          >
            <div className="font-semibold text-[#1F1B16] tabular-nums">
              {formatShortDate(activePoint.date, true)}
              {activePoint.isProjected ? ' (projected pace)' : ' (actual)'}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4 tabular-nums">
              <span className="text-[#4F4A3F]">Cumulative</span>
              <span className="font-display text-lg font-bold text-[#1F1B16]">
                {formatNumber(Math.round(activePoint.cumulative))}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 tabular-nums">
              <span className="text-[#4F4A3F]">
                {activePoint.isProjected ? 'Daily pace' : 'That day'}
              </span>
              <span className="font-semibold text-[#1F1B16]">
                {activePoint.isProjected
                  ? `+${activePoint.daily.toFixed(1)}/day`
                  : `+${formatNumber(activePoint.daily)}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Campaign Chips */}
      <div className="pt-4 border-t border-[#ECE6D8] flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onSelectCampaign(null)}
          className={`px-3.5 py-2 text-sm font-semibold rounded-lg border transition-colors ${
            selectedCampaignId === null
              ? 'bg-[#FEF9E7] text-[#1F1B16] border-[#F4C430]'
              : 'bg-white text-[#4F4A3F] border-[#DDD5C4] hover:border-[#3B4A8C]'
          }`}
        >
          All acquisition campaigns
        </button>

        {acquisitionRows.map((row) => {
          const isActive = selectedCampaignId === row.campaign.id;
          return (
            <button
              key={row.campaign.id}
              type="button"
              aria-pressed={isActive}
              onClick={() =>
                onSelectCampaign(isActive ? null : row.campaign.id)
              }
              className={`px-3.5 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                isActive
                  ? 'bg-[#FEF9E7] text-[#1F1B16] border-[#F4C430]'
                  : 'bg-white text-[#4F4A3F] border-[#DDD5C4] hover:border-[#3B4A8C]'
              }`}
            >
              {row.campaign.name}
            </button>
          );
        })}
      </div>
    </section>
  );
};
