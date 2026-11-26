import type {
  Campaign,
  CampaignComputed,
  DailyMetric,
  DashboardSummary,
  DiagnosisItem,
  DiagnosisStatus,
  GrowthSettings,
  WindowFunnelMetrics,
} from '../types/growth.js';

const MS_PER_DAY = 86_400_000;

export function parseUtcDateMs(dateStr: string): number {
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return NaN;
  }
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

export function addDaysUtc(dateStr: string, deltaDays: number): string {
  const ms = parseUtcDateMs(dateStr);
  if (Number.isNaN(ms)) return dateStr;
  const d = new Date(ms + deltaDays * MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenUtc(startStr: string, endStr: string): number {
  const s = parseUtcDateMs(startStr);
  const e = parseUtcDateMs(endStr);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.max(0, Math.round((e - s) / MS_PER_DAY));
}

export function normalizeShowupRate(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || Number.isNaN(Number(raw))) return 0;
  const num = Number(raw);
  return num > 1 ? num / 100 : num;
}

export function parseSettingsRows(rows: Array<Record<string, unknown>>): GrowthSettings {
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = String(row.key ?? row.setting_key ?? row.name ?? '').trim();
    const val = row.value ?? row.setting_value ?? '';
    if (key) {
      map.set(key, String(val ?? '').trim());
    }
  }

  const num = (key: string): number => {
    const raw = map.get(key);
    if (!raw) return 0;
    const parsed = Number(raw.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    as_of_date: map.get('as_of_date') || '',
    event_date: map.get('event_date') || '',
    total_budget: num('total_budget'),
    total_target_base: num('total_target_base'),
    total_target_stretch: num('total_target_stretch'),
    walk_in_allowance: num('walk_in_allowance'),
    venue_capacity_per_day: num('venue_capacity_per_day'),
  };
}

export function computeGrowthAnalytics(
  campaigns: Campaign[],
  dailyMetrics: DailyMetric[],
  settings: GrowthSettings
): {
  campaignRows: CampaignComputed[];
  summary: DashboardSummary;
  diagnosis: DiagnosisItem[];
} {
  const asOfDate = settings.as_of_date.slice(0, 10);
  const eventDate = settings.event_date.slice(0, 10);
  const daysRemaining = asOfDate && eventDate ? daysBetweenUtc(asOfDate, eventDate) : 0;

  // Inclusive 7-day windows anchored to settings.as_of_date
  const last7Start = asOfDate ? addDaysUtc(asOfDate, -6) : '';
  const prev7Start = asOfDate ? addDaysUtc(asOfDate, -13) : '';
  const prev7End = asOfDate ? addDaysUtc(asOfDate, -7) : '';

  // Group daily_metrics by campaign_id (strictly up to as_of_date when set)
  const metricsByCampaign = new Map<string, DailyMetric[]>();
  for (const m of dailyMetrics) {
    const dateKey = String(m.metric_date ?? '').slice(0, 10);
    if (asOfDate && dateKey > asOfDate) {
      continue;
    }
    const list = metricsByCampaign.get(m.campaign_id) ?? [];
    list.push({ ...m, metric_date: dateKey });
    metricsByCampaign.set(m.campaign_id, list);
  }

  const buildWindowFunnel = (acc: {
    impressions: number;
    clicks: number;
    landing_page_sessions: number;
    registration_starts: number;
    identified: number;
    registrations: number;
    spend: number;
  }): WindowFunnelMetrics => ({
    ...acc,
    clicksPerImpressionPct:
      acc.impressions > 0 ? (acc.clicks / acc.impressions) * 100 : null,
    sessionsPerClickPct:
      acc.clicks > 0 ? (acc.landing_page_sessions / acc.clicks) * 100 : null,
    regStartsPerSessionPct:
      acc.landing_page_sessions > 0
        ? (acc.registration_starts / acc.landing_page_sessions) * 100
        : null,
    regsPerRegStartPct:
      acc.registration_starts > 0
        ? (acc.registrations / acc.registration_starts) * 100
        : null,
  });

  const campaignRows: CampaignComputed[] = campaigns.map((campaign) => {
    const rows = metricsByCampaign.get(campaign.id) ?? [];
    const isEnabler = campaign.kind === 'enabler';
    const isPlanned = rows.length === 0;

    let identified = 0;
    let registrations = 0;
    let confirmed = 0;
    let cancelled = 0;
    let spend = 0;

    let last7Registrations = 0;
    let prev7Registrations = 0;
    let last7Confirmed = 0;
    let last7Cancelled = 0;
    let prev7Confirmed = 0;
    let prev7Cancelled = 0;
    let earlierConfirmed = 0;
    let earlierCancelled = 0;

    const last7Acc = {
      impressions: 0,
      clicks: 0,
      landing_page_sessions: 0,
      registration_starts: 0,
      identified: 0,
      registrations: 0,
      spend: 0,
    };
    const prev7Acc = {
      impressions: 0,
      clicks: 0,
      landing_page_sessions: 0,
      registration_starts: 0,
      identified: 0,
      registrations: 0,
      spend: 0,
    };

    for (const r of rows) {
      const impVal = Number(r.impressions) || 0;
      const clkVal = Number(r.clicks) || 0;
      const sesVal = Number(r.landing_page_sessions) || 0;
      const rsVal = Number(r.registration_starts) || 0;
      const idVal = Number(r.identified) || 0;
      const regVal = Number(r.registrations) || 0;
      const confVal = Number(r.confirmed) || 0;
      const cancVal = Number(r.cancelled) || 0;
      const spendVal = Number(r.spend) || 0;

      identified += idVal;
      registrations += regVal;
      confirmed += confVal;
      cancelled += cancVal;
      spend += spendVal;

      const d = r.metric_date;
      if (asOfDate && d >= last7Start && d <= asOfDate) {
        last7Registrations += regVal;
        last7Confirmed += confVal;
        last7Cancelled += cancVal;
        last7Acc.impressions += impVal;
        last7Acc.clicks += clkVal;
        last7Acc.landing_page_sessions += sesVal;
        last7Acc.registration_starts += rsVal;
        last7Acc.identified += idVal;
        last7Acc.registrations += regVal;
        last7Acc.spend += spendVal;
      } else if (asOfDate && d < last7Start) {
        earlierConfirmed += confVal;
        earlierCancelled += cancVal;
        if (d >= prev7Start && d <= prev7End) {
          prev7Registrations += regVal;
          prev7Confirmed += confVal;
          prev7Cancelled += cancVal;
          prev7Acc.impressions += impVal;
          prev7Acc.clicks += clkVal;
          prev7Acc.landing_page_sessions += sesVal;
          prev7Acc.registration_starts += rsVal;
          prev7Acc.identified += idVal;
          prev7Acc.registrations += regVal;
          prev7Acc.spend += spendVal;
        }
      }
    }

    const netConfirmed = confirmed - cancelled;
    const identifiedToRegisteredPct =
      !isEnabler && identified > 0 ? (registrations / identified) * 100 : null;
    const cancelRatePct =
      !isEnabler && confirmed > 0 ? (cancelled / confirmed) * 100 : null;
    const budgetUsedPct =
      campaign.budget > 0 ? (spend / campaign.budget) * 100 : null;

    const avgDailyRegLast7 = last7Registrations / 7;
    const showupFactor = normalizeShowupRate(campaign.assumed_showup);
    const projectedAttendees = isEnabler
      ? 0
      : (registrations + avgDailyRegLast7 * daysRemaining) * showupFactor;
    const expectedAttendeesToDate = isEnabler
      ? 0
      : registrations * showupFactor;
    const costPerExpectedAttendeeToDate =
      !isEnabler && expectedAttendeesToDate > 0
        ? spend / expectedAttendeesToDate
        : null;

    const costPerProjectedAttendee =
      !isEnabler && projectedAttendees > 0 ? spend / projectedAttendees : null;
    const projectedPctOfTarget =
      !isEnabler && campaign.target_attendees > 0
        ? (projectedAttendees / campaign.target_attendees) * 100
        : null;

    const regChangePct =
      prev7Registrations > 0
        ? ((last7Registrations - prev7Registrations) / prev7Registrations) * 100
        : null;

    const last7CancelRatePct =
      last7Confirmed > 0 ? (last7Cancelled / last7Confirmed) * 100 : null;
    const prev7CancelRatePct =
      prev7Confirmed > 0 ? (prev7Cancelled / prev7Confirmed) * 100 : null;
    const earlierCancelRatePct =
      earlierConfirmed > 0 ? (earlierCancelled / earlierConfirmed) * 100 : null;

    return {
      campaign,
      isEnabler,
      isPlanned,
      metricsCount: rows.length,
      identified,
      registrations,
      confirmed,
      cancelled,
      netConfirmed,
      spend,
      identifiedToRegisteredPct,
      cancelRatePct,
      budgetUsedPct,
      avgDailyRegLast7,
      projectedAttendees,
      expectedAttendeesToDate,
      costPerExpectedAttendeeToDate,
      costPerProjectedAttendee,
      projectedPctOfTarget,
      last7Registrations,
      prev7Registrations,
      regChangePct,
      last7Confirmed,
      last7Cancelled,
      last7CancelRatePct,
      prev7Confirmed,
      prev7Cancelled,
      prev7CancelRatePct,
      earlierConfirmed,
      earlierCancelled,
      earlierCancelRatePct,
      last7Funnel: buildWindowFunnel(last7Acc),
      prev7Funnel: buildWindowFunnel(prev7Acc),
    };
  });

  // Aggregate summary
  const acquisitionRows = campaignRows.filter((r) => !r.isEnabler);
  const enablerRows = campaignRows.filter((r) => r.isEnabler);

  const totalIdentified = acquisitionRows.reduce((s, r) => s + r.identified, 0);
  const totalRegistrations = acquisitionRows.reduce((s, r) => s + r.registrations, 0);
  const totalConfirmed = acquisitionRows.reduce((s, r) => s + r.confirmed, 0);
  const totalCancelled = acquisitionRows.reduce((s, r) => s + r.cancelled, 0);
  const totalNetConfirmed = acquisitionRows.reduce((s, r) => s + r.netConfirmed, 0);

  const acquisitionSpend = acquisitionRows.reduce((s, r) => s + r.spend, 0);
  const enablerSpend = enablerRows.reduce((s, r) => s + r.spend, 0);
  const totalSpend = acquisitionSpend + enablerSpend;

  const acquisitionProjectedAttendees = acquisitionRows.reduce(
    (s, r) => s + r.projectedAttendees,
    0
  );
  const totalProjectedAttendees =
    acquisitionProjectedAttendees + (settings.walk_in_allowance || 0);
  const totalExpectedAttendeesToDate = acquisitionRows.reduce(
    (s, r) => s + r.expectedAttendeesToDate,
    0
  );
  const costPerExpectedAttendeeToDate =
    totalExpectedAttendeesToDate > 0
      ? totalSpend / totalExpectedAttendeesToDate
      : null;

  const costPerProjectedAttendee =
    totalProjectedAttendees > 0 ? totalSpend / totalProjectedAttendees : null;
  const budgetUsedPct =
    settings.total_budget > 0 ? (totalSpend / settings.total_budget) * 100 : null;
  const projectedVsBasePct =
    settings.total_target_base > 0
      ? (totalProjectedAttendees / settings.total_target_base) * 100
      : null;
  const projectedVsStretchPct =
    settings.total_target_stretch > 0
      ? (totalProjectedAttendees / settings.total_target_stretch) * 100
      : null;

  // Diagnosis list and across-campaign benchmarks via shared function
  const { diagnosis, avgIdToRegPct, avgLast7CancelRatePct } =
    computeDiagnosis(campaignRows);

  return {
    campaignRows,
    summary: {
      totalIdentified,
      totalRegistrations,
      totalConfirmed,
      totalCancelled,
      totalNetConfirmed,
      totalSpend,
      acquisitionSpend,
      enablerSpend,
      acquisitionProjectedAttendees,
      totalProjectedAttendees,
      totalExpectedAttendeesToDate,
      costPerExpectedAttendeeToDate,
      costPerProjectedAttendee,
      budgetUsedPct,
      projectedVsBasePct,
      projectedVsStretchPct,
      daysRemaining,
      avgIdToRegPct,
      avgLast7CancelRatePct,
    },
    diagnosis,
  };
}

export function computeDiagnosis(campaignRows: CampaignComputed[]): {
  diagnosis: DiagnosisItem[];
  avgIdToRegPct: number | null;
  avgLast7CancelRatePct: number | null;
} {
  const acquisitionRows = campaignRows.filter((r) => !r.isEnabler);

  // Across-campaign benchmarks for Diagnosis (active acquisition campaigns with data)
  const activeWithId = acquisitionRows.filter((r) => !r.isPlanned && r.identified > 0);
  const sumId = activeWithId.reduce((s, r) => s + r.identified, 0);
  const sumRegForId = activeWithId.reduce((s, r) => s + r.registrations, 0);
  const avgIdToRegPct = sumId > 0 ? (sumRegForId / sumId) * 100 : null;

  const activeWithLast7Conf = acquisitionRows.filter(
    (r) => !r.isPlanned && r.last7Confirmed > 0
  );
  const sumLast7Conf = activeWithLast7Conf.reduce((s, r) => s + r.last7Confirmed, 0);
  const sumLast7Canc = activeWithLast7Conf.reduce((s, r) => s + r.last7Cancelled, 0);
  const avgLast7CancelRatePct =
    sumLast7Conf > 0 ? (sumLast7Canc / sumLast7Conf) * 100 : null;

  const diagnosis: DiagnosisItem[] = acquisitionRows.map((c) => {
    let status: DiagnosisStatus;
    if (c.isPlanned) {
      status = 'Planned';
    } else {
      const pct = c.projectedPctOfTarget ?? 0;
      if (pct >= 90) status = 'On track';
      else if (pct >= 60) status = 'At risk';
      else status = 'Underperforming';
    }

    const bottlenecks: string[] = [];
    let hasFunnelBottleneck = false;
    let hasCancelAvgBottleneck = false;
    let hasCancelSpikeBottleneck = false;
    let hasRegistrationsFallingBottleneck = false;

    if (!c.isPlanned) {
      if (
        avgIdToRegPct !== null &&
        avgIdToRegPct > 0 &&
        c.identifiedToRegisteredPct !== null &&
        c.identifiedToRegisteredPct < avgIdToRegPct * 0.75
      ) {
        hasFunnelBottleneck = true;
        bottlenecks.push('Identified-to-registered >25% below avg');
      }

      if (
        avgLast7CancelRatePct !== null &&
        avgLast7CancelRatePct > 0 &&
        c.last7CancelRatePct !== null &&
        c.last7CancelRatePct > avgLast7CancelRatePct * 1.25
      ) {
        hasCancelAvgBottleneck = true;
        bottlenecks.push('7d cancel rate >25% worse than avg');
      }

      if (
        c.earlierCancelRatePct !== null &&
        c.earlierCancelRatePct > 0 &&
        c.last7CancelRatePct !== null &&
        c.last7CancelRatePct > c.earlierCancelRatePct * 2
      ) {
        hasCancelSpikeBottleneck = true;
        bottlenecks.push('7d cancel rate >2x earlier rate');
      }

      if (
        c.prev7Registrations >= 15 &&
        c.regChangePct !== null &&
        c.regChangePct < -30
      ) {
        hasRegistrationsFallingBottleneck = true;
        bottlenecks.push(
          `Registrations falling (${formatNumber(c.last7Registrations)} vs ${formatNumber(c.prev7Registrations)} in prev 7d, ${c.regChangePct.toFixed(1)}%)`
        );
      }
    }

    const regDeltaAbs = c.last7Registrations - c.prev7Registrations;
    const regDeltaPct = c.regChangePct;
    const cancelRateDeltaPp =
      c.last7CancelRatePct !== null && c.prev7CancelRatePct !== null
        ? c.last7CancelRatePct - c.prev7CancelRatePct
        : null;

    return {
      computed: c,
      status,
      bottlenecks,
      hasFunnelBottleneck,
      hasCancelAvgBottleneck,
      hasCancelSpikeBottleneck,
      hasRegistrationsFallingBottleneck,
      regDeltaAbs,
      regDeltaPct,
      cancelRateDeltaPp,
    };
  });

  // Sort diagnosis ranked list: Underperforming -> At risk -> On track -> Planned,
  // and within each tier by projected % of target ascending (worst first)
  const rankWeight: Record<DiagnosisStatus, number> = {
    Underperforming: 0,
    'At risk': 1,
    'On track': 2,
    Planned: 3,
  };
  diagnosis.sort((a, b) => {
    const rw = rankWeight[a.status] - rankWeight[b.status];
    if (rw !== 0) return rw;
    return (a.computed.projectedPctOfTarget ?? 0) - (b.computed.projectedPctOfTarget ?? 0);
  });

  return {
    diagnosis,
    avgIdToRegPct,
    avgLast7CancelRatePct,
  };
}

export function formatNumber(val: number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(val);
}

export function formatInr(val: number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(val);
}

export function formatPct(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return `${val.toFixed(decimals)}%`;
}
