import { Type, type FunctionDeclaration } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeGrowthAnalytics,
  formatInr,
  formatNumber,
  formatPct,
  normalizeShowupRate,
  parseSettingsRows,
} from '../src/lib/analytics.js';
import type {
  Campaign,
  CampaignComputed,
  DailyMetric,
  GrowthSettings,
  Task,
  TaskSchemaHints,
  WindowFunnelMetrics,
} from '../src/types/growth.js';

export interface ProposedTaskPayload {
  id: string;
  title: string;
  owner: string;
  deadline: string;
  campaign: string;
  campaign_id: string | null;
  campaign_name: string | null;
  reason: string;
}

export interface ToolExecutionContext {
  supabase: SupabaseClient;
  proposals: ProposedTaskPayload[];
  toolsCalled: string[];
}

const ORIG_TABLES = [
  'orig_campaigns',
  'orig_daily_marketing',
  'orig_people',
  'orig_registrations',
  'orig_reg_history',
  'orig_checkins',
  'orig_interactions',
  'orig_targets',
] as const;

type OrigTableName = (typeof ORIG_TABLES)[number];

const SUPABASE_TIMEOUT_MS = 30_000;
const MAX_TOOL_ROWS = 50;

export class TimeoutError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
    this.statusCode = 504;
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new TimeoutError(`${label} timed out after ${ms / 1000}s`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchAllRows<T = Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  orderBy?: string,
  selectColumns = '*'
): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const all: T[] = [];

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

    try {
      let q = client
        .from(table)
        .select(selectColumns)
        .range(from, from + pageSize - 1)
        .abortSignal(controller.signal);
      if (orderBy) {
        q = q.order(orderBy, { ascending: true });
      }
      const { data, error } = await withTimeout(
        Promise.resolve(q),
        SUPABASE_TIMEOUT_MS,
        `Supabase query on ${table}`
      );
      if (error) {
        if (controller.signal.aborted) {
          throw new TimeoutError(
            `Supabase query on ${table} timed out after ${SUPABASE_TIMEOUT_MS / 1000}s`
          );
        }
        throw new Error(`Supabase query failed on ${table}: ${error.message}`);
      }
      const batch = (data ?? []) as T[];
      all.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    } catch (err) {
      if (err instanceof TimeoutError) throw err;
      if (controller.signal.aborted) {
        throw new TimeoutError(
          `Supabase query on ${table} timed out after ${SUPABASE_TIMEOUT_MS / 1000}s`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return all;
}

function normalizeCampaignRow(raw: Record<string, unknown>): Campaign {
  const kindRaw = String(raw.kind ?? 'acquisition').toLowerCase();
  return {
    id: String(raw.id),
    code: String(raw.code ?? ''),
    name: String(raw.name ?? ''),
    channel: String(raw.channel ?? ''),
    segment: String(raw.segment ?? ''),
    budget: Number(raw.budget) || 0,
    target_identified: Number(raw.target_identified) || 0,
    target_registrations: Number(raw.target_registrations) || 0,
    target_attendees: Number(raw.target_attendees) || 0,
    status: String(raw.status ?? 'planned'),
    owner: String(raw.owner ?? ''),
    planned_start: raw.planned_start ? String(raw.planned_start).slice(0, 10) : null,
    kind: kindRaw === 'enabler' ? 'enabler' : 'acquisition',
    assumed_showup: Number(raw.assumed_showup ?? 0),
    target_showup: Number(raw.target_showup ?? 0),
  };
}

function normalizeMetricRow(raw: Record<string, unknown>): DailyMetric {
  return {
    id: raw.id as string | number | undefined,
    campaign_id: String(raw.campaign_id),
    metric_date: String(raw.metric_date ?? '').slice(0, 10),
    impressions: Number(raw.impressions) || 0,
    clicks: Number(raw.clicks) || 0,
    landing_page_sessions: Number(raw.landing_page_sessions) || 0,
    registration_starts: Number(raw.registration_starts) || 0,
    identified: Number(raw.identified) || 0,
    registrations: Number(raw.registrations) || 0,
    confirmed: Number(raw.confirmed) || 0,
    cancelled: Number(raw.cancelled) || 0,
    spend: Number(raw.spend) || 0,
    expected_attendees: Number(raw.expected_attendees) || 0,
  };
}

function detectTaskHints(rows: Array<Record<string, unknown>>): TaskSchemaHints {
  if (!rows.length) {
    return { titleCol: 'title', deadlineCol: 'deadline', campaignCol: 'campaign_id' };
  }
  const sample = rows[0];
  const titleCol =
    'title' in sample
      ? 'title'
      : 'name' in sample
        ? 'name'
        : 'task' in sample
          ? 'task'
          : 'title';
  const deadlineCol =
    'deadline' in sample
      ? 'deadline'
      : 'due_date' in sample
        ? 'due_date'
        : 'deadline';
  return { titleCol, deadlineCol, campaignCol: 'campaign_id' };
}

function normalizeTaskRow(
  raw: Record<string, unknown>,
  hints: TaskSchemaHints
): Task & { created_by?: string } {
  const deadlineRaw = raw[hints.deadlineCol] ?? raw.deadline ?? raw.due_date ?? null;
  const s = String(raw.status ?? 'todo').toLowerCase().replace(/\s+/g, '_');
  const status =
    s === 'done' || s === 'completed'
      ? 'done'
      : s === 'in_progress' || s === 'doing'
        ? 'in_progress'
        : 'todo';

  return {
    id: String(raw.id),
    title: String(raw[hints.titleCol] ?? raw.title ?? raw.name ?? ''),
    status,
    owner: String(raw.owner ?? ''),
    deadline: deadlineRaw ? String(deadlineRaw).slice(0, 10) : null,
    campaign_id: raw.campaign_id ? String(raw.campaign_id) : null,
    created_by: raw.created_by ? String(raw.created_by) : undefined,
  };
}

async function loadLiveGrowthAnalytics(supabase: SupabaseClient) {
  const [settingsRows, campaignRaw, metricsRaw] = await Promise.all([
    fetchAllRows(supabase, 'settings'),
    fetchAllRows(supabase, 'campaigns', 'code'),
    fetchAllRows(supabase, 'daily_metrics', 'metric_date'),
  ]);

  const settings = parseSettingsRows(settingsRows);
  const campaigns = campaignRaw.map(normalizeCampaignRow);
  const dailyMetrics = metricsRaw.map(normalizeMetricRow);
  const analytics = computeGrowthAnalytics(campaigns, dailyMetrics, settings);

  return {
    settingsRows,
    settings,
    campaigns,
    dailyMetrics,
    ...analytics,
  };
}

function matchCampaign(
  query: string,
  campaigns: Campaign[]
): Campaign | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    campaigns.find((c) => c.code.toLowerCase() === q) ??
    campaigns.find((c) => c.name.toLowerCase() === q) ??
    campaigns.find((c) => c.name.toLowerCase().includes(q)) ??
    campaigns.find((c) => q.includes(c.name.toLowerCase()))
  );
}

function serializeWindowFunnel(w: WindowFunnelMetrics) {
  return {
    impressions: w.impressions,
    clicks: w.clicks,
    landing_page_sessions: w.landing_page_sessions,
    registration_starts: w.registration_starts,
    identified: w.identified,
    registrations: w.registrations,
    spend_inr: Math.round(w.spend),
    derived_rates: {
      clicks_per_impression_pct:
        w.clicksPerImpressionPct !== null
          ? Number(w.clicksPerImpressionPct.toFixed(2))
          : null,
      sessions_per_click_pct:
        w.sessionsPerClickPct !== null
          ? Number(w.sessionsPerClickPct.toFixed(2))
          : null,
      registration_starts_per_session_pct:
        w.regStartsPerSessionPct !== null
          ? Number(w.regStartsPerSessionPct.toFixed(2))
          : null,
      registrations_per_registration_start_pct:
        w.regsPerRegStartPct !== null
          ? Number(w.regsPerRegStartPct.toFixed(2))
          : null,
    },
  };
}

function serializeFunnelComparison7d(
  last7: WindowFunnelMetrics,
  prev7: WindowFunnelMetrics
) {
  const diffPp = (a: number | null, b: number | null) =>
    a !== null && b !== null ? Number((a - b).toFixed(2)) : null;

  return {
    last_7_days: serializeWindowFunnel(last7),
    previous_7_days: serializeWindowFunnel(prev7),
    stage_changes_last_7d_vs_prev_7d: {
      impressions_diff: last7.impressions - prev7.impressions,
      clicks_diff: last7.clicks - prev7.clicks,
      landing_page_sessions_diff:
        last7.landing_page_sessions - prev7.landing_page_sessions,
      registration_starts_diff:
        last7.registration_starts - prev7.registration_starts,
      identified_diff: last7.identified - prev7.identified,
      registrations_diff: last7.registrations - prev7.registrations,
      spend_inr_diff: Math.round(last7.spend - prev7.spend),
      clicks_per_impression_pp: diffPp(
        last7.clicksPerImpressionPct,
        prev7.clicksPerImpressionPct
      ),
      sessions_per_click_pp: diffPp(
        last7.sessionsPerClickPct,
        prev7.sessionsPerClickPct
      ),
      registration_starts_per_session_pp: diffPp(
        last7.regStartsPerSessionPct,
        prev7.regStartsPerSessionPct
      ),
      registrations_per_registration_start_pp: diffPp(
        last7.regsPerRegStartPct,
        prev7.regsPerRegStartPct
      ),
    },
  };
}

function serializeComputedCampaign(r: CampaignComputed, daysRemaining: number) {
  const c = r.campaign;
  const assumedShowupRate = normalizeShowupRate(c.assumed_showup);
  const assumedShowupPct = Number((assumedShowupRate * 100).toFixed(1));
  const projectedFutureRegistrations = r.avgDailyRegLast7 * daysRemaining;
  const projectedTotalRegistrations =
    r.registrations + projectedFutureRegistrations;

  return {
    code: c.code,
    name: c.name,
    kind: c.kind,
    channel: c.channel,
    segment: c.segment,
    owner: c.owner,
    status: c.status,
    planned_start: c.planned_start,
    is_planned_no_data: r.isPlanned,
    is_enabler: r.isEnabler,
    enabler_note: r.isEnabler ? 'Enabler, supports other campaigns' : null,
    budget_inr: Math.round(c.budget),
    spend_inr: Math.round(r.spend),
    budget_used_pct:
      r.budgetUsedPct !== null ? Number(r.budgetUsedPct.toFixed(1)) : null,
    identified: r.isEnabler ? null : r.identified,
    registrations: r.isEnabler ? null : r.registrations,
    registrations_to_date: r.isEnabler ? null : r.registrations,
    id_to_reg_pct:
      r.identifiedToRegisteredPct !== null
        ? Number(r.identifiedToRegisteredPct.toFixed(1))
        : null,
    confirmed: r.isEnabler ? null : r.confirmed,
    cancelled: r.isEnabler ? null : r.cancelled,
    net_confirmed: r.isEnabler ? null : r.netConfirmed,
    cancel_rate_pct:
      r.cancelRatePct !== null ? Number(r.cancelRatePct.toFixed(1)) : null,
    target_identified: r.isEnabler ? null : c.target_identified,
    target_registrations: r.isEnabler ? null : c.target_registrations,
    target_attendees: r.isEnabler ? null : c.target_attendees,
    days_remaining: daysRemaining,
    assumed_showup: assumedShowupRate,
    assumed_showup_pct: assumedShowupPct,
    assumed_showup_source:
      '2025 registered->attended rate (from historical orig_* data)',
    expected_attendees_to_date: r.isEnabler
      ? null
      : Number(r.expectedAttendeesToDate.toFixed(1)),
    cost_per_expected_attendee_to_date_inr:
      r.costPerExpectedAttendeeToDate !== null
        ? Math.round(r.costPerExpectedAttendeeToDate)
        : null,
    avg_daily_reg_last_7d: r.isEnabler
      ? null
      : Number(r.avgDailyRegLast7.toFixed(2)),
    avg_daily_registrations_last_7d: r.isEnabler
      ? null
      : Number(r.avgDailyRegLast7.toFixed(2)),
    projected_future_registrations: r.isEnabler
      ? null
      : Number(projectedFutureRegistrations.toFixed(1)),
    projected_total_registrations: r.isEnabler
      ? null
      : Number(projectedTotalRegistrations.toFixed(1)),
    projected_attendees: r.isEnabler ? null : Math.round(r.projectedAttendees),
    projected_attendees_exact: r.isEnabler
      ? null
      : Number(r.projectedAttendees.toFixed(1)),
    projected_pct_of_target:
      r.projectedPctOfTarget !== null
        ? Number(r.projectedPctOfTarget.toFixed(1))
        : null,
    inr_per_projected_attendee_at_full_event_projection:
      r.costPerProjectedAttendee !== null
        ? Math.round(r.costPerProjectedAttendee)
        : null,
    last_7d_registrations: r.isEnabler ? null : r.last7Registrations,
    prev_7d_registrations: r.isEnabler ? null : r.prev7Registrations,
    last_7d_cancel_rate_pct:
      r.last7CancelRatePct !== null
        ? Number(r.last7CancelRatePct.toFixed(1))
        : null,
    previous_7d_comparison: r.isEnabler
      ? null
      : {
          last_7d_registrations: r.last7Registrations,
          prev_7d_registrations: r.prev7Registrations,
          registrations_change_abs:
            r.last7Registrations - r.prev7Registrations,
          registrations_change_pct:
            r.regChangePct !== null
              ? Number(r.regChangePct.toFixed(1))
              : null,
          last_7d_cancel_rate_pct:
            r.last7CancelRatePct !== null
              ? Number(r.last7CancelRatePct.toFixed(1))
              : null,
          prev_7d_cancel_rate_pct:
            r.prev7CancelRatePct !== null
              ? Number(r.prev7CancelRatePct.toFixed(1))
              : null,
          cancel_rate_change_pp:
            r.last7CancelRatePct !== null && r.prev7CancelRatePct !== null
              ? Number(
                  (r.last7CancelRatePct - r.prev7CancelRatePct).toFixed(1)
                )
              : null,
        },
    funnel_stage_comparison_7d_vs_prev_7d: serializeFunnelComparison7d(
      r.last7Funnel,
      r.prev7Funnel
    ),
  };
}

function getMetricValueForCompare(
  r: CampaignComputed,
  metric: string
): { value: number | null; unit: string; label: string } {
  const m = metric.toLowerCase().trim().replace(/[\s-]+/g, '_');
  switch (m) {
    case 'identified':
      return { value: r.isEnabler ? null : r.identified, unit: 'count', label: 'Identified' };
    case 'registrations':
      return { value: r.isEnabler ? null : r.registrations, unit: 'count', label: 'Registrations' };
    case 'confirmed':
      return { value: r.isEnabler ? null : r.confirmed, unit: 'count', label: 'Confirmed' };
    case 'cancelled':
      return { value: r.isEnabler ? null : r.cancelled, unit: 'count', label: 'Cancelled' };
    case 'net_confirmed':
      return { value: r.isEnabler ? null : r.netConfirmed, unit: 'count', label: 'Net Confirmed' };
    case 'spend':
      return { value: Math.round(r.spend), unit: 'INR', label: 'Spend (INR)' };
    case 'budget':
      return { value: Math.round(r.campaign.budget), unit: 'INR', label: 'Budget (INR)' };
    case 'budget_used_pct':
      return {
        value: r.budgetUsedPct !== null ? Number(r.budgetUsedPct.toFixed(1)) : null,
        unit: '%',
        label: 'Budget Used %',
      };
    case 'identified_to_registered_pct':
    case 'id_to_reg_pct':
    case 'conversion':
    case 'conversion_rate':
      return {
        value:
          r.identifiedToRegisteredPct !== null
            ? Number(r.identifiedToRegisteredPct.toFixed(1))
            : null,
        unit: '%',
        label: 'Identified to Registered %',
      };
    case 'cancel_rate':
    case 'cancel_rate_pct':
      return {
        value: r.cancelRatePct !== null ? Number(r.cancelRatePct.toFixed(1)) : null,
        unit: '%',
        label: 'Cancel Rate %',
      };
    case 'projected_attendees':
      return {
        value: r.isEnabler ? null : Math.round(r.projectedAttendees),
        unit: 'attendees',
        label: 'Projected Attendees',
      };
    case 'target_attendees':
      return {
        value: r.isEnabler ? null : r.campaign.target_attendees,
        unit: 'attendees',
        label: 'Target Attendees',
      };
    case 'projected_pct_of_target':
    case 'target_attainment':
      return {
        value:
          r.projectedPctOfTarget !== null
            ? Number(r.projectedPctOfTarget.toFixed(1))
            : null,
        unit: '%',
        label: 'Projected % of Target',
      };
    case 'assumed_showup':
    case 'assumed_showup_pct':
    case 'showup_rate':
    case 'showup_rate_pct':
    case 'show_up_rate':
      return {
        value: r.isEnabler ? null : Number((r.campaign.assumed_showup * 100).toFixed(1)),
        unit: '%',
        label: 'Assumed Show-up Rate %',
      };
    case 'cost_per_expected_attendee_to_date':
    case 'cost_per_attendee_to_date':
    case 'efficiency':
    case 'cpa':
    case 'cost_per_attendee':
      return {
        value:
          r.costPerExpectedAttendeeToDate !== null
            ? Math.round(r.costPerExpectedAttendeeToDate)
            : null,
        unit: 'INR',
        label: 'Cost per Expected Attendee to Date (INR)',
      };
    case 'cost_per_projected_attendee':
    case 'inr_per_projected_attendee':
    case 'inr_per_projected_attendee_at_full_event_projection':
      return {
        value:
          r.costPerProjectedAttendee !== null
            ? Math.round(r.costPerProjectedAttendee)
            : null,
        unit: 'INR',
        label: 'INR per Projected Attendee (at full-event projection)',
      };
    case 'last7_registrations':
    case 'last_7d_registrations':
      return {
        value: r.isEnabler ? null : r.last7Registrations,
        unit: 'count',
        label: 'Last 7d Registrations',
      };
    case 'prev7_registrations':
    case 'prev_7d_registrations':
      return {
        value: r.isEnabler ? null : r.prev7Registrations,
        unit: 'count',
        label: 'Prev 7d Registrations',
      };
    case 'last7_cancel_rate_pct':
      return {
        value:
          r.last7CancelRatePct !== null
            ? Number(r.last7CancelRatePct.toFixed(1))
            : null,
        unit: '%',
        label: 'Last 7d Cancel Rate %',
      };
    default:
      return { value: null, unit: '', label: metric };
  }
}

async function fetchExternalPersonIds(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const people = await fetchAllRows<{ person_id?: string; person_type?: string }>(
    supabase,
    'orig_people',
    undefined,
    'person_id,person_type'
  );
  return new Set(
    people
      .filter((p) => String(p.person_type ?? '').toLowerCase() === 'external')
      .map((p) => String(p.person_id ?? ''))
  );
}

async function fetchValidCheckinsForExternal(
  supabase: SupabaseClient,
  externalPersonIds: Set<string>
) {
  const origCheckins = await fetchAllRows(supabase, 'orig_checkins');
  const origCheckinsExternal = origCheckins.filter((c) =>
    externalPersonIds.has(String(c.person_id ?? ''))
  );
  const validCheckins = origCheckinsExternal.filter(
    (c) =>
      String(c.result ?? '').toLowerCase() === 'admitted' &&
      String(c.verification ?? '').toLowerCase() === 'verified'
  );
  return { origCheckinsExternal, validCheckins };
}

function matchesOrigFilters(
  row: Record<string, unknown>,
  filters: Record<string, unknown> | undefined
): boolean {
  if (!filters) return true;
  for (const [rawKey, rawVal] of Object.entries(filters)) {
    if (rawVal === undefined || rawVal === null || rawVal === '') continue;
    const key = rawKey.toLowerCase();
    const valStr = String(rawVal).trim().toLowerCase();

    if (key === 'campaign' || key === 'campaign_name' || key === 'campaign_id') {
      const cName = String(row.campaign_name ?? row.first_campaign_name ?? '').toLowerCase();
      const cId = String(row.campaign_id ?? row.first_campaign_id ?? '').toLowerCase();
      if (cId !== valStr && !cName.includes(valStr)) return false;
      continue;
    }
    if (key === 'from_date') {
      const dateField = String(
        row.activity_date ??
          row.occurred_at ??
          row.registered_at ??
          row.first_seen_at ??
          row.effective_at ??
          ''
      ).slice(0, 10);
      if (dateField && dateField < String(rawVal).slice(0, 10)) return false;
      continue;
    }
    if (key === 'to_date') {
      const dateField = String(
        row.activity_date ??
          row.occurred_at ??
          row.registered_at ??
          row.first_seen_at ??
          row.effective_at ??
          ''
      ).slice(0, 10);
      if (dateField && dateField > String(rawVal).slice(0, 10)) return false;
      continue;
    }
    if (key === 'status') {
      const s = String(row.latest_status ?? row.status ?? '').toLowerCase();
      if (s !== valStr) return false;
      continue;
    }

    const rowVal = row[rawKey];
    if (rowVal === undefined) continue;
    if (String(rowVal).toLowerCase() !== valStr) return false;
  }
  return true;
}

function countResultRows(result: Record<string, unknown>): number {
  const candidateKeys = [
    'rows',
    'campaigns',
    'tasks',
    'ranked_acquisition_campaigns',
    'by_campaign',
    'by_first_campaign',
    'by_campaign_unique_attendees',
    'comparisons',
    'raw_rows',
    'sample_rows',
  ];
  for (const key of candidateKeys) {
    const val = result[key];
    if (Array.isArray(val)) return val.length;
  }
  return typeof result.row_count === 'number'
    ? result.row_count
    : typeof result.total_matching_tasks === 'number'
      ? result.total_matching_tasks
      : 1;
}

export async function executeGrowthTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  ctx.toolsCalled.push(name);

  let result: Record<string, unknown>;
  try {
    result = await runToolBody(name, args, ctx);
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    console.log('[GrowthTool]', {
      name,
      arguments: args,
      rowCount: 0,
      elapsedMs,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('[GrowthTool]', {
    name,
    arguments: args,
    rowCount: countResultRows(result),
    elapsedMs,
  });
  return result;
}

async function runToolBody(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<Record<string, unknown>> {
  const { supabase } = ctx;

  switch (name) {
    case 'get_settings': {
      const rows = await fetchAllRows(supabase, 'settings');
      const parsed = parseSettingsRows(rows);
      return {
        settings: parsed,
        raw_rows: rows.slice(0, MAX_TOOL_ROWS),
      };
    }

    case 'get_overall_funnel': {
      const { settings, summary, campaignRows } =
        await loadLiveGrowthAnalytics(supabase);
      const idToRegPct =
        summary.totalIdentified > 0
          ? Number(((summary.totalRegistrations / summary.totalIdentified) * 100).toFixed(1))
          : null;
      const cancelRatePct =
        summary.totalConfirmed > 0
          ? Number(((summary.totalCancelled / summary.totalConfirmed) * 100).toFixed(1))
          : null;
      const acquisitionProjections = campaignRows
        .filter((r) => !r.isEnabler)
        .slice(0, MAX_TOOL_ROWS)
        .map((r) => ({
          code: r.campaign.code,
          name: r.campaign.name,
          projected_attendees: Math.round(r.projectedAttendees),
          projected_attendees_exact: Number(r.projectedAttendees.toFixed(1)),
          target_attendees: r.campaign.target_attendees,
        }));

      return {
        as_of_date: settings.as_of_date,
        event_date: settings.event_date,
        days_remaining: summary.daysRemaining,
        total_identified: summary.totalIdentified,
        total_registrations: summary.totalRegistrations,
        identified_to_registered_pct: idToRegPct,
        total_confirmed: summary.totalConfirmed,
        total_cancelled: summary.totalCancelled,
        total_net_confirmed: summary.totalNetConfirmed,
        overall_cancel_rate_pct: cancelRatePct,
        total_spend_inr: Math.round(summary.totalSpend),
        acquisition_spend_inr: Math.round(summary.acquisitionSpend),
        enabler_spend_inr: Math.round(summary.enablerSpend),
        total_budget_inr: Math.round(settings.total_budget),
        budget_used_pct:
          summary.budgetUsedPct !== null
            ? Number(summary.budgetUsedPct.toFixed(1))
            : null,
        acquisition_projected_attendees: Math.round(
          summary.acquisitionProjectedAttendees
        ),
        walk_in_allowance: settings.walk_in_allowance,
        total_projected_attendees: Math.round(summary.totalProjectedAttendees),
        total_target_base: settings.total_target_base,
        progress_vs_base_pct:
          summary.projectedVsBasePct !== null
            ? Number(summary.projectedVsBasePct.toFixed(1))
            : null,
        total_target_stretch: settings.total_target_stretch,
        progress_vs_stretch_pct:
          summary.projectedVsStretchPct !== null
            ? Number(summary.projectedVsStretchPct.toFixed(1))
            : null,
        cost_per_expected_attendee_to_date_inr:
          summary.costPerExpectedAttendeeToDate !== null
            ? Math.round(summary.costPerExpectedAttendeeToDate)
            : null,
        inr_per_projected_attendee_at_full_event_projection:
          summary.costPerProjectedAttendee !== null
            ? Math.round(summary.costPerProjectedAttendee)
            : null,
        venue_capacity_per_day: settings.venue_capacity_per_day,
        projection_components: {
          formula:
            'total_projected = sum_of_acquisition_campaign_projections + walk_in_allowance',
          sum_acquisition_campaign_projections: Math.round(
            summary.acquisitionProjectedAttendees
          ),
          sum_acquisition_campaign_projections_exact: Number(
            summary.acquisitionProjectedAttendees.toFixed(1)
          ),
          walk_in_allowance: settings.walk_in_allowance,
          total_projected: Math.round(summary.totalProjectedAttendees),
          total_projected_exact: Number(
            summary.totalProjectedAttendees.toFixed(1)
          ),
          by_acquisition_campaign: acquisitionProjections,
        },
        net_confirmed_reported_separately: {
          net_confirmed: summary.totalNetConfirmed,
          confirmed: summary.totalConfirmed,
          cancelled: summary.totalCancelled,
          included_in_projection: false,
          note: 'Net confirmed is reported separately and is NOT part of the projection.',
        },
        targets: {
          total_target_base: settings.total_target_base,
          total_target_stretch: settings.total_target_stretch,
          progress_vs_base_pct:
            summary.projectedVsBasePct !== null
              ? Number(summary.projectedVsBasePct.toFixed(1))
              : null,
          progress_vs_stretch_pct:
            summary.projectedVsStretchPct !== null
              ? Number(summary.projectedVsStretchPct.toFixed(1))
              : null,
          gap_vs_base:
            Math.round(summary.totalProjectedAttendees) -
            settings.total_target_base,
          gap_vs_stretch:
            Math.round(summary.totalProjectedAttendees) -
            settings.total_target_stretch,
        },
      };
    }

    case 'get_campaign_metrics': {
      const campaignQuery = String(args.campaign_name ?? 'all').trim();
      const fromDate = args.from_date ? String(args.from_date).slice(0, 10) : null;
      const toDate = args.to_date ? String(args.to_date).slice(0, 10) : null;

      const { settings, summary, campaigns, dailyMetrics, campaignRows } =
        await loadLiveGrowthAnalytics(supabase);

      let selectedRows = campaignRows;
      if (campaignQuery.toLowerCase() !== 'all') {
        const matched = matchCampaign(campaignQuery, campaigns);
        if (!matched) {
          return {
            error: `Campaign "${campaignQuery}" not found.`,
            available_campaigns: campaigns
              .slice(0, MAX_TOOL_ROWS)
              .map((c) => `${c.code}: ${c.name}`),
          };
        }
        selectedRows = campaignRows.filter((r) => r.campaign.id === matched.id);
      }

      if (!fromDate && !toDate) {
        return {
          as_of_date: settings.as_of_date,
          days_remaining: summary.daysRemaining,
          projection_formula:
            '(registrations_to_date + avg_daily_registrations_last_7d * days_remaining) * assumed_showup',
          campaigns: selectedRows
            .slice(0, MAX_TOOL_ROWS)
            .map((r) => serializeComputedCampaign(r, summary.daysRemaining)),
        };
      }

      // Compute exact window metrics for [fromDate, toDate] (clamped to <= as_of_date)
      const effectiveTo =
        toDate && settings.as_of_date
          ? toDate < settings.as_of_date
            ? toDate
            : settings.as_of_date
          : toDate || settings.as_of_date;

      const windowed = selectedRows.slice(0, MAX_TOOL_ROWS).map((r) => {
        const c = r.campaign;
        const rows = dailyMetrics.filter((m) => {
          if (m.campaign_id !== c.id) return false;
          if (fromDate && m.metric_date < fromDate) return false;
          if (effectiveTo && m.metric_date > effectiveTo) return false;
          return true;
        });

        const identified = rows.reduce((s, m) => s + m.identified, 0);
        const registrations = rows.reduce((s, m) => s + m.registrations, 0);
        const confirmed = rows.reduce((s, m) => s + m.confirmed, 0);
        const cancelled = rows.reduce((s, m) => s + m.cancelled, 0);
        const spend = rows.reduce((s, m) => s + m.spend, 0);
        const impressions = rows.reduce((s, m) => s + m.impressions, 0);
        const clicks = rows.reduce((s, m) => s + m.clicks, 0);
        const landing_page_sessions = rows.reduce(
          (s, m) => s + m.landing_page_sessions,
          0
        );
        const registration_starts = rows.reduce(
          (s, m) => s + m.registration_starts,
          0
        );
        const assumedShowupRate = normalizeShowupRate(c.assumed_showup);

        return {
          code: c.code,
          name: c.name,
          kind: c.kind,
          from_date: fromDate ?? 'start',
          to_date: effectiveTo,
          days_with_data: rows.length,
          impressions,
          clicks,
          landing_page_sessions,
          registration_starts,
          identified: r.isEnabler ? null : identified,
          registrations: r.isEnabler ? null : registrations,
          confirmed: r.isEnabler ? null : confirmed,
          cancelled: r.isEnabler ? null : cancelled,
          net_confirmed: r.isEnabler ? null : confirmed - cancelled,
          id_to_reg_pct:
            !r.isEnabler && identified > 0
              ? Number(((registrations / identified) * 100).toFixed(1))
              : null,
          cancel_rate_pct:
            !r.isEnabler && confirmed > 0
              ? Number(((cancelled / confirmed) * 100).toFixed(1))
              : null,
          spend_inr: Math.round(spend),
          // Overall projection inputs (always anchored to as_of_date)
          registrations_to_date: r.isEnabler ? null : r.registrations,
          avg_daily_registrations_last_7d: r.isEnabler
            ? null
            : Number(r.avgDailyRegLast7.toFixed(2)),
          days_remaining: summary.daysRemaining,
          assumed_showup: assumedShowupRate,
          assumed_showup_pct: Number((assumedShowupRate * 100).toFixed(1)),
          assumed_showup_source:
            '2025 registered->attended rate (from historical orig_* data)',
          expected_attendees_to_date: r.isEnabler
            ? null
            : Number(r.expectedAttendeesToDate.toFixed(1)),
          cost_per_expected_attendee_to_date_inr:
            r.costPerExpectedAttendeeToDate !== null
              ? Math.round(r.costPerExpectedAttendeeToDate)
              : null,
          overall_projected_attendees: r.isEnabler
            ? null
            : Math.round(r.projectedAttendees),
          inr_per_projected_attendee_at_full_event_projection:
            r.costPerProjectedAttendee !== null
              ? Math.round(r.costPerProjectedAttendee)
              : null,
          target_attendees: r.isEnabler ? null : c.target_attendees,
          previous_7d_comparison: r.isEnabler
            ? null
            : {
                last_7d_registrations: r.last7Registrations,
                prev_7d_registrations: r.prev7Registrations,
                registrations_change_abs:
                  r.last7Registrations - r.prev7Registrations,
                registrations_change_pct:
                  r.regChangePct !== null
                    ? Number(r.regChangePct.toFixed(1))
                    : null,
                last_7d_cancel_rate_pct:
                  r.last7CancelRatePct !== null
                    ? Number(r.last7CancelRatePct.toFixed(1))
                    : null,
                prev_7d_cancel_rate_pct:
                  r.prev7CancelRatePct !== null
                    ? Number(r.prev7CancelRatePct.toFixed(1))
                    : null,
              },
          funnel_stage_comparison_7d_vs_prev_7d: serializeFunnelComparison7d(
            r.last7Funnel,
            r.prev7Funnel
          ),
        };
      });

      return {
        as_of_date: settings.as_of_date,
        days_remaining: summary.daysRemaining,
        window: { from_date: fromDate, to_date: effectiveTo },
        campaigns: windowed,
      };
    }

    case 'compare_campaigns': {
      const nameA = String(args.campaign_a ?? '');
      const nameB = String(args.campaign_b ?? '');
      const metric = String(args.metric ?? 'cost_per_expected_attendee_to_date');

      const { settings, campaigns, campaignRows } =
        await loadLiveGrowthAnalytics(supabase);

      const campA = matchCampaign(nameA, campaigns);
      const campB = matchCampaign(nameB, campaigns);
      if (!campA || !campB) {
        return {
          error: `Could not match both campaigns (${!campA ? nameA : ''} ${!campB ? nameB : ''}).`,
          available_campaigns: campaigns
            .slice(0, MAX_TOOL_ROWS)
            .map((c) => `${c.code}: ${c.name}`),
        };
      }

      const rowA = campaignRows.find((r) => r.campaign.id === campA.id)!;
      const rowB = campaignRows.find((r) => r.campaign.id === campB.id)!;

      if (metric.toLowerCase() === 'all' || metric.toLowerCase() === 'summary') {
        const metricsToCompare = [
          'identified',
          'registrations',
          'id_to_reg_pct',
          'net_confirmed',
          'cancel_rate_pct',
          'assumed_showup_pct',
          'spend',
          'cost_per_expected_attendee_to_date',
          'projected_attendees',
          'target_attendees',
          'projected_pct_of_target',
        ];
        const comparisons = metricsToCompare.map((mKey) => {
          const a = getMetricValueForCompare(rowA, mKey);
          const b = getMetricValueForCompare(rowB, mKey);
          const diff =
            a.value !== null && b.value !== null
              ? Number((a.value - b.value).toFixed(2))
              : null;
          return {
            metric: a.label,
            unit: a.unit,
            [campA.name]: a.value,
            [campB.name]: b.value,
            difference_a_minus_b: diff,
          };
        });
        return {
          as_of_date: settings.as_of_date,
          campaign_a: `${campA.code} ${campA.name}`,
          campaign_b: `${campB.code} ${campB.name}`,
          comparisons,
        };
      }

      const valA = getMetricValueForCompare(rowA, metric);
      const valB = getMetricValueForCompare(rowB, metric);
      const diff =
        valA.value !== null && valB.value !== null
          ? Number((valA.value - valB.value).toFixed(2))
          : null;
      const pctDiff =
        valA.value !== null && valB.value !== null && valB.value !== 0
          ? Number((((valA.value - valB.value) / valB.value) * 100).toFixed(1))
          : null;

      return {
        as_of_date: settings.as_of_date,
        metric: valA.label,
        unit: valA.unit,
        campaign_a: {
          code: campA.code,
          name: campA.name,
          kind: campA.kind,
          value: valA.value,
        },
        campaign_b: {
          code: campB.code,
          name: campB.name,
          kind: campB.kind,
          value: valB.value,
        },
        difference_a_minus_b: diff,
        pct_difference_vs_b: pctDiff,
      };
    }

    case 'get_diagnosis': {
      const { settings, summary, diagnosis, campaignRows } =
        await loadLiveGrowthAnalytics(supabase);

      return {
        as_of_date: settings.as_of_date,
        days_remaining: summary.daysRemaining,
        projection_formula:
          '(registrations_to_date + avg_daily_registrations_last_7d * days_remaining) * assumed_showup',
        benchmarks: {
          avg_id_to_reg_pct:
            summary.avgIdToRegPct !== null
              ? Number(summary.avgIdToRegPct.toFixed(1))
              : null,
          id_to_reg_flag_threshold_pct:
            summary.avgIdToRegPct !== null
              ? Number((summary.avgIdToRegPct * 0.75).toFixed(1))
              : null,
          avg_last_7d_cancel_rate_pct:
            summary.avgLast7CancelRatePct !== null
              ? Number(summary.avgLast7CancelRatePct.toFixed(1))
              : null,
          cancel_rate_flag_threshold_pct:
            summary.avgLast7CancelRatePct !== null
              ? Number((summary.avgLast7CancelRatePct * 1.25).toFixed(1))
              : null,
        },
        ranked_acquisition_campaigns: diagnosis
          .slice(0, MAX_TOOL_ROWS)
          .map((d, idx) => {
            const c = d.computed;
            const assumedShowupRate = normalizeShowupRate(
              c.campaign.assumed_showup
            );
            const assumedShowupPct = Number((assumedShowupRate * 100).toFixed(1));
            const projectedFutureRegistrations =
              c.avgDailyRegLast7 * summary.daysRemaining;
            const projectedTotalRegistrations =
              c.registrations + projectedFutureRegistrations;

            return {
              rank: idx + 1,
              code: c.campaign.code,
              name: c.campaign.name,
              owner: c.campaign.owner,
              status: d.status,
              is_planned_no_data: c.isPlanned,
              bottlenecks: d.bottlenecks,
              flags: {
                id_to_reg_below_25pct_avg: d.hasFunnelBottleneck,
                cancel_rate_7d_above_25pct_avg: d.hasCancelAvgBottleneck,
                cancel_rate_7d_gt_2x_earlier: d.hasCancelSpikeBottleneck,
                registrations_falling_gt_30pct:
                  d.hasRegistrationsFallingBottleneck,
              },
              registrations_to_date: c.registrations,
              avg_daily_registrations_last_7d: Number(
                c.avgDailyRegLast7.toFixed(2)
              ),
              days_remaining: summary.daysRemaining,
              assumed_showup: assumedShowupRate,
              assumed_showup_pct: assumedShowupPct,
              assumed_showup_source:
                '2025 registered->attended rate (from historical orig_* data)',
              projected_future_registrations: Number(
                projectedFutureRegistrations.toFixed(1)
              ),
              projected_total_registrations: Number(
                projectedTotalRegistrations.toFixed(1)
              ),
              projected_attendees: Math.round(c.projectedAttendees),
              projected_attendees_exact: Number(c.projectedAttendees.toFixed(1)),
              expected_attendees_to_date: Number(
                c.expectedAttendeesToDate.toFixed(1)
              ),
              cost_per_expected_attendee_to_date_inr:
                c.costPerExpectedAttendeeToDate !== null
                  ? Math.round(c.costPerExpectedAttendeeToDate)
                  : null,
              inr_per_projected_attendee_at_full_event_projection:
                c.costPerProjectedAttendee !== null
                  ? Math.round(c.costPerProjectedAttendee)
                  : null,
              target_attendees: c.campaign.target_attendees,
              projected_pct_of_target:
                c.projectedPctOfTarget !== null
                  ? Number(c.projectedPctOfTarget.toFixed(1))
                  : null,
              id_to_reg_pct:
                c.identifiedToRegisteredPct !== null
                  ? Number(c.identifiedToRegisteredPct.toFixed(1))
                  : null,
              cancel_rate_pct:
                c.cancelRatePct !== null
                  ? Number(c.cancelRatePct.toFixed(1))
                  : null,
              last_7d_cancel_rate_pct:
                c.last7CancelRatePct !== null
                  ? Number(c.last7CancelRatePct.toFixed(1))
                  : null,
              prev_7d_cancel_rate_pct:
                c.prev7CancelRatePct !== null
                  ? Number(c.prev7CancelRatePct.toFixed(1))
                  : null,
              earlier_cancel_rate_pct:
                c.earlierCancelRatePct !== null
                  ? Number(c.earlierCancelRatePct.toFixed(1))
                  : null,
              last_7d_registrations: c.last7Registrations,
              prev_7d_registrations: c.prev7Registrations,
              reg_delta_abs: d.regDeltaAbs,
              reg_delta_pct:
                d.regDeltaPct !== null ? Number(d.regDeltaPct.toFixed(1)) : null,
              cancel_rate_delta_pp:
                d.cancelRateDeltaPp !== null
                  ? Number(d.cancelRateDeltaPp.toFixed(1))
                  : null,
              previous_7d_comparison: {
                last_7d_registrations: c.last7Registrations,
                prev_7d_registrations: c.prev7Registrations,
                registrations_change_abs: d.regDeltaAbs,
                registrations_change_pct:
                  d.regDeltaPct !== null
                    ? Number(d.regDeltaPct.toFixed(1))
                    : null,
                last_7d_cancel_rate_pct:
                  c.last7CancelRatePct !== null
                    ? Number(c.last7CancelRatePct.toFixed(1))
                    : null,
                prev_7d_cancel_rate_pct:
                  c.prev7CancelRatePct !== null
                    ? Number(c.prev7CancelRatePct.toFixed(1))
                    : null,
                cancel_rate_change_pp:
                  d.cancelRateDeltaPp !== null
                    ? Number(d.cancelRateDeltaPp.toFixed(1))
                    : null,
              },
              funnel_stage_comparison_7d_vs_prev_7d:
                serializeFunnelComparison7d(c.last7Funnel, c.prev7Funnel),
            };
          }),
        excluded_enablers: campaignRows
          .filter((r) => r.isEnabler)
          .slice(0, MAX_TOOL_ROWS)
          .map((r) => ({
            code: r.campaign.code,
            name: r.campaign.name,
            note: 'Enabler, supports other campaigns',
          })),
      };
    }

    case 'get_budget_status': {
      const { settings, summary, campaignRows } =
        await loadLiveGrowthAnalytics(supabase);

      return {
        as_of_date: settings.as_of_date,
        overall: {
          total_budget_inr: Math.round(settings.total_budget),
          total_spend_inr: Math.round(summary.totalSpend),
          remaining_inr: Math.round(settings.total_budget - summary.totalSpend),
          budget_used_pct:
            summary.budgetUsedPct !== null
              ? Number(summary.budgetUsedPct.toFixed(1))
              : null,
          cost_per_expected_attendee_to_date_inr:
            summary.costPerExpectedAttendeeToDate !== null
              ? Math.round(summary.costPerExpectedAttendeeToDate)
              : null,
          inr_per_projected_attendee_at_full_event_projection:
            summary.costPerProjectedAttendee !== null
              ? Math.round(summary.costPerProjectedAttendee)
              : null,
        },
        campaigns: campaignRows.slice(0, MAX_TOOL_ROWS).map((r) => ({
          code: r.campaign.code,
          name: r.campaign.name,
          kind: r.campaign.kind,
          budget_inr: Math.round(r.campaign.budget),
          spend_inr: Math.round(r.spend),
          remaining_inr: Math.round(r.campaign.budget - r.spend),
          budget_used_pct:
            r.budgetUsedPct !== null ? Number(r.budgetUsedPct.toFixed(1)) : null,
          expected_attendees_to_date: r.isEnabler
            ? null
            : Number(r.expectedAttendeesToDate.toFixed(1)),
          cost_per_expected_attendee_to_date_inr:
            r.costPerExpectedAttendeeToDate !== null
              ? Math.round(r.costPerExpectedAttendeeToDate)
              : null,
          projected_attendees: r.isEnabler
            ? null
            : Math.round(r.projectedAttendees),
          inr_per_projected_attendee_at_full_event_projection:
            r.costPerProjectedAttendee !== null
              ? Math.round(r.costPerProjectedAttendee)
              : null,
        })),
      };
    }

    case 'list_tasks': {
      const statusFilter = args.status ? String(args.status).toLowerCase() : null;
      const campaignFilter = args.campaign ? String(args.campaign).trim() : null;
      const overdueOnly = Boolean(args.overdue_only);

      const [settingsRows, campaignRaw, tasksRaw] = await Promise.all([
        fetchAllRows(supabase, 'settings'),
        fetchAllRows(supabase, 'campaigns'),
        fetchAllRows(supabase, 'tasks'),
      ]);

      const settings = parseSettingsRows(settingsRows);
      const campaigns = campaignRaw.map(normalizeCampaignRow);
      const campById = new Map(campaigns.map((c) => [c.id, c]));
      const hints = detectTaskHints(tasksRaw);
      const tasks = tasksRaw.map((t) => normalizeTaskRow(t, hints));

      let matchedCampaignId: string | null = null;
      if (campaignFilter) {
        const matched = matchCampaign(campaignFilter, campaigns);
        if (!matched) {
          return {
            error: `Campaign "${campaignFilter}" not found.`,
            available_campaigns: campaigns
              .slice(0, MAX_TOOL_ROWS)
              .map((c) => `${c.code}: ${c.name}`),
          };
        }
        matchedCampaignId = matched.id;
      }

      const enriched = tasks
        .map((t) => {
          const camp = t.campaign_id ? campById.get(t.campaign_id) : undefined;
          const isOverdue = Boolean(
            t.deadline && settings.as_of_date && t.deadline < settings.as_of_date && t.status !== 'done'
          );
          return {
            id: t.id,
            title: t.title,
            status: t.status,
            owner: t.owner,
            deadline: t.deadline,
            campaign_code: camp?.code ?? null,
            campaign_name: camp?.name ?? null,
            campaign_id: t.campaign_id,
            is_overdue: isOverdue,
            created_by: t.created_by ?? null,
          };
        })
        .filter((t) => {
          if (statusFilter && t.status !== statusFilter) return false;
          if (matchedCampaignId && t.campaign_id !== matchedCampaignId) return false;
          if (overdueOnly && !t.is_overdue) return false;
          return true;
        });

      return {
        as_of_date: settings.as_of_date,
        total_matching_tasks: enriched.length,
        truncated_to_50: enriched.length > MAX_TOOL_ROWS,
        tasks: enriched.slice(0, MAX_TOOL_ROWS),
      };
    }

    case 'query_original_data': {
      const table = String(args.table ?? '').trim() as OrigTableName;
      if (!ORIG_TABLES.includes(table)) {
        return {
          error: `Table "${table}" is not allowed. Allowed 2025 tables: ${ORIG_TABLES.join(', ')}`,
        };
      }
      const filters =
        args.filters && typeof args.filters === 'object'
          ? (args.filters as Record<string, unknown>)
          : undefined;
      const aggregate = String(args.aggregate ?? 'summary').toLowerCase();

      if (table === 'orig_campaigns') {
        const all = await fetchAllRows(supabase, 'orig_campaigns');
        const rows = all.filter((r) => matchesOrigFilters(r, filters));
        return {
          table,
          total_count: rows.length,
          rows: rows.slice(0, MAX_TOOL_ROWS),
        };
      }

      if (table === 'orig_targets') {
        const allTargets = await fetchAllRows(supabase, 'orig_targets');
        const rows = allTargets.filter((r) => matchesOrigFilters(r, filters));
        return {
          table,
          total_count: rows.length,
          rows: rows.slice(0, MAX_TOOL_ROWS).map((r) => ({
            ...r,
            marketing_budget_inr: Math.round(Number(r.marketing_budget_inr) || 0),
          })),
        };
      }

      if (table === 'orig_daily_marketing') {
        const all = await fetchAllRows(supabase, 'orig_daily_marketing');
        const rows = all.filter((r) => matchesOrigFilters(r, filters));
        const totalSpend = Math.round(
          rows.reduce((s, r) => s + (Number(r.marketing_spend_inr) || 0), 0)
        );
        const totalImpressions = rows.reduce(
          (s, r) => s + (Number(r.impressions) || 0),
          0
        );
        const totalClicks = rows.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
        const totalReach = rows.reduce(
          (s, r) => s + (Number(r.reported_reach) || 0),
          0
        );
        const totalSessions = rows.reduce(
          (s, r) => s + (Number(r.landing_page_sessions) || 0),
          0
        );
        const totalRegStarts = rows.reduce(
          (s, r) => s + (Number(r.registration_starts) || 0),
          0
        );

        const byCamp = new Map<
          string,
          {
            campaign_id: string;
            campaign_name: string;
            days: number;
            spend_inr: number;
            impressions: number;
            clicks: number;
            reported_reach: number;
            landing_page_sessions: number;
            registration_starts: number;
          }
        >();

        for (const r of rows) {
          const cid = String(r.campaign_id ?? '');
          const cur = byCamp.get(cid) ?? {
            campaign_id: cid,
            campaign_name: String(r.campaign_name ?? ''),
            days: 0,
            spend_inr: 0,
            impressions: 0,
            clicks: 0,
            reported_reach: 0,
            landing_page_sessions: 0,
            registration_starts: 0,
          };
          cur.days += 1;
          cur.spend_inr += Number(r.marketing_spend_inr) || 0;
          cur.impressions += Number(r.impressions) || 0;
          cur.clicks += Number(r.clicks) || 0;
          cur.reported_reach += Number(r.reported_reach) || 0;
          cur.landing_page_sessions += Number(r.landing_page_sessions) || 0;
          cur.registration_starts += Number(r.registration_starts) || 0;
          byCamp.set(cid, cur);
        }

        const byCampaign = [...byCamp.values()]
          .slice(0, MAX_TOOL_ROWS)
          .map((c) => ({
            ...c,
            spend_inr: Math.round(c.spend_inr),
          }));

        return {
          table,
          note: 'Impressions, reach, clicks and sessions are anonymous counts, not people. Spend is in whole INR.',
          row_count: rows.length,
          totals: {
            spend_inr: totalSpend,
            impressions: totalImpressions,
            clicks: totalClicks,
            reported_reach: totalReach,
            landing_page_sessions: totalSessions,
            registration_starts: totalRegStarts,
          },
          by_campaign: byCampaign,
          sample_rows:
            aggregate === 'list' ? rows.slice(0, MAX_TOOL_ROWS) : undefined,
        };
      }

      if (table === 'orig_people') {
        const origPeople = await fetchAllRows(supabase, 'orig_people');
        const rows = origPeople
          .filter((p) => String(p.person_type ?? '').toLowerCase() === 'external')
          .filter((r) => matchesOrigFilters(r, filters));
        const byCamp = new Map<string, Set<string>>();
        for (const r of rows) {
          const key = `${r.first_campaign_id ?? ''}::${r.first_campaign_name ?? ''}`;
          const set = byCamp.get(key) ?? new Set<string>();
          set.add(String(r.person_id));
          byCamp.set(key, set);
        }
        return {
          table,
          rule_applied: 'person_type = external only',
          unique_external_people: new Set(rows.map((r) => String(r.person_id))).size,
          by_first_campaign: [...byCamp.entries()]
            .slice(0, MAX_TOOL_ROWS)
            .map(([k, set]) => {
              const [campaign_id, campaign_name] = k.split('::');
              return { campaign_id, campaign_name, unique_people: set.size };
            }),
          sample_rows:
            aggregate === 'list' ? rows.slice(0, MAX_TOOL_ROWS) : undefined,
        };
      }

      if (table === 'orig_registrations' || table === 'orig_reg_history') {
        const [externalPersonIds, origRegistrations, origRegHistory] =
          await Promise.all([
            fetchExternalPersonIds(supabase),
            fetchAllRows(supabase, 'orig_registrations'),
            fetchAllRows(supabase, 'orig_reg_history'),
          ]);

        const historySorted = origRegHistory
          .filter((h) => externalPersonIds.has(String(h.person_id ?? '')))
          .sort((a, b) => {
            const tA = String(a.effective_at ?? '');
            const tB = String(b.effective_at ?? '');
            if (tA !== tB) return tA.localeCompare(tB);
            return String(a.history_id ?? '').localeCompare(
              String(b.history_id ?? '')
            );
          });

        const latestRegStatusByRegId = new Map<
          string,
          { status: string; effective_at: string }
        >();
        for (const h of historySorted) {
          const regId = String(h.registration_id ?? '');
          if (!regId) continue;
          latestRegStatusByRegId.set(regId, {
            status: String(h.status ?? ''),
            effective_at: String(h.effective_at ?? ''),
          });
        }

        const externalRegistrations: Array<Record<string, unknown>> = origRegistrations
          .filter((r) => externalPersonIds.has(String(r.person_id ?? '')))
          .map((r): Record<string, unknown> => {
            const latest = latestRegStatusByRegId.get(
              String(r.registration_id ?? '')
            );
            return {
              ...r,
              latest_status: latest?.status ?? 'unknown',
              latest_status_at: latest?.effective_at ?? null,
            };
          });

        const rows = externalRegistrations.filter((r) =>
          matchesOrigFilters(r, filters)
        );

        const byLatestStatus: Record<string, number> = {};
        const byCamp = new Map<
          string,
          {
            campaign_id: string;
            campaign_name: string;
            total_registrations: number;
            unique_people: Set<string>;
            statuses: Record<string, number>;
          }
        >();

        for (const r of rows) {
          const st = String(r.latest_status ?? 'unknown');
          byLatestStatus[st] = (byLatestStatus[st] ?? 0) + 1;

          const cid = String(r.campaign_id ?? '');
          const cur = byCamp.get(cid) ?? {
            campaign_id: cid,
            campaign_name: String(r.campaign_name ?? ''),
            total_registrations: 0,
            unique_people: new Set<string>(),
            statuses: {},
          };
          cur.total_registrations += 1;
          cur.unique_people.add(String(r.person_id));
          cur.statuses[st] = (cur.statuses[st] ?? 0) + 1;
          byCamp.set(cid, cur);
        }

        return {
          table,
          rules_applied:
            'External people only (person_type=external); using each registration latest status from orig_reg_history.',
          total_registrations: rows.length,
          unique_external_people_registered: new Set(
            rows.map((r) => String(r.person_id))
          ).size,
          by_latest_status: byLatestStatus,
          by_campaign: [...byCamp.values()]
            .slice(0, MAX_TOOL_ROWS)
            .map((c) => ({
              campaign_id: c.campaign_id,
              campaign_name: c.campaign_name,
              total_registrations: c.total_registrations,
              unique_people: c.unique_people.size,
              by_latest_status: c.statuses,
            })),
          sample_rows:
            aggregate === 'list' ? rows.slice(0, MAX_TOOL_ROWS) : undefined,
        };
      }

      if (table === 'orig_checkins') {
        const externalPersonIds = await fetchExternalPersonIds(supabase);
        const { origCheckinsExternal, validCheckins } =
          await fetchValidCheckinsForExternal(supabase, externalPersonIds);

        const filteredValid = validCheckins.filter((r) =>
          matchesOrigFilters(r, filters)
        );
        const filteredAllExternal = origCheckinsExternal.filter((r) =>
          matchesOrigFilters(r, filters)
        );

        const uniqueAttendees = new Set(
          filteredValid.map((r) => String(r.person_id))
        ).size;

        const byCamp = new Map<
          string,
          { campaign_id: string; campaign_name: string; people: Set<string> }
        >();
        for (const r of filteredValid) {
          const cid = String(r.campaign_id ?? '');
          const cur = byCamp.get(cid) ?? {
            campaign_id: cid,
            campaign_name: String(r.campaign_name ?? ''),
            people: new Set<string>(),
          };
          cur.people.add(String(r.person_id));
          byCamp.set(cid, cur);
        }

        return {
          table,
          rules_applied:
            'External people only (person_type=external); attendance = result "admitted" AND verification "verified", counted once per person.',
          unique_verified_admitted_attendees: uniqueAttendees,
          valid_admitted_verified_checkin_events: filteredValid.length,
          total_external_checkin_events: filteredAllExternal.length,
          by_campaign_unique_attendees: [...byCamp.values()]
            .slice(0, MAX_TOOL_ROWS)
            .map((c) => ({
              campaign_id: c.campaign_id,
              campaign_name: c.campaign_name,
              unique_attendees: c.people.size,
            })),
          sample_rows:
            aggregate === 'list' ? filteredValid.slice(0, MAX_TOOL_ROWS) : undefined,
        };
      }

      if (table === 'orig_interactions') {
        const [externalPersonIds, allInteractions] = await Promise.all([
          fetchExternalPersonIds(supabase),
          fetchAllRows(supabase, 'orig_interactions'),
        ]);
        const rows = allInteractions.filter(
          (r) =>
            externalPersonIds.has(String(r.person_id ?? '')) &&
            matchesOrigFilters(r, filters)
        );

        const byEventType: Record<string, number> = {};
        const byCamp = new Map<
          string,
          {
            campaign_id: string;
            campaign_name: string;
            interactions: number;
            unique_people: Set<string>;
          }
        >();

        for (const r of rows) {
          const et = String(r.event_type ?? 'unknown');
          byEventType[et] = (byEventType[et] ?? 0) + 1;
          const cid = String(r.campaign_id ?? '');
          const cur = byCamp.get(cid) ?? {
            campaign_id: cid,
            campaign_name: String(r.campaign_name ?? ''),
            interactions: 0,
            unique_people: new Set<string>(),
          };
          cur.interactions += 1;
          cur.unique_people.add(String(r.person_id));
          byCamp.set(cid, cur);
        }

        return {
          table,
          rules_applied: 'External people only (person_type=external).',
          total_interactions: rows.length,
          unique_external_people: new Set(rows.map((r) => String(r.person_id))).size,
          by_event_type: byEventType,
          by_campaign: [...byCamp.values()]
            .slice(0, MAX_TOOL_ROWS)
            .map((c) => ({
              campaign_id: c.campaign_id,
              campaign_name: c.campaign_name,
              interactions: c.interactions,
              unique_people: c.unique_people.size,
            })),
          sample_rows:
            aggregate === 'list' ? rows.slice(0, MAX_TOOL_ROWS) : undefined,
        };
      }

      return { error: `Unhandled table ${table}` };
    }

    case 'simulate_budget_move': {
      const fromQuery = String(args.from_campaign ?? '').trim();
      const toQuery = String(args.to_campaign ?? '').trim();
      const amount = Number(args.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        return { error: 'amount must be a positive number in INR.' };
      }

      const [liveAnalytics, origCampaigns, origDailyMarketing, externalPersonIds] =
        await Promise.all([
          loadLiveGrowthAnalytics(supabase),
          fetchAllRows(supabase, 'orig_campaigns'),
          fetchAllRows(supabase, 'orig_daily_marketing'),
          fetchExternalPersonIds(supabase),
        ]);
      const { validCheckins } = await fetchValidCheckinsForExternal(
        supabase,
        externalPersonIds
      );
      const { settings, campaigns, campaignRows } = liveAnalytics;

      const from2026 = matchCampaign(fromQuery, campaigns);
      const to2026 = matchCampaign(toQuery, campaigns);
      if (!from2026 || !to2026) {
        return {
          error: 'Could not find one or both campaigns.',
          available_campaigns: campaigns
            .slice(0, MAX_TOOL_ROWS)
            .map((c) => `${c.code}: ${c.name}`),
        };
      }

      const fromRow = campaignRows.find((r) => r.campaign.id === from2026.id)!;
      const toRow = campaignRows.find((r) => r.campaign.id === to2026.id)!;

      const requestedAmount = Math.round(amount);
      const fromPlannedBudget = Math.round(from2026.budget);
      const fromSpendToDate = Math.round(fromRow.spend);
      const fromRawRemaining = Math.round(from2026.budget - fromRow.spend);
      const fromMaxFeasible = Math.max(0, fromRawRemaining);

      const toPlannedBudget = Math.round(to2026.budget);
      const toSpendToDate = Math.round(toRow.spend);
      const toRawRemaining = Math.round(to2026.budget - toRow.spend);

      const exceedsRemaining = requestedAmount > fromMaxFeasible;
      const simulatedAmount = exceedsRemaining ? fromMaxFeasible : requestedAmount;

      const fromNewBudget = fromPlannedBudget - simulatedAmount;
      const toNewBudget = toPlannedBudget + simulatedAmount;

      const budgetPlanComparison = {
        total_plan_budget_inr: Math.round(settings.total_budget),
        net_total_budget_change_inr: 0,
        from_campaign: {
          code: from2026.code,
          name: from2026.name,
          planned_budget_inr: fromPlannedBudget,
          spend_to_date_inr: fromSpendToDate,
          remaining_unspent_budget_inr: fromRawRemaining,
          new_budget_inr: fromNewBudget,
          change_vs_plan_inr: -simulatedAmount,
          change_vs_plan_pct:
            fromPlannedBudget > 0
              ? Number(((-simulatedAmount / fromPlannedBudget) * 100).toFixed(1))
              : null,
          new_budget_used_pct:
            fromNewBudget > 0
              ? Number(((fromSpendToDate / fromNewBudget) * 100).toFixed(1))
              : null,
        },
        to_campaign: {
          code: to2026.code,
          name: to2026.name,
          planned_budget_inr: toPlannedBudget,
          spend_to_date_inr: toSpendToDate,
          remaining_unspent_budget_inr: toRawRemaining,
          new_budget_inr: toNewBudget,
          change_vs_plan_inr: simulatedAmount,
          change_vs_plan_pct:
            toPlannedBudget > 0
              ? Number(((simulatedAmount / toPlannedBudget) * 100).toFixed(1))
              : null,
          new_budget_used_pct:
            toNewBudget > 0
              ? Number(((toSpendToDate / toNewBudget) * 100).toFixed(1))
              : null,
        },
      };

      const feasibilityNote = exceedsRemaining
        ? `Move of ${formatInr(requestedAmount)} from ${from2026.name} is NOT possible as asked because its remaining unspent budget is ${formatInr(fromRawRemaining)} (planned budget ${formatInr(fromPlannedBudget)} minus spend to date ${formatInr(fromSpendToDate)}). ${fromMaxFeasible > 0 ? `Simulating the maximum feasible move of ${formatInr(fromMaxFeasible)} instead (ASSUMPTION).` : 'Maximum feasible move is ₹0.'}`
        : `Move of ${formatInr(requestedAmount)} is within ${from2026.name}'s remaining unspent budget of ${formatInr(fromRawRemaining)}.`;

      if (simulatedAmount <= 0) {
        return {
          label: 'ASSUMPTION',
          move_possible_as_asked: false,
          cannot_simulate: true,
          requested_amount_inr: requestedAmount,
          remaining_unspent_budget_inr: fromRawRemaining,
          max_feasible_amount_inr: 0,
          simulated_amount_inr: 0,
          feasibility_note: feasibilityNote,
          budget_plan_comparison: budgetPlanComparison,
        };
      }

      const compute2025Cpa = (camp: Campaign) => {
        const matchOrig = origCampaigns.find(
          (oc) =>
            String(oc.campaign_id ?? '').toLowerCase() === camp.code.toLowerCase() ||
            String(oc.campaign_name ?? '').toLowerCase() === camp.name.toLowerCase()
        );
        if (!matchOrig) {
          return {
            found: false,
            reason: `${camp.name} (${camp.code}) has no 2025 record in orig_campaigns.`,
            spend_2025_inr: 0,
            attendees_2025: 0,
            cpa_2025_inr: null as number | null,
          };
        }
        const cid = String(matchOrig.campaign_id ?? '');
        const spend2025 = Math.round(
          origDailyMarketing
            .filter((m) => String(m.campaign_id ?? '') === cid)
            .reduce((s, m) => s + (Number(m.marketing_spend_inr) || 0), 0)
        );
        const attendees2025 = new Set(
          validCheckins
            .filter((c) => String(c.campaign_id ?? '') === cid)
            .map((c) => String(c.person_id))
        ).size;

        if (attendees2025 === 0 || spend2025 === 0) {
          return {
            found: false,
            reason: `${camp.name} (${camp.code}) has 2025 spend ₹${spend2025} and ${attendees2025} verified admitted external attendees, so a 2025 cost per attendee cannot be computed.`,
            spend_2025_inr: spend2025,
            attendees_2025: attendees2025,
            cpa_2025_inr: null as number | null,
          };
        }

        return {
          found: true,
          reason: null,
          spend_2025_inr: spend2025,
          attendees_2025: attendees2025,
          cpa_2025_inr: spend2025 / attendees2025,
        };
      };

      const fromStats = compute2025Cpa(from2026);
      const toStats = compute2025Cpa(to2026);

      if (!fromStats.found || !toStats.found || !fromStats.cpa_2025_inr || !toStats.cpa_2025_inr) {
        return {
          label: 'ASSUMPTION',
          move_possible_as_asked: !exceedsRemaining,
          cannot_simulate: true,
          requested_amount_inr: requestedAmount,
          remaining_unspent_budget_inr: fromRawRemaining,
          max_feasible_amount_inr: fromMaxFeasible,
          simulated_amount_inr: simulatedAmount,
          feasibility_note: feasibilityNote,
          budget_plan_comparison: budgetPlanComparison,
          missing_data: [fromStats.reason, toStats.reason].filter(Boolean),
          from_campaign: `${from2026.code} ${from2026.name}`,
          to_campaign: `${to2026.code} ${to2026.name}`,
        };
      }

      const attendeesLostFrom = simulatedAmount / fromStats.cpa_2025_inr;
      const toEffectiveCpa = toStats.cpa_2025_inr * 2; // 2x less efficient on added spend
      const attendeesGainedTo = simulatedAmount / toEffectiveCpa;
      const netAttendeeChange = attendeesGainedTo - attendeesLostFrom;

      return {
        label: 'ASSUMPTION',
        warning:
          'This is a rough ASSUMPTION estimate based on 2025 cost per attendee and an assumed 2x efficiency penalty on incremental spend — NOT a forecast.',
        move_possible_as_asked: !exceedsRemaining,
        requested_amount_inr: requestedAmount,
        remaining_unspent_budget_inr: fromRawRemaining,
        max_feasible_amount_inr: fromMaxFeasible,
        simulated_amount_inr: simulatedAmount,
        amount_moved_inr: simulatedAmount,
        feasibility_note: feasibilityNote,
        budget_plan_comparison: budgetPlanComparison,
        from_campaign: {
          code: from2026.code,
          name: from2026.name,
          spend_2025_inr: fromStats.spend_2025_inr,
          attendees_2025: fromStats.attendees_2025,
          cpa_2025_inr: Number(fromStats.cpa_2025_inr.toFixed(2)),
          estimated_attendees_lost: Number(attendeesLostFrom.toFixed(1)),
        },
        to_campaign: {
          code: to2026.code,
          name: to2026.name,
          spend_2025_inr: toStats.spend_2025_inr,
          attendees_2025: toStats.attendees_2025,
          cpa_2025_inr: Number(toStats.cpa_2025_inr.toFixed(2)),
          assumed_incremental_cpa_inr: Number(toEffectiveCpa.toFixed(2)),
          estimated_attendees_gained: Number(attendeesGainedTo.toFixed(1)),
        },
        net_estimated_attendee_change: Number(netAttendeeChange.toFixed(1)),
        formatted_summary: `${exceedsRemaining ? `NOT POSSIBLE AS ASKED (${formatInr(requestedAmount)} > remaining ${formatInr(fromRawRemaining)}). ` : ''}ASSUMPTION: Moving ${formatInr(simulatedAmount)} from ${from2026.name} (new budget ${formatInr(fromNewBudget)} vs plan ${formatInr(fromPlannedBudget)}; 2025 CPA ${formatInr(fromStats.cpa_2025_inr, 1)}) to ${to2026.name} (new budget ${formatInr(toNewBudget)} vs plan ${formatInr(toPlannedBudget)}; 2025 CPA ${formatInr(toStats.cpa_2025_inr, 1)}, assumed ${formatInr(toEffectiveCpa, 1)} at 2x less efficiency) implies ~${formatNumber(attendeesLostFrom, 1)} fewer from ${from2026.name} and ~${formatNumber(attendeesGainedTo, 1)} gained in ${to2026.name} (net ${netAttendeeChange >= 0 ? '+' : ''}${formatNumber(netAttendeeChange, 1)} attendees).`,
      };
    }

    case 'propose_task': {
      const title = String(args.title ?? '').trim();
      const owner = String(args.owner ?? '').trim();
      const deadline = String(args.deadline ?? '').trim().slice(0, 10);
      const campaignQuery = String(args.campaign ?? '').trim();
      const reason = String(args.reason ?? '').trim();

      if (!title) {
        return { error: 'Task title is required.' };
      }

      const campaignsRaw = await fetchAllRows(supabase, 'campaigns', 'code');
      const campaigns = campaignsRaw.map(normalizeCampaignRow);
      const matched =
        campaignQuery && campaignQuery.toLowerCase() !== 'general'
          ? matchCampaign(campaignQuery, campaigns)
          : undefined;

      const proposal: ProposedTaskPayload = {
        id: crypto.randomUUID(),
        title,
        owner: owner || 'Unassigned',
        deadline,
        campaign: matched ? `${matched.code} — ${matched.name}` : campaignQuery || 'General',
        campaign_id: matched?.id ?? null,
        campaign_name: matched?.name ?? null,
        reason,
      };

      ctx.proposals.push(proposal);

      return {
        status: 'proposal_awaiting_user_confirmation',
        persisted_to_database: false,
        note: 'Task has NOT been created yet. An inline confirmation card has been shown to the user. Tell the user the proposal is ready to review and confirm in the card.',
        proposal,
      };
    }

    default:
      return { error: `Unknown tool "${name}".` };
  }
}

export const growthToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'get_settings',
    description:
      'Fetch all live settings rows from Supabase (as_of_date, event_date, total_budget, total_target_base, total_target_stretch, walk_in_allowance, venue_capacity_per_day).',
  },
  {
    name: 'get_overall_funnel',
    description:
      'Fetch live overall CampusFest 2026 funnel totals and projection breakdown: sum of acquisition-campaign projections (plus per-campaign projected contributions), walk_in_allowance, total projected, net confirmed (reported separately and NOT part of the projection), base & stretch targets, spend, budget, and cost per projected attendee.',
  },
  {
    name: 'get_campaign_metrics',
    description:
      'Fetch live per-campaign metrics, cost per expected attendee to date, projection inputs, and last-7d vs previous-7d upstream funnel stages (impressions, clicks, landing_page_sessions, registration_starts, identified, registrations, spend, plus clicks/impressions, sessions/clicks, registration_starts/sessions, registrations/registration_starts), optionally filtered by campaign name/code or "all" and date range.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        campaign_name: {
          type: Type.STRING,
          description:
            'Campaign name, campaign code (e.g. "C02" or "Paid Social"), or "all" for all campaigns.',
        },
        from_date: {
          type: Type.STRING,
          description: 'Optional inclusive start date (YYYY-MM-DD).',
        },
        to_date: {
          type: Type.STRING,
          description: 'Optional inclusive end date (YYYY-MM-DD).',
        },
      },
      required: ['campaign_name'],
    },
  },
  {
    name: 'compare_campaigns',
    description:
      'Compare two CampusFest 2026 campaigns side-by-side on a specific metric (or "all") with exact difference computed in code. For efficiency comparisons, use cost_per_expected_attendee_to_date.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        campaign_a: {
          type: Type.STRING,
          description: 'First campaign name or code.',
        },
        campaign_b: {
          type: Type.STRING,
          description: 'Second campaign name or code.',
        },
        metric: {
          type: Type.STRING,
          description:
            'Metric to compare, e.g. cost_per_expected_attendee_to_date (preferred efficiency metric), identified, registrations, id_to_reg_pct, net_confirmed, cancel_rate_pct, spend, budget, budget_used_pct, projected_attendees, projected_pct_of_target, cost_per_projected_attendee, last7_registrations, or "all".',
        },
      },
      required: ['campaign_a', 'campaign_b', 'metric'],
    },
  },
  {
    name: 'get_diagnosis',
    description:
      'Run the shared CampusFest 2026 Diagnosis engine live: returns benchmark averages, ranked acquisition campaign statuses, bottleneck flags, cost per expected attendee to date, projection inputs, and last-7d vs previous-7d upstream funnel stages and derived rates.',
  },
  {
    name: 'get_budget_status',
    description:
      'Fetch live budget, spend, % budget used, remaining budget, cost per expected attendee to date, and INR per projected attendee (at full-event projection) per campaign and overall.',
  },
  {
    name: 'list_tasks',
    description:
      'Fetch live execution tasks from Supabase, optionally filtered by status (todo, in_progress, done), campaign name/code, or overdue_only (deadline before settings.as_of_date and not done).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: {
          type: Type.STRING,
          description: 'Optional status filter: todo, in_progress, or done.',
        },
        campaign: {
          type: Type.STRING,
          description: 'Optional campaign name or code filter.',
        },
        overdue_only: {
          type: Type.BOOLEAN,
          description: 'Set true to return only overdue tasks.',
        },
      },
    },
  },
  {
    name: 'query_original_data',
    description:
      'Read-only query against the 2025 historical tables (orig_campaigns, orig_daily_marketing, orig_people, orig_registrations, orig_reg_history, orig_checkins, orig_interactions, orig_targets). Enforces external people only, verified+admitted deduplicated attendance, latest registration status, and whole-INR spend.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        table: {
          type: Type.STRING,
          description:
            'One of: orig_campaigns, orig_daily_marketing, orig_people, orig_registrations, orig_reg_history, orig_checkins, orig_interactions, orig_targets.',
        },
        filters: {
          type: Type.OBJECT,
          description: 'Optional filters to narrow rows.',
          properties: {
            campaign: {
              type: Type.STRING,
              description: 'Filter by campaign name or campaign ID (e.g. C01 or Paid Social).',
            },
            channel: {
              type: Type.STRING,
              description: 'Filter by marketing channel.',
            },
            owner_name: {
              type: Type.STRING,
              description: 'Filter by campaign owner name.',
            },
            status: {
              type: Type.STRING,
              description: 'Filter by latest registration status (e.g. confirmed, cancelled, interested).',
            },
            event_type: {
              type: Type.STRING,
              description: 'Filter orig_interactions by event_type.',
            },
            from_date: {
              type: Type.STRING,
              description: 'Inclusive start date (YYYY-MM-DD).',
            },
            to_date: {
              type: Type.STRING,
              description: 'Inclusive end date (YYYY-MM-DD).',
            },
          },
        },
        aggregate: {
          type: Type.STRING,
          description:
            'Aggregation mode: "summary" (default), "by_campaign", "by_status", "attendance", or "list" (includes up to 50 sample rows).',
        },
      },
      required: ['table'],
    },
  },
  {
    name: 'simulate_budget_move',
    description:
      'Simulate moving INR budget from one campaign to another as a rough ASSUMPTION (never a forecast). Checks source remaining unspent budget (budget - spend to date); if amount exceeds it, reports it is not possible as asked and simulates the maximum feasible amount instead, along with new budgets vs the plan.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        from_campaign: {
          type: Type.STRING,
          description: 'Source campaign name or code to move budget from.',
        },
        to_campaign: {
          type: Type.STRING,
          description: 'Destination campaign name or code to move budget to.',
        },
        amount: {
          type: Type.NUMBER,
          description: 'Amount in INR to simulate moving.',
        },
      },
      required: ['from_campaign', 'to_campaign', 'amount'],
    },
  },
  {
    name: 'propose_task',
    description:
      'Propose a new execution task for user confirmation in an inline UI card. Does NOT write to the database; only inserts if the user clicks Confirm.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Clear actionable task title.',
        },
        owner: {
          type: Type.STRING,
          description: 'Person responsible for the task.',
        },
        deadline: {
          type: Type.STRING,
          description: 'Target deadline date in YYYY-MM-DD format.',
        },
        campaign: {
          type: Type.STRING,
          description: 'Linked campaign name or code (or "General").',
        },
        reason: {
          type: Type.STRING,
          description: 'Short evidence-based reason for proposing this task.',
        },
      },
      required: ['title', 'owner', 'deadline', 'campaign', 'reason'],
    },
  },
];

export { formatPct };
