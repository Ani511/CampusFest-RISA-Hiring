import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from 'lucide-react';
import {
  addDaysUtc,
  formatInr,
  formatNumber,
  formatPct,
  normalizeShowupRate,
} from '../lib/analytics';
import type {
  CampaignComputed,
  DailyMetric,
  DashboardSummary,
  GrowthSettings,
} from '../types/growth';
import { RoadToFestivalChart } from './RoadToFestivalChart';
import {
  AnimatedNumber,
  formatShortDate,
  getCampaignRowStatus,
  getDaysListUtc,
  getStatusVisual,
} from './uiHelpers';

interface DashboardTabProps {
  campaignRows: CampaignComputed[];
  dailyMetrics: DailyMetric[];
  summary: DashboardSummary;
  settings: GrowthSettings;
}

type CampaignFilter = 'all' | 'acquisition' | 'enabler' | 'planned';
type SortKey =
  | 'campaign'
  | 'identified'
  | 'registrations'
  | 'id_to_reg'
  | 'net_confirmed'
  | 'cancel_rate'
  | 'spend'
  | 'budget_used'
  | 'cost_to_date'
  | 'cost_projected'
  | 'target'
  | 'projected'
  | 'proj_pct';

export const DashboardTab: React.FC<DashboardTabProps> = ({
  campaignRows,
  dailyMetrics,
  summary,
  settings,
}) => {
  const [filter, setFilter] = useState<CampaignFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('campaign');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'campaign' ? 'asc' : 'desc');
    }
  };

  const filteredAndSortedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = campaignRows.filter((row) => {
      if (selectedCampaignId && row.campaign.id !== selectedCampaignId) {
        return false;
      }
      if (filter === 'acquisition' && row.isEnabler) return false;
      if (filter === 'enabler' && !row.isEnabler) return false;
      if (filter === 'planned' && !row.isPlanned) return false;
      if (!q) return true;
      const c = row.campaign;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.channel.toLowerCase().includes(q) ||
        c.segment.toLowerCase().includes(q) ||
        c.owner.toLowerCase().includes(q)
      );
    });

    const getVal = (r: CampaignComputed): number | string | null => {
      switch (sortKey) {
        case 'campaign':
          return `${r.campaign.code} ${r.campaign.name}`.toLowerCase();
        case 'identified':
          return r.isEnabler ? null : r.identified;
        case 'registrations':
          return r.isEnabler ? null : r.registrations;
        case 'id_to_reg':
          return r.isEnabler ? null : r.identifiedToRegisteredPct;
        case 'net_confirmed':
          return r.isEnabler ? null : r.netConfirmed;
        case 'cancel_rate':
          return r.isEnabler ? null : r.cancelRatePct;
        case 'spend':
          return r.spend;
        case 'budget_used':
          return r.budgetUsedPct;
        case 'cost_to_date':
          return r.isEnabler ? null : r.costPerExpectedAttendeeToDate;
        case 'cost_projected':
          return r.isEnabler ? null : r.costPerProjectedAttendee;
        case 'target':
          return r.isEnabler ? null : r.campaign.target_attendees;
        case 'projected':
          return r.isEnabler ? null : r.projectedAttendees;
        case 'proj_pct':
          return r.isEnabler ? null : r.projectedPctOfTarget;
      }
    };

    return [...filtered].sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = Number(va);
      const nb = Number(vb);
      return sortDir === 'asc' ? na - nb : nb - na;
    });
  }, [campaignRows, selectedCampaignId, filter, search, sortKey, sortDir]);

  const sparklineDates = useMemo(() => {
    const end = settings.as_of_date.slice(0, 10) || '2026-03-21';
    const start = addDaysUtc(end, -27);
    return getDaysListUtc(start, end);
  }, [settings.as_of_date]);

  const dailyRegLookup = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const m of dailyMetrics) {
      const d = String(m.metric_date ?? '').slice(0, 10);
      if (!d) continue;
      let campMap = map.get(m.campaign_id);
      if (!campMap) {
        campMap = new Map<string, number>();
        map.set(m.campaign_id, campMap);
      }
      campMap.set(d, (campMap.get(d) ?? 0) + (Number(m.registrations) || 0));
    }
    return map;
  }, [dailyMetrics]);

  const funnelData = useMemo(() => {
    const maxVal = Math.max(
      summary.totalIdentified,
      summary.totalRegistrations,
      summary.totalNetConfirmed,
      summary.totalProjectedAttendees,
      1
    );

    const signUpPct =
      summary.totalIdentified > 0
        ? (summary.totalRegistrations / summary.totalIdentified) * 100
        : null;
    const stayConfirmedPct =
      summary.totalRegistrations > 0
        ? (summary.totalNetConfirmed / summary.totalRegistrations) * 100
        : null;

    return {
      stages: [
        {
          label: 'Identified',
          value: summary.totalIdentified,
          widthPct: Math.max(3, (summary.totalIdentified / maxVal) * 100),
          color: '#3B4A8C',
          bridgeText:
            signUpPct !== null ? `${formatPct(signUpPct)} sign up` : null,
        },
        {
          label: 'Registrations',
          value: summary.totalRegistrations,
          widthPct: Math.max(3, (summary.totalRegistrations / maxVal) * 100),
          color: '#3B4A8C',
          bridgeText:
            stayConfirmedPct !== null
              ? `${formatPct(stayConfirmedPct)} stay confirmed`
              : null,
        },
        {
          label: 'Net confirmed',
          value: summary.totalNetConfirmed,
          widthPct: Math.max(3, (summary.totalNetConfirmed / maxVal) * 100),
          color: '#F4C430',
          bridgeText: `+${formatNumber(settings.walk_in_allowance)} walk-in allowance & show-up weighting`,
        },
        {
          label: 'Projected attendees',
          value: Math.round(summary.totalProjectedAttendees),
          widthPct: Math.max(3, (summary.totalProjectedAttendees / maxVal) * 100),
          color: '#2A9D8F',
          bridgeText: null,
        },
      ],
    };
  }, [summary, settings]);

  const maxBudgetOrSpend = useMemo(() => {
    let maxVal = 1;
    for (const r of campaignRows) {
      maxVal = Math.max(maxVal, r.campaign.budget, r.spend);
    }
    return maxVal;
  }, [campaignRows]);

  const overallIdToReg =
    summary.totalIdentified > 0
      ? (summary.totalRegistrations / summary.totalIdentified) * 100
      : null;

  const costTakeaway = useMemo(() => {
    const withCost = campaignRows.filter(
      (r) => !r.isEnabler && !r.isPlanned && r.costPerExpectedAttendeeToDate !== null
    );
    if (withCost.length === 0) {
      return 'No active acquisition spend logged yet.';
    }
    const sorted = [...withCost].sort(
      (a, b) =>
        (b.costPerExpectedAttendeeToDate ?? 0) -
        (a.costPerExpectedAttendeeToDate ?? 0)
    );
    const highest = sorted[0];
    const cheapest = sorted[sorted.length - 1];
    return `${cheapest.campaign.name} is cheapest at ${formatInr(cheapest.costPerExpectedAttendeeToDate)}/att; ${highest.campaign.name} is ${formatInr(highest.costPerExpectedAttendeeToDate)}.`;
  }, [campaignRows]);

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-[#6C757D] inline-block ml-1 shrink-0" aria-hidden="true" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-[#3B4A8C] inline-block ml-1 shrink-0" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-[#3B4A8C] inline-block ml-1 shrink-0" aria-hidden="true" />
    );
  };

  return (
    <div className="space-y-8">
      {/* Road to the festival chart */}
      <RoadToFestivalChart
        dailyMetrics={dailyMetrics}
        campaignRows={campaignRows}
        summary={summary}
        settings={settings}
        selectedCampaignId={selectedCampaignId}
        onSelectCampaign={(id) => {
          setSelectedCampaignId(id);
          if (id) setExpandedRowId(id);
        }}
      />

      {/* Four KPI Cards: League Spartan 36px number and one 14px sentence */}
      <section aria-label="Key performance metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
          <article className="calm-card p-6 flex flex-col justify-between">
            <div>
              <div className="text-[14px] font-semibold text-[#4F4A3F]">
                Registrations
              </div>
              <div className="mt-2 font-display text-[36px] font-bold text-[#1F1B16] tabular-nums leading-none">
                <AnimatedNumber
                  value={summary.totalRegistrations}
                  formatter={(v) => formatNumber(Math.round(v))}
                />
              </div>
            </div>
            <p className="mt-4 text-[14px] text-[#4F4A3F] leading-snug tabular-nums">
              {overallIdToReg !== null
                ? `${formatPct(overallIdToReg, 0)} of identified people signed up (${formatNumber(summary.totalRegistrations)} of ${formatNumber(summary.totalIdentified)}).`
                : 'No leads identified yet.'}
            </p>
          </article>

          <article className="calm-card p-6 flex flex-col justify-between">
            <div>
              <div className="text-[14px] font-semibold text-[#4F4A3F]">
                Projected attendees
              </div>
              <div className="mt-2 font-display text-[36px] font-bold text-[#1F1B16] tabular-nums leading-none">
                <AnimatedNumber
                  value={Math.round(summary.totalProjectedAttendees)}
                  formatter={(v) => formatNumber(Math.round(v))}
                />
              </div>
            </div>
            <p className="mt-4 text-[14px] text-[#4F4A3F] leading-snug tabular-nums">
              {formatPct(summary.projectedVsBasePct)} of base target ({formatNumber(settings.total_target_base)}),{' '}
              {formatPct(summary.projectedVsStretchPct)} of stretch ({formatNumber(settings.total_target_stretch)}).
            </p>
          </article>

          <article className="calm-card p-6 flex flex-col justify-between">
            <div>
              <div className="text-[14px] font-semibold text-[#4F4A3F]">
                Total spend
              </div>
              <div className="mt-2 font-display text-[36px] font-bold text-[#1F1B16] tabular-nums leading-none">
                <AnimatedNumber
                  value={summary.totalSpend}
                  formatter={(v) => formatInr(Math.round(v))}
                />
              </div>
            </div>
            <p className="mt-4 text-[14px] text-[#4F4A3F] leading-snug tabular-nums">
              {formatPct(summary.budgetUsedPct)} of {formatInr(settings.total_budget)} budget used,{' '}
              {summary.daysRemaining} days left.
            </p>
          </article>

          <article className="calm-card p-6 flex flex-col justify-between">
            <div>
              <div className="text-[14px] font-semibold text-[#4F4A3F]">
                Cost per expected attendee to date
              </div>
              <div className="mt-2 font-display text-[36px] font-bold text-[#1F1B16] tabular-nums leading-none">
                <AnimatedNumber
                  value={Math.round(summary.costPerExpectedAttendeeToDate ?? 0)}
                  formatter={(v) =>
                    summary.costPerExpectedAttendeeToDate !== null
                      ? formatInr(Math.round(v))
                      : '—'
                  }
                />
              </div>
            </div>
            <p className="mt-4 text-[14px] text-[#4F4A3F] leading-snug tabular-nums">
              {costTakeaway}
            </p>
          </article>
        </div>
      </section>

      {/* Funnel + Budget vs Spend */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-5 calm-card p-6 flex flex-col justify-between">
          <div>
            <div className="pb-4 border-b border-[#ECE6D8]">
              <h2 className="font-display text-xl font-bold text-[#1F1B16]">
                Attendee conversion funnel
              </h2>
              <p className="mt-1 text-sm text-[#4F4A3F]">
                How identified leads narrow down to projected event-day turnout
              </p>
            </div>

            <div className="mt-5 space-y-4">
              {funnelData.stages.map((stage) => (
                <div key={stage.label}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold text-[#4F4A3F]">
                      {stage.label}
                    </span>
                    <span className="text-base font-bold text-[#1F1B16] tabular-nums">
                      {formatNumber(stage.value)}
                    </span>
                  </div>
                  <div className="w-full h-7 bg-[#FFFEF7] border border-[#DDD5C4] rounded-lg overflow-hidden">
                    <div
                      className="h-full rounded-l-lg"
                      style={{
                        width: `${stage.widthPct}%`,
                        backgroundColor: stage.color,
                      }}
                    />
                  </div>
                  {stage.bridgeText && (
                    <div className="mt-1 pl-2 text-[13px] text-[#6C757D] tabular-nums">
                      {stage.bridgeText}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[#ECE6D8] flex items-center justify-between text-[13px] font-semibold text-[#4F4A3F] tabular-nums">
            <span>Net confirmed ({formatNumber(summary.totalConfirmed)} conf, {formatNumber(summary.totalCancelled)} canc)</span>
            <span>{formatNumber(summary.totalNetConfirmed)}</span>
          </div>
        </div>

        <div className="lg:col-span-7 calm-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-3 pb-4 border-b border-[#ECE6D8]">
              <div>
                <h2 className="font-display text-xl font-bold text-[#1F1B16]">
                  Budget versus spend
                </h2>
                <p className="mt-1 text-sm text-[#4F4A3F]">
                  Filled bar shows actual spend; outline shows allocated campaign budget
                </p>
              </div>
              <div className="flex items-center gap-4 text-[13px] font-semibold text-[#4F4A3F]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-[#3B4A8C] rounded-sm inline-block" />
                  Spend
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 border border-[#B8BDDB] bg-[#E6E8F5] rounded-sm inline-block" />
                  Budget
                </span>
              </div>
            </div>

            {campaignRows.length === 0 ? (
              <div className="py-12 text-center text-sm text-[#4F4A3F]">
                No campaigns found yet. Add one under Tasks and campaigns.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {campaignRows.map((row) => {
                  const c = row.campaign;
                  const budgetPctWidth = (c.budget / maxBudgetOrSpend) * 100;
                  const spendPctWidth = (row.spend / maxBudgetOrSpend) * 100;
                  const spendVsBudgetPct = c.budget > 0 ? (row.spend / c.budget) * 100 : 0;
                  const overBudget = c.budget > 0 && row.spend > c.budget;

                  return (
                    <div key={c.id} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <div className="min-w-0 truncate">
                          <span className="text-[13px] font-semibold text-[#6C757D] mr-2 tabular-nums">
                            {c.code}
                          </span>
                          <span className="font-semibold text-[#1F1B16]">
                            {c.name}
                          </span>
                          {row.isEnabler && (
                            <span className="ml-2 text-[13px] text-[#6C757D]">
                              (Enabler)
                            </span>
                          )}
                        </div>
                        <div className="shrink-0 text-[13px] font-semibold tabular-nums text-[#1F1B16]">
                          <span className={overBudget ? 'text-[#D6453D]' : ''}>
                            {formatInr(row.spend)}
                          </span>
                          {' / '}
                          <span>{formatInr(c.budget)}</span>
                          <span className="ml-2 text-[#6C757D]">
                            ({formatPct(row.budgetUsedPct, 0)})
                          </span>
                        </div>
                      </div>

                      <div
                        className="relative h-5 flex items-center bg-[#E6E8F5] border border-[#B8BDDB] rounded-lg overflow-hidden"
                        style={{ width: `${Math.max(15, budgetPctWidth)}%`, boxSizing: 'border-box' }}
                      >
                        <div
                          className="absolute left-0 top-0 bottom-0"
                          style={{
                            width: `${Math.min(100, spendVsBudgetPct)}%`,
                            backgroundColor: overBudget ? '#D6453D' : '#3B4A8C',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-[#ECE6D8] flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold text-[#4F4A3F] tabular-nums">
            <span>
              Includes {formatInr(summary.enablerSpend)} enabler spend
            </span>
            <span>
              Total: {formatInr(summary.totalSpend)} of {formatInr(settings.total_budget)}
            </span>
          </div>
        </div>
      </section>

      {/* Campaign Performance Table */}
      <section className="calm-card overflow-hidden">
        <div className="px-6 py-5 border-b border-[#DDD5C4] flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-[#1F1B16]">
              Campaign breakdown
            </h2>
            <p className="text-sm text-[#4F4A3F] mt-1">
              Click any column header to sort, or click a campaign row to inspect its 28-day registration trend.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {selectedCampaignId && (
              <button
                type="button"
                onClick={() => setSelectedCampaignId(null)}
                className="calm-btn-secondary text-sm py-1.5"
              >
                Clear chart filter
              </button>
            )}

            <div className="flex items-center gap-2 text-sm font-semibold">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'acquisition', label: 'Acquisition' },
                  { id: 'enabler', label: 'Enablers' },
                  { id: 'planned', label: 'Planned' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-3 py-1 rounded-lg transition-colors ${
                    filter === tab.id
                      ? 'bg-[#3B4A8C] text-white'
                      : 'bg-white text-[#4F4A3F] border border-[#DDD5C4] hover:border-[#3B4A8C]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campaigns..."
              aria-label="Search campaigns"
              className="px-3.5 py-1.5 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16] w-48 placeholder:text-[#6C757D]"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[640px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-white border-b border-[#DDD5C4]">
              <tr className="text-[14px] font-semibold text-[#4F4A3F]">
                <th className="py-3 px-6 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('campaign')}
                    className="inline-flex items-center text-left hover:text-[#3B4A8C]"
                  >
                    Campaign {renderSortIcon('campaign')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('identified')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Identified {renderSortIcon('identified')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('registrations')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Registrations {renderSortIcon('registrations')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('id_to_reg')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Id to reg % {renderSortIcon('id_to_reg')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('net_confirmed')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Net confirmed {renderSortIcon('net_confirmed')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('cancel_rate')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Cancel rate {renderSortIcon('cancel_rate')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('spend')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Spend {renderSortIcon('spend')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('budget_used')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Budget used % {renderSortIcon('budget_used')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right min-w-[155px]">
                  <button
                    type="button"
                    onClick={() => handleSort('cost_to_date')}
                    className="inline-flex items-center justify-end text-right hover:text-[#3B4A8C]"
                  >
                    Cost per expected attendee to date {renderSortIcon('cost_to_date')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right min-w-[180px]">
                  <button
                    type="button"
                    onClick={() => handleSort('cost_projected')}
                    className="inline-flex items-center justify-end text-right hover:text-[#3B4A8C]"
                  >
                    INR per projected attendee (at full-event projection) {renderSortIcon('cost_projected')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('target')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Target att. {renderSortIcon('target')}
                  </button>
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('projected')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Projected att. {renderSortIcon('projected')}
                  </button>
                </th>
                <th className="py-3 px-6 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('proj_pct')}
                    className="inline-flex items-center justify-end hover:text-[#3B4A8C]"
                  >
                    Proj. % target {renderSortIcon('proj_pct')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE6D8] text-[15px]">
              {filteredAndSortedRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-sm text-[#4F4A3F]">
                    No campaigns match the active filter.
                  </td>
                </tr>
              ) : (
                filteredAndSortedRows.map((row) => {
                  const c = row.campaign;
                  const status = getCampaignRowStatus(
                    row.isEnabler,
                    row.isPlanned,
                    row.projectedPctOfTarget
                  );
                  const statusStyle = getStatusVisual(status);
                  const isExpanded = expandedRowId === c.id;
                  const showupPct = Math.round(
                    normalizeShowupRate(c.assumed_showup) * 100
                  );

                  const campDailyMap = dailyRegLookup.get(c.id);
                  const sparkValues = sparklineDates.map(
                    (d) => campDailyMap?.get(d) ?? 0
                  );
                  const maxSpark = Math.max(1, ...sparkValues);

                  return (
                    <React.Fragment key={c.id}>
                      <tr
                        onClick={() =>
                          setExpandedRowId((prev) => (prev === c.id ? null : c.id))
                        }
                        aria-expanded={isExpanded}
                        style={{ borderLeft: `4px solid ${statusStyle.rowBorderColor}` }}
                        className={`cursor-pointer transition-colors ${
                          isExpanded
                            ? 'bg-[#F8F6F0]'
                            : 'hover:bg-[#F8F6F0]'
                        }`}
                      >
                        <td className="py-3.5 px-6 min-w-[240px]">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-[#6C757D] shrink-0" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[#6C757D] shrink-0" aria-hidden="true" />
                            )}
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-[#6C757D] tabular-nums">
                                  {c.code}
                                </span>
                                <span className="font-semibold text-[#1F1B16]">
                                  {c.name}
                                </span>
                                <span className={statusStyle.badgeClass}>
                                  {status}
                                </span>
                              </div>
                              <div className="text-[13px] text-[#4F4A3F] mt-0.5">
                                {c.channel} · {c.segment} · {c.owner}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {row.isEnabler ? '—' : formatNumber(row.identified)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {row.isEnabler ? '—' : formatNumber(row.registrations)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {row.isEnabler ? '—' : formatPct(row.identifiedToRegisteredPct)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {row.isEnabler ? '—' : formatNumber(row.netConfirmed)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {row.isEnabler ? '—' : formatPct(row.cancelRatePct)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {formatInr(row.spend)}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right tabular-nums ${
                            (row.budgetUsedPct ?? 0) > 100
                              ? 'text-[#D6453D] font-semibold'
                              : 'text-[#1F1B16]'
                          }`}
                        >
                          {formatPct(row.budgetUsedPct)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {row.isEnabler
                            ? '—'
                            : formatInr(row.costPerExpectedAttendeeToDate)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {row.isEnabler ? '—' : formatInr(row.costPerProjectedAttendee)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-[#1F1B16]">
                          {row.isEnabler ? '—' : formatNumber(c.target_attendees)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-[#1F1B16]">
                          {row.isEnabler
                            ? '—'
                            : formatNumber(Math.round(row.projectedAttendees))}
                        </td>
                        <td className="py-3.5 px-6 text-right tabular-nums font-semibold text-[#1F1B16]">
                          {row.isEnabler ? '—' : formatPct(row.projectedPctOfTarget)}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr
                          style={{ borderLeft: `4px solid ${statusStyle.rowBorderColor}` }}
                          className="bg-[#F8F6F0]"
                        >
                          <td colSpan={13} className="px-6 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-6">
                              <div>
                                <div className="text-[13px] font-semibold text-[#4F4A3F] mb-2">
                                  Daily registrations over the last 28 days ({formatShortDate(sparklineDates[0], false)} – {formatShortDate(sparklineDates[sparklineDates.length - 1], false)})
                                </div>
                                {row.isEnabler ? (
                                  <div className="text-[13px] text-[#4F4A3F]">
                                    Enabler campaign supporting operations; no direct registrations tracked.
                                  </div>
                                ) : (
                                  <svg
                                    width="336"
                                    height="56"
                                    viewBox="0 0 336 56"
                                    role="img"
                                    aria-label={`Last 28 days registrations sparkline for ${c.name}`}
                                    className="block bg-white border border-[#DDD5C4] rounded-lg"
                                  >
                                    <line
                                      x1="0"
                                      y1="52"
                                      x2="336"
                                      y2="52"
                                      stroke="#DDD5C4"
                                      strokeWidth="1"
                                    />
                                    {sparkValues.map((val, i) => {
                                      const barH =
                                        val > 0 ? Math.max(4, (val / maxSpark) * 44) : 2;
                                      const x = i * 12;
                                      const y = 52 - barH;
                                      return (
                                        <rect
                                          key={sparklineDates[i]}
                                          x={x}
                                          y={y}
                                          width="9"
                                          height={barH}
                                          fill={val > 0 ? '#3B4A8C' : '#ECE6D8'}
                                          rx="2"
                                        >
                                          <title>
                                            {formatShortDate(sparklineDates[i], true)}: {val} registrations
                                          </title>
                                        </rect>
                                      );
                                    })}
                                  </svg>
                                )}
                              </div>

                              {!row.isEnabler && (
                                <div className="flex flex-wrap items-center gap-6 text-sm tabular-nums text-[#1F1B16]">
                                  <div>
                                    <div className="text-[13px] text-[#6C757D]">
                                      Registrations to date
                                    </div>
                                    <div className="font-semibold text-base">
                                      {formatNumber(row.registrations)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[13px] text-[#6C757D]">
                                      7-day average
                                    </div>
                                    <div className="font-semibold text-base">
                                      {row.avgDailyRegLast7.toFixed(1)}/day
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[13px] text-[#6C757D]">
                                      Days left
                                    </div>
                                    <div className="font-semibold text-base">
                                      {summary.daysRemaining}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[13px] text-[#6C757D]">
                                      Assumed show-up
                                    </div>
                                    <div className="font-semibold text-base">
                                      {showupPct}%
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[13px] text-[#6C757D]">
                                      Projected attendees
                                    </div>
                                    <div className="font-display font-bold text-lg text-[#1F1B16]">
                                      {formatNumber(Math.round(row.projectedAttendees))}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>

            <tfoot className="bg-[#FFFEF7] border-t border-[#DDD5C4] text-[14px] font-semibold text-[#1F1B16]">
              <tr>
                <td className="py-3 px-6 text-[#4F4A3F]">
                  Walk-in allowance (Settings)
                </td>
                <td colSpan={10} className="py-3 px-4 text-right text-[#4F4A3F]">
                  Added to acquisition projections
                </td>
                <td className="py-3 px-4 text-right tabular-nums">
                  +{formatNumber(settings.walk_in_allowance)}
                </td>
                <td className="py-3 px-6 text-right tabular-nums">—</td>
              </tr>
              <tr className="border-t border-[#DDD5C4]">
                <td className="py-3.5 px-6 font-bold">
                  Total (incl. enabler spend and walk-ins)
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatNumber(summary.totalIdentified)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatNumber(summary.totalRegistrations)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatPct(overallIdToReg)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatNumber(summary.totalNetConfirmed)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatPct(
                    summary.totalConfirmed > 0
                      ? (summary.totalCancelled / summary.totalConfirmed) * 100
                      : null
                  )}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatInr(summary.totalSpend)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatPct(summary.budgetUsedPct)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatInr(summary.costPerExpectedAttendeeToDate)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatInr(summary.costPerProjectedAttendee)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatNumber(settings.total_target_base)}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums font-bold">
                  {formatNumber(Math.round(summary.totalProjectedAttendees))}
                </td>
                <td className="py-3.5 px-6 text-right tabular-nums font-bold">
                  {formatPct(summary.projectedVsBasePct)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
};
