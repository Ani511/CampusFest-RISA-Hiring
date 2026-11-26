import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  formatInr,
  formatNumber,
  formatPct,
  normalizeShowupRate,
} from '../lib/analytics';
import type {
  CampaignComputed,
  DashboardSummary,
  DiagnosisItem,
  GrowthSettings,
} from '../types/growth';
import { formatShortDate, getStatusVisual } from './uiHelpers';

interface DiagnosisTabProps {
  diagnosis: DiagnosisItem[];
  campaignRows: CampaignComputed[];
  summary: DashboardSummary;
  settings: GrowthSettings;
  onAskAnalyst: (prefillQuestion: string) => void;
}

type StatusFilter = 'all' | 'Underperforming' | 'At risk' | 'On track';

function buildPlainEnglishVerdict(item: DiagnosisItem): string {
  const c = item.computed;
  const camp = c.campaign;
  const pctStr = formatPct(c.projectedPctOfTarget, 0);
  const showupPct = Math.round(normalizeShowupRate(camp.assumed_showup) * 100);

  if (item.status === 'On track') {
    if (c.identifiedToRegisteredPct !== null && c.identifiedToRegisteredPct >= 75) {
      return `${camp.name}: ${pctStr} of target, pacing ahead with ${formatPct(c.identifiedToRegisteredPct)} sign-up conversion`;
    }
    return `${camp.name}: ${pctStr} of target, pacing ${formatNumber(Math.round(c.projectedAttendees))} against ${formatNumber(camp.target_attendees)} attendees`;
  }

  if (showupPct > 0 && showupPct <= 55) {
    return `${camp.name}: ${pctStr} of target, mostly because only ${showupPct}% of registrants usually show up`;
  }
  if (item.hasRegistrationsFallingBottleneck && item.regDeltaPct !== null) {
    return `${camp.name}: ${pctStr} of target, slowed by a ${Math.abs(item.regDeltaPct).toFixed(0)}% drop in registrations over the last 7 days`;
  }
  if (item.hasFunnelBottleneck && c.identifiedToRegisteredPct !== null) {
    return `${camp.name}: ${pctStr} of target, held back by a ${formatPct(c.identifiedToRegisteredPct)} sign-up rate`;
  }
  if (item.hasCancelSpikeBottleneck || item.hasCancelAvgBottleneck) {
    return `${camp.name}: ${pctStr} of target, dragged down by a ${formatPct(c.last7CancelRatePct)} recent cancel rate`;
  }
  if (showupPct > 0 && showupPct < 70) {
    return `${camp.name}: ${pctStr} of target, limited by a ${showupPct}% historical show-up rate`;
  }
  return `${camp.name}: ${pctStr} of target, currently ${formatNumber(Math.max(0, camp.target_attendees - Math.round(c.projectedAttendees)))} attendees short of goal`;
}

function buildBottleneckSentences(
  item: DiagnosisItem,
  summary: DashboardSummary
): string[] {
  const c = item.computed;
  const sentences: string[] = [];

  if (item.hasFunnelBottleneck) {
    sentences.push(
      `Sign-up conversion is ${formatPct(c.identifiedToRegisteredPct)}, more than 25% below the ${formatPct(summary.avgIdToRegPct)} campaign average.`
    );
  }
  if (item.hasCancelAvgBottleneck) {
    sentences.push(
      `Last 7-day cancel rate is ${formatPct(c.last7CancelRatePct)}, more than 25% worse than the ${formatPct(summary.avgLast7CancelRatePct)} average.`
    );
  }
  if (item.hasCancelSpikeBottleneck) {
    sentences.push(
      `Last 7-day cancel rate (${formatPct(c.last7CancelRatePct)}) is more than double earlier weeks (${formatPct(c.earlierCancelRatePct)}).`
    );
  }
  if (item.hasRegistrationsFallingBottleneck && item.regDeltaPct !== null) {
    sentences.push(
      `Registrations dropped ${Math.abs(item.regDeltaPct).toFixed(1)}% in the last 7 days (${formatNumber(c.last7Registrations)} vs ${formatNumber(c.prev7Registrations)} in the previous 7 days).`
    );
  }

  return sentences;
}

export const DiagnosisTab: React.FC<DiagnosisTabProps> = ({
  diagnosis,
  campaignRows,
  summary,
  settings,
  onAskAnalyst,
}) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const scoredItems = useMemo(
    () => diagnosis.filter((d) => d.status !== 'Planned'),
    [diagnosis]
  );

  const plannedItems = useMemo(
    () => diagnosis.filter((d) => d.status === 'Planned'),
    [diagnosis]
  );

  const enablerCampaigns = useMemo(
    () => campaignRows.filter((r) => r.isEnabler),
    [campaignRows]
  );

  const counts = useMemo(() => {
    const map: Record<'Underperforming' | 'At risk' | 'On track', number> = {
      Underperforming: 0,
      'At risk': 0,
      'On track': 0,
    };
    for (const item of scoredItems) {
      if (item.status !== 'Planned') {
        map[item.status] += 1;
      }
    }
    return map;
  }, [scoredItems]);

  const filteredScored = useMemo(() => {
    if (statusFilter === 'all') return scoredItems;
    return scoredItems.filter((d) => d.status === statusFilter);
  }, [scoredItems, statusFilter]);

  return (
    <div className="space-y-8">
      {/* Benchmark Strip */}
      <section aria-label="Diagnosis benchmarks" className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="calm-card p-6">
          <div className="text-[14px] font-semibold text-[#4F4A3F]">
            Average sign-up rate
          </div>
          <div className="mt-2 font-display text-3xl font-bold text-[#1F1B16] tabular-nums">
            {formatPct(summary.avgIdToRegPct)}
          </div>
          <p className="mt-2 text-sm text-[#4F4A3F] tabular-nums">
            Campaigns below {formatPct(summary.avgIdToRegPct !== null ? summary.avgIdToRegPct * 0.75 : null)} are flagged for conversion bottlenecks.
          </p>
        </div>

        <div className="calm-card p-6">
          <div className="text-[14px] font-semibold text-[#4F4A3F]">
            Average 7-day cancel rate
          </div>
          <div className="mt-2 font-display text-3xl font-bold text-[#1F1B16] tabular-nums">
            {formatPct(summary.avgLast7CancelRatePct)}
          </div>
          <p className="mt-2 text-sm text-[#4F4A3F] tabular-nums">
            Campaigns above {formatPct(summary.avgLast7CancelRatePct !== null ? summary.avgLast7CancelRatePct * 1.25 : null)} are flagged for elevated drop-offs.
          </p>
        </div>

        <div className="calm-card p-6">
          <div className="text-[14px] font-semibold text-[#4F4A3F]">
            Campaign health split
          </div>
          <div className="mt-2 font-display text-3xl font-bold text-[#1F1B16] tabular-nums">
            {counts.Underperforming + counts['At risk']} need attention
          </div>
          <p className="mt-2 text-sm text-[#4F4A3F] tabular-nums">
            {counts['On track']} on track (90%+), {counts['At risk']} at risk (60–89%), {counts.Underperforming} underperforming (&lt;60%).
          </p>
        </div>
      </section>

      {/* Filter Bar: Simple text tabs with 2px indigo underline */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ECE6D8] pb-3">
        <div className="flex flex-wrap items-center gap-6">
          {(
            [
              { id: 'all', label: 'All scored', count: scoredItems.length },
              { id: 'Underperforming', label: 'Underperforming', count: counts.Underperforming },
              { id: 'At risk', label: 'At risk', count: counts['At risk'] },
              { id: 'On track', label: 'On track', count: counts['On track'] },
            ] as const
          ).map((tab) => {
            const isSelected = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`pb-2 text-sm font-semibold relative transition-colors ${
                  isSelected ? 'text-[#3B4A8C]' : 'text-[#4F4A3F] hover:text-[#1F1B16]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="ml-1.5 text-xs text-[#6C757D] tabular-nums">({tab.count})</span>
                {isSelected && (
                  <div className="absolute bottom-[-13px] left-0 right-0 h-[2px] bg-[#3B4A8C]" />
                )}
              </button>
            );
          })}
        </div>

        <div className="text-[14px] text-[#4F4A3F] tabular-nums">
          Comparing the 7 days ending {formatShortDate(settings.as_of_date)} with the 7 days before
        </div>
      </div>

      {/* Ranked Diagnosis Cards */}
      <section aria-label="Ranked campaign diagnosis" className="space-y-6">
        {filteredScored.length === 0 ? (
          <div className="calm-card p-12 text-center text-sm text-[#4F4A3F]">
            No active campaigns match this status filter.
          </div>
        ) : (
          filteredScored.map((item, idx) => {
            const c = item.computed;
            const camp = c.campaign;
            const statusStyle = getStatusVisual(item.status);
            const verdict = buildPlainEnglishVerdict(item);
            const bottleneckSentences = buildBottleneckSentences(item, summary);
            const showupPct = Math.round(normalizeShowupRate(camp.assumed_showup) * 100);

            return (
              <article
                key={camp.id}
                style={{ borderLeft: `4px solid ${statusStyle.rowBorderColor}` }}
                className="calm-card p-6 relative overflow-hidden space-y-6"
              >
                {/* (a) Single line: rank number and campaign name in League Spartan 22px, status badge to its right, owner and channel in muted text on same line */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#ECE6D8]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-display text-2xl font-bold text-[#1F1B16] tabular-nums">
                      {idx + 1}.
                    </span>
                    <h2 className="font-display text-2xl font-bold text-[#1F1B16]">
                      {camp.name}
                    </h2>
                    <span className={`px-2.5 py-0.5 text-[13px] font-semibold rounded-full ${statusStyle.badgeClass}`}>
                      {item.status}
                    </span>
                  </div>

                  <div className="text-sm text-[#4F4A3F] tabular-nums">
                    {camp.channel} · Owner: {camp.owner}
                  </div>
                </div>

                {/* (b) Verdict sentence in 18px regular weight */}
                <p className="text-lg text-[#1F1B16] leading-relaxed font-normal">
                  {verdict}
                </p>

                {/* (c) Three columns with NO boxes: What is going wrong | Last 7 days vs previous | Key numbers */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#4F4A3F] mb-2">
                      What is going wrong
                    </h3>
                    {bottleneckSentences.length === 0 ? (
                      <p className="text-sm text-[#1F1B16]">
                        No stage bottleneck flagged against current benchmarks.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {bottleneckSentences.map((sentence) => (
                          <li
                            key={sentence}
                            className="text-sm text-[#1F1B16] leading-relaxed flex items-start gap-2"
                          >
                            <span className="inline-block w-2 h-2 rounded-full bg-[#D6453D] mt-1.5 shrink-0" />
                            <span>{sentence}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="text-[14px] font-semibold text-[#4F4A3F] mb-2">
                      Last 7 days vs the 7 days before
                    </h3>
                    <div className="space-y-2 text-sm tabular-nums">
                      <div className="flex items-center justify-between">
                        <span className="text-[#4F4A3F]">Registrations</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[#1F1B16]">
                            {formatNumber(c.last7Registrations)} vs {formatNumber(c.prev7Registrations)}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 font-semibold"
                            style={{
                              color:
                                item.regDeltaAbs > 0
                                  ? '#2A9D8F'
                                  : item.regDeltaAbs < 0
                                    ? '#D6453D'
                                    : '#4F4A3F',
                            }}
                          >
                            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.regDeltaAbs > 0 ? '#2A9D8F' : '#D6453D' }} />
                            {item.regDeltaAbs > 0 && <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />}
                            {item.regDeltaAbs < 0 && <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />}
                            {item.regDeltaAbs >= 0 ? '+' : ''}
                            {formatNumber(item.regDeltaAbs)}
                            {item.regDeltaPct !== null
                              ? ` (${item.regDeltaPct >= 0 ? '+' : ''}${item.regDeltaPct.toFixed(1)}%)`
                              : ''}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-[#4F4A3F]">Cancel rate</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[#1F1B16]">
                            {formatPct(c.last7CancelRatePct)} vs {formatPct(c.prev7CancelRatePct)}
                          </span>
                          {item.cancelRateDeltaPp !== null && (
                            <span
                              className="inline-flex items-center gap-1 font-semibold"
                              style={{
                                color:
                                  item.cancelRateDeltaPp > 0
                                    ? '#D6453D'
                                    : item.cancelRateDeltaPp < 0
                                      ? '#2A9D8F'
                                      : '#4F4A3F',
                              }}
                            >
                              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.cancelRateDeltaPp > 0 ? '#D6453D' : '#2A9D8F' }} />
                              {item.cancelRateDeltaPp > 0 && <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />}
                              {item.cancelRateDeltaPp < 0 && <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />}
                              {item.cancelRateDeltaPp >= 0 ? '+' : ''}
                              {item.cancelRateDeltaPp.toFixed(1)} pp
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[14px] font-semibold text-[#4F4A3F] mb-2">
                      Key numbers
                    </h3>
                    <div className="space-y-1.5 text-sm tabular-nums">
                      <div className="flex justify-between">
                        <span className="text-[#4F4A3F]">Projected</span>
                        <span className="font-semibold text-[#1F1B16]">
                          {formatNumber(Math.round(c.projectedAttendees))} / {formatNumber(camp.target_attendees)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#4F4A3F]">Show-up rate</span>
                        <span className="font-semibold text-[#1F1B16]">
                          {showupPct}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#4F4A3F]">Cost to date</span>
                        <span className="font-semibold text-[#1F1B16]">
                          {formatInr(c.costPerExpectedAttendeeToDate)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* (d) Bottom text link "Ask the analyst about this campaign" */}
                <div className="pt-2 border-t border-[#ECE6D8]">
                  <button
                    type="button"
                    onClick={() =>
                      onAskAnalyst(
                        `Why is ${camp.name} at ${formatPct(c.projectedPctOfTarget)} of target and what should we do next?`
                      )
                    }
                    className="text-sm font-semibold text-[#3B4A8C] hover:underline inline-flex items-center gap-1"
                  >
                    Ask the analyst about this campaign →
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>

      {/* Not scored section */}
      {(enablerCampaigns.length > 0 || plannedItems.length > 0) && (
        <section
          aria-label="Not scored campaigns"
          className="calm-card p-6 space-y-4"
        >
          <div className="pb-3 border-b border-[#ECE6D8]">
            <h2 className="font-display text-lg font-bold text-[#1F1B16]">
              Not scored
            </h2>
            <p className="mt-1 text-sm text-[#4F4A3F]">
              Enabler campaigns support other channels, and planned campaigns have no logged metrics yet.
            </p>
          </div>

          <div className="divide-y divide-[#ECE6D8]">
            {plannedItems.map((item) => {
              const c = item.computed.campaign;
              const style = getStatusVisual('Planned');
              return (
                <div
                  key={c.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold text-[#6C757D] tabular-nums">
                      {c.code}
                    </span>
                    <span className="text-sm font-semibold text-[#1F1B16]">
                      {c.name}
                    </span>
                    <span className={`px-2.5 py-0.5 text-[13px] font-semibold rounded-full ${style.badgeClass}`}>
                      Planned
                    </span>
                  </div>
                  <div className="text-[13px] text-[#4F4A3F] tabular-nums">
                    Starts {formatShortDate(c.planned_start)} · Target {formatNumber(c.target_attendees)} attendees · Owner: {c.owner}
                  </div>
                </div>
              );
            })}

            {enablerCampaigns.map((e) => {
              const c = e.campaign;
              const style = getStatusVisual('Enabler');
              return (
                <div
                  key={c.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold text-[#6C757D] tabular-nums">
                      {c.code}
                    </span>
                    <span className="text-sm font-semibold text-[#1F1B16]">
                      {c.name}
                    </span>
                    <span className={`px-2.5 py-0.5 text-[13px] font-semibold rounded-full ${style.badgeClass}`}>
                      Enabler
                    </span>
                  </div>
                  <div className="text-[13px] text-[#4F4A3F] tabular-nums">
                    Supports other campaigns · Spend {formatInr(e.spend)} of {formatInr(c.budget)} · Owner: {c.owner}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
