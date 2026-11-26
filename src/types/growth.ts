export type CampaignKind = 'acquisition' | 'enabler';

export interface Campaign {
  id: string;
  code: string;
  name: string;
  channel: string;
  segment: string;
  budget: number;
  target_identified: number;
  target_registrations: number;
  target_attendees: number;
  status: string;
  owner: string;
  planned_start: string | null;
  kind: CampaignKind;
  assumed_showup: number;
  target_showup: number;
}

export interface DailyMetric {
  id?: string | number;
  campaign_id: string;
  metric_date: string;
  impressions: number;
  clicks: number;
  landing_page_sessions: number;
  registration_starts: number;
  identified: number;
  registrations: number;
  confirmed: number;
  cancelled: number;
  spend: number;
  expected_attendees: number;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  owner: string;
  deadline: string | null;
  campaign_id: string | null;
  created_by?: string;
}

export interface TaskSchemaHints {
  titleCol: string;
  deadlineCol: string;
  campaignCol: string;
}

export interface GrowthSettings {
  as_of_date: string;
  event_date: string;
  total_budget: number;
  total_target_base: number;
  total_target_stretch: number;
  walk_in_allowance: number;
  venue_capacity_per_day: number;
}

export interface WindowFunnelMetrics {
  impressions: number;
  clicks: number;
  landing_page_sessions: number;
  registration_starts: number;
  identified: number;
  registrations: number;
  spend: number;
  clicksPerImpressionPct: number | null;
  sessionsPerClickPct: number | null;
  regStartsPerSessionPct: number | null;
  regsPerRegStartPct: number | null;
}

export interface CampaignComputed {
  campaign: Campaign;
  isEnabler: boolean;
  isPlanned: boolean;
  metricsCount: number;
  identified: number;
  registrations: number;
  confirmed: number;
  cancelled: number;
  netConfirmed: number;
  spend: number;
  identifiedToRegisteredPct: number | null;
  cancelRatePct: number | null;
  budgetUsedPct: number | null;
  avgDailyRegLast7: number;
  projectedAttendees: number;
  expectedAttendeesToDate: number;
  costPerExpectedAttendeeToDate: number | null;
  costPerProjectedAttendee: number | null;
  projectedPctOfTarget: number | null;
  // Diagnosis window metrics
  last7Registrations: number;
  prev7Registrations: number;
  regChangePct: number | null;
  last7Confirmed: number;
  last7Cancelled: number;
  last7CancelRatePct: number | null;
  prev7Confirmed: number;
  prev7Cancelled: number;
  prev7CancelRatePct: number | null;
  earlierConfirmed: number;
  earlierCancelled: number;
  earlierCancelRatePct: number | null;
  last7Funnel: WindowFunnelMetrics;
  prev7Funnel: WindowFunnelMetrics;
}

export type DiagnosisStatus = 'On track' | 'At risk' | 'Underperforming' | 'Planned';

export interface DiagnosisItem {
  computed: CampaignComputed;
  status: DiagnosisStatus;
  bottlenecks: string[];
  hasFunnelBottleneck: boolean;
  hasCancelAvgBottleneck: boolean;
  hasCancelSpikeBottleneck: boolean;
  hasRegistrationsFallingBottleneck: boolean;
  regDeltaAbs: number;
  regDeltaPct: number | null;
  cancelRateDeltaPp: number | null;
}

export interface DashboardSummary {
  totalIdentified: number;
  totalRegistrations: number;
  totalConfirmed: number;
  totalCancelled: number;
  totalNetConfirmed: number;
  totalSpend: number;
  acquisitionSpend: number;
  enablerSpend: number;
  acquisitionProjectedAttendees: number;
  totalProjectedAttendees: number;
  totalExpectedAttendeesToDate: number;
  costPerExpectedAttendeeToDate: number | null;
  costPerProjectedAttendee: number | null;
  budgetUsedPct: number | null;
  projectedVsBasePct: number | null;
  projectedVsStretchPct: number | null;
  daysRemaining: number;
  avgIdToRegPct: number | null;
  avgLast7CancelRatePct: number | null;
}
