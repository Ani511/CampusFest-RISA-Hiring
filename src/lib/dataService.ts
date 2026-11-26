import type { SupabaseClient } from '@supabase/supabase-js';
import { parseSettingsRows } from './analytics.js';
import type {
  Campaign,
  CampaignKind,
  DailyMetric,
  GrowthSettings,
  Task,
  TaskSchemaHints,
  TaskStatus,
} from '../types/growth.js';

export interface GrowthDataPayload {
  settings: GrowthSettings;
  campaigns: Campaign[];
  dailyMetrics: DailyMetric[];
  tasks: Task[];
  taskSchemaHints: TaskSchemaHints;
}

function normalizeCampaign(raw: Record<string, unknown>): Campaign {
  const kindRaw = String(raw.kind ?? 'acquisition').toLowerCase();
  const kind: CampaignKind = kindRaw === 'enabler' ? 'enabler' : 'acquisition';
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
    kind,
    assumed_showup: Number(raw.assumed_showup ?? 0),
    target_showup: Number(raw.target_showup ?? 0),
  };
}

function normalizeDailyMetric(raw: Record<string, unknown>): DailyMetric {
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
          : 'description' in sample
            ? 'description'
            : 'title';
  const deadlineCol =
    'deadline' in sample
      ? 'deadline'
      : 'due_date' in sample
        ? 'due_date'
        : 'target_date' in sample
          ? 'target_date'
          : 'deadline';
  const campaignCol = 'campaign_id' in sample ? 'campaign_id' : 'campaign_id';

  return { titleCol, deadlineCol, campaignCol };
}

function normalizeTaskStatus(raw: unknown): TaskStatus {
  const s = String(raw ?? 'todo').toLowerCase().replace(/\s+/g, '_');
  if (s === 'done' || s === 'completed') return 'done';
  if (s === 'in_progress' || s === 'doing') return 'in_progress';
  return 'todo';
}

function normalizeTask(raw: Record<string, unknown>, hints: TaskSchemaHints): Task {
  const deadlineRaw = raw[hints.deadlineCol] ?? raw.deadline ?? raw.due_date ?? null;
  return {
    id: String(raw.id),
    title: String(raw[hints.titleCol] ?? raw.title ?? raw.name ?? raw.task ?? ''),
    status: normalizeTaskStatus(raw.status),
    owner: String(raw.owner ?? ''),
    deadline: deadlineRaw ? String(deadlineRaw).slice(0, 10) : null,
    campaign_id: raw[hints.campaignCol]
      ? String(raw[hints.campaignCol])
      : raw.campaign_id
        ? String(raw.campaign_id)
        : null,
    created_by: raw.created_by ? String(raw.created_by) : undefined,
  };
}

export async function fetchAllGrowthData(
  client: SupabaseClient
): Promise<GrowthDataPayload> {
  const [settingsRes, campaignsRes, metricsRes, tasksRes] = await Promise.all([
    client.from('settings').select('*'),
    client.from('campaigns').select('*').order('code', { ascending: true }),
    client.from('daily_metrics').select('*').order('metric_date', { ascending: true }),
    client.from('tasks').select('*'),
  ]);

  if (settingsRes.error) throw new Error(`settings: ${settingsRes.error.message}`);
  if (campaignsRes.error) throw new Error(`campaigns: ${campaignsRes.error.message}`);
  if (metricsRes.error) throw new Error(`daily_metrics: ${metricsRes.error.message}`);
  if (tasksRes.error) throw new Error(`tasks: ${tasksRes.error.message}`);

  const settings = parseSettingsRows(
    (settingsRes.data ?? []) as Array<Record<string, unknown>>
  );
  const campaigns = ((campaignsRes.data ?? []) as Array<Record<string, unknown>>).map(
    normalizeCampaign
  );
  const dailyMetrics = ((metricsRes.data ?? []) as Array<Record<string, unknown>>).map(
    normalizeDailyMetric
  );

  const rawTasks = (tasksRes.data ?? []) as Array<Record<string, unknown>>;
  const taskSchemaHints = detectTaskHints(rawTasks);
  const tasks = rawTasks.map((t) => normalizeTask(t, taskSchemaHints));

  return {
    settings,
    campaigns,
    dailyMetrics,
    tasks,
    taskSchemaHints,
  };
}

export type CampaignInput = Omit<Campaign, 'id'>;

export async function createCampaign(
  client: SupabaseClient,
  input: CampaignInput
): Promise<void> {
  const payload = {
    ...input,
    planned_start: input.planned_start || null,
  };

  const { error } = await client.from('campaigns').insert(payload);
  if (error) {
    if (error.message.includes('column "id"')) {
      const { error: retryErr } = await client
        .from('campaigns')
        .insert({ id: crypto.randomUUID(), ...payload });
      if (retryErr) throw new Error(retryErr.message);
      return;
    }
    throw new Error(error.message);
  }
}

export async function updateCampaign(
  client: SupabaseClient,
  id: string,
  input: CampaignInput
): Promise<void> {
  const payload = {
    ...input,
    planned_start: input.planned_start || null,
  };
  const { error } = await client.from('campaigns').update(payload).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteCampaign(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from('campaigns').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export type TaskInput = Omit<Task, 'id'> & { created_by?: string };

export async function createTask(
  client: SupabaseClient,
  input: TaskInput,
  hints: TaskSchemaHints
): Promise<void> {
  const payload: Record<string, unknown> = {
    [hints.titleCol]: input.title,
    status: input.status,
    owner: input.owner,
    [hints.deadlineCol]: input.deadline || null,
    [hints.campaignCol]: input.campaign_id || null,
    created_by: input.created_by ?? 'user',
  };
  const { error } = await client.from('tasks').insert(payload);
  if (error) {
    if (error.message.includes('column "id"')) {
      const { error: retryErr } = await client
        .from('tasks')
        .insert({ id: crypto.randomUUID(), ...payload });
      if (retryErr) throw new Error(retryErr.message);
      return;
    }
    throw new Error(error.message);
  }
}

export async function updateTask(
  client: SupabaseClient,
  id: string,
  input: Partial<TaskInput>,
  hints: TaskSchemaHints
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload[hints.titleCol] = input.title;
  if (input.status !== undefined) payload.status = input.status;
  if (input.owner !== undefined) payload.owner = input.owner;
  if (input.deadline !== undefined) payload[hints.deadlineCol] = input.deadline || null;
  if (input.campaign_id !== undefined)
    payload[hints.campaignCol] = input.campaign_id || null;

  const { error } = await client.from('tasks').update(payload).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTask(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('tasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export type DailyMetricInput = Omit<DailyMetric, 'id'>;

export async function insertDailyMetric(
  client: SupabaseClient,
  input: DailyMetricInput
): Promise<void> {
  const { error } = await client.from('daily_metrics').insert(input);
  if (error) throw new Error(error.message);
}

export async function deleteDailyMetric(
  client: SupabaseClient,
  metric: DailyMetric
): Promise<void> {
  if (metric.id !== undefined) {
    const { error } = await client.from('daily_metrics').delete().eq('id', metric.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await client
    .from('daily_metrics')
    .delete()
    .eq('campaign_id', metric.campaign_id)
    .eq('metric_date', metric.metric_date);
  if (error) throw new Error(error.message);
}
