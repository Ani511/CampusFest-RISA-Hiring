import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { daysBetweenUtc, formatInr, formatNumber } from '../lib/analytics';
import type { CampaignInput, DailyMetricInput, TaskInput } from '../lib/dataService';
import type {
  Campaign,
  CampaignKind,
  DailyMetric,
  GrowthSettings,
  Task,
  TaskStatus,
} from '../types/growth';
import { formatShortDate } from './uiHelpers';

export type ExecutionSection = 'tasks' | 'campaigns' | 'metrics';

interface ExecutionTabProps {
  campaigns: Campaign[];
  dailyMetrics: DailyMetric[];
  tasks: Task[];
  settings: GrowthSettings;
  initialSection?: ExecutionSection;
  onSectionChange?: (section: ExecutionSection) => void;
  onNotify: (message: string) => void;
  onCreateCampaign: (input: CampaignInput) => Promise<void>;
  onUpdateCampaign: (id: string, input: CampaignInput) => Promise<void>;
  onDeleteCampaign: (id: string) => Promise<void>;
  onCreateTask: (input: TaskInput) => Promise<void>;
  onUpdateTask: (id: string, input: Partial<TaskInput>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onInsertDailyMetric: (input: DailyMetricInput) => Promise<void>;
  onDeleteDailyMetric: (metric: DailyMetric) => Promise<void>;
}

type TaskFilter = 'all' | 'overdue' | TaskStatus;

const emptyCampaignForm = (asOfDate: string): CampaignInput => ({
  code: '',
  name: '',
  channel: '',
  segment: '',
  budget: 0,
  target_identified: 0,
  target_registrations: 0,
  target_attendees: 0,
  status: 'active',
  owner: '',
  planned_start: asOfDate || null,
  kind: 'acquisition',
  assumed_showup: 0.7,
  target_showup: 0.75,
});

const emptyTaskForm = (asOfDate: string): TaskInput => ({
  title: '',
  status: 'todo',
  owner: '',
  deadline: asOfDate || null,
  campaign_id: null,
});

export const ExecutionTab: React.FC<ExecutionTabProps> = ({
  campaigns,
  dailyMetrics,
  tasks,
  settings,
  initialSection = 'tasks',
  onSectionChange,
  onNotify,
  onCreateCampaign,
  onUpdateCampaign,
  onDeleteCampaign,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onInsertDailyMetric,
  onDeleteDailyMetric,
}) => {
  const [section, setSection] = useState<ExecutionSection>(initialSection);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const switchSection = (next: ExecutionSection) => {
    setSection(next);
    setMutationError(null);
    onSectionChange?.(next);
  };

  const campaignById = useMemo(() => {
    const map = new Map<string, Campaign>();
    for (const c of campaigns) {
      map.set(c.id, c);
    }
    return map;
  }, [campaigns]);

  // TASKS STATE
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [taskCampaignFilter, setTaskCampaignFilter] = useState<string>('all');
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<TaskInput>(() =>
    emptyTaskForm(settings.as_of_date)
  );
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<string | null>(null);

  const isTaskOverdue = (t: Task): boolean => {
    if (!t.deadline || !settings.as_of_date) return false;
    return t.deadline < settings.as_of_date && t.status !== 'done';
  };

  const overdueDaysCount = (t: Task): number => {
    if (!t.deadline || !settings.as_of_date) return 0;
    return daysBetweenUtc(t.deadline, settings.as_of_date);
  };

  const taskStats = useMemo(() => {
    let overdue = 0;
    let todo = 0;
    let inProgress = 0;
    let done = 0;
    for (const t of tasks) {
      if (isTaskOverdue(t)) overdue += 1;
      if (t.status === 'todo') todo += 1;
      else if (t.status === 'in_progress') inProgress += 1;
      else done += 1;
    }
    return { overdue, todo, inProgress, done };
  }, [tasks, settings.as_of_date]);

  const filteredTasks = useMemo(() => {
    const list = tasks.filter((t) => {
      if (taskCampaignFilter !== 'all' && t.campaign_id !== taskCampaignFilter) {
        return false;
      }
      if (taskFilter === 'overdue') return isTaskOverdue(t);
      if (taskFilter !== 'all' && t.status !== taskFilter) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const aOver = isTaskOverdue(a) ? 0 : 1;
      const bOver = isTaskOverdue(b) ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31');
    });
  }, [tasks, taskFilter, taskCampaignFilter, settings.as_of_date]);

  const openAddTask = () => {
    setEditingTaskId(null);
    setTaskForm(emptyTaskForm(settings.as_of_date));
    setTaskFormError(null);
    setMutationError(null);
    setShowTaskPanel(true);
  };

  const openEditTask = (t: Task) => {
    setEditingTaskId(t.id);
    setTaskForm({
      title: t.title,
      status: t.status,
      owner: t.owner,
      deadline: t.deadline,
      campaign_id: t.campaign_id,
    });
    setTaskFormError(null);
    setMutationError(null);
    setShowTaskPanel(true);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.title.trim()) {
      setTaskFormError('Enter a task title before saving.');
      return;
    }
    if (!taskForm.owner.trim()) {
      setTaskFormError('Assign an owner so someone is accountable for this task.');
      return;
    }
    setBusyId('task-save');
    setTaskFormError(null);
    setMutationError(null);
    try {
      if (editingTaskId) {
        await onUpdateTask(editingTaskId, taskForm);
        onNotify('Task updated');
      } else {
        await onCreateTask(taskForm);
        onNotify('Task added');
      }
      setShowTaskPanel(false);
    } catch (err) {
      setTaskFormError(err instanceof Error ? err.message : 'Failed to save task.');
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickTaskStatus = async (taskId: string, status: TaskStatus) => {
    setBusyId(`task-status-${taskId}`);
    setMutationError(null);
    try {
      await onUpdateTask(taskId, { status });
      onNotify('Task status updated');
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Failed to update task.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    setBusyId(`task-del-${taskId}`);
    setMutationError(null);
    try {
      await onDeleteTask(taskId);
      setConfirmDeleteTaskId(null);
      onNotify('Task deleted');
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Failed to delete task.');
    } finally {
      setBusyId(null);
    }
  };

  // CAMPAIGNS STATE
  const [showCampaignPanel, setShowCampaignPanel] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [campaignForm, setCampaignForm] = useState<CampaignInput>(() =>
    emptyCampaignForm(settings.as_of_date)
  );
  const [campaignFormError, setCampaignFormError] = useState<string | null>(null);
  const [confirmDeleteCampaignId, setConfirmDeleteCampaignId] = useState<string | null>(
    null
  );

  const openAddCampaign = () => {
    setEditingCampaignId(null);
    setCampaignForm(emptyCampaignForm(settings.as_of_date));
    setCampaignFormError(null);
    setMutationError(null);
    setShowCampaignPanel(true);
  };

  const openEditCampaign = (c: Campaign) => {
    setEditingCampaignId(c.id);
    setCampaignForm({
      code: c.code,
      name: c.name,
      channel: c.channel,
      segment: c.segment,
      budget: c.budget,
      target_identified: c.target_identified,
      target_registrations: c.target_registrations,
      target_attendees: c.target_attendees,
      status: c.status,
      owner: c.owner,
      planned_start: c.planned_start,
      kind: c.kind,
      assumed_showup: c.assumed_showup,
      target_showup: c.target_showup,
    });
    setCampaignFormError(null);
    setMutationError(null);
    setShowCampaignPanel(true);
  };

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignForm.code.trim()) {
      setCampaignFormError('Enter a campaign code (e.g. C10).');
      return;
    }
    if (!campaignForm.name.trim()) {
      setCampaignFormError('Enter a campaign name.');
      return;
    }
    setBusyId('campaign-save');
    setCampaignFormError(null);
    setMutationError(null);
    try {
      if (editingCampaignId) {
        await onUpdateCampaign(editingCampaignId, campaignForm);
        onNotify('Campaign updated');
      } else {
        await onCreateCampaign(campaignForm);
        onNotify('Campaign added');
      }
      setShowCampaignPanel(false);
    } catch (err) {
      setCampaignFormError(
        err instanceof Error ? err.message : 'Failed to save campaign.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    setBusyId(`camp-del-${campaignId}`);
    setMutationError(null);
    try {
      await onDeleteCampaign(campaignId);
      setConfirmDeleteCampaignId(null);
      onNotify('Campaign deleted');
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : 'Failed to delete campaign.'
      );
    } finally {
      setBusyId(null);
    }
  };

  // DAILY METRICS STATE
  const [metricForm, setMetricForm] = useState<{
    campaign_id: string;
    metric_date: string;
    identified: string;
    registrations: string;
    confirmed: string;
    cancelled: string;
    spend: string;
    impressions: string;
    clicks: string;
    landing_page_sessions: string;
    registration_starts: string;
    expected_attendees: string;
  }>({
    campaign_id: campaigns[0]?.id ?? '',
    metric_date: settings.as_of_date || '',
    identified: '0',
    registrations: '0',
    confirmed: '0',
    cancelled: '0',
    spend: '0',
    impressions: '0',
    clicks: '0',
    landing_page_sessions: '0',
    registration_starts: '0',
    expected_attendees: '0',
  });
  const [showOptionalMetrics, setShowOptionalMetrics] = useState(false);
  const [metricFormError, setMetricFormError] = useState<string | null>(null);
  const [confirmDeleteMetricKey, setConfirmDeleteMetricKey] = useState<string | null>(null);

  const selectedCampaignId = metricForm.campaign_id || campaigns[0]?.id || '';
  const selectedMetricDate = metricForm.metric_date || settings.as_of_date || '';

  const recentMetrics = useMemo(() => {
    return [...dailyMetrics]
      .sort((a, b) => b.metric_date.localeCompare(a.metric_date))
      .slice(0, 25);
  }, [dailyMetrics]);

  const handleAddMetric = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaignId) {
      setMetricFormError('Select a campaign first.');
      return;
    }
    if (!selectedMetricDate) {
      setMetricFormError('Select a metric date.');
      return;
    }

    setBusyId('metric-save');
    setMetricFormError(null);
    setMutationError(null);
    try {
      await onInsertDailyMetric({
        campaign_id: selectedCampaignId,
        metric_date: selectedMetricDate,
        identified: Number(metricForm.identified) || 0,
        registrations: Number(metricForm.registrations) || 0,
        confirmed: Number(metricForm.confirmed) || 0,
        cancelled: Number(metricForm.cancelled) || 0,
        spend: Number(metricForm.spend) || 0,
        impressions: Number(metricForm.impressions) || 0,
        clicks: Number(metricForm.clicks) || 0,
        landing_page_sessions: Number(metricForm.landing_page_sessions) || 0,
        registration_starts: Number(metricForm.registration_starts) || 0,
        expected_attendees: Number(metricForm.expected_attendees) || 0,
      });
      const campName = campaignById.get(selectedCampaignId)?.name ?? 'campaign';
      onNotify(`Numbers logged for ${campName}`);
      setMetricForm((prev) => ({
        ...prev,
        identified: '0',
        registrations: '0',
        confirmed: '0',
        cancelled: '0',
        spend: '0',
        impressions: '0',
        clicks: '0',
        landing_page_sessions: '0',
        registration_starts: '0',
        expected_attendees: '0',
      }));
    } catch (err) {
      setMetricFormError(
        err instanceof Error ? err.message : 'Failed to log daily metric.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteMetric = async (m: DailyMetric, rowKey: string) => {
    setBusyId(`metric-del-${rowKey}`);
    setMutationError(null);
    try {
      await onDeleteDailyMetric(m);
      setConfirmDeleteMetricKey(null);
      onNotify('Metric entry removed');
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : 'Failed to delete daily metric.'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Segmented Tabs with indigo underline + Primary Action ("Add task") */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#DDD5C4] pb-3">
        <div
          role="tablist"
          aria-label="Tasks and campaigns sections"
          className="flex flex-wrap items-center gap-6"
        >
          {(
            [
              { id: 'tasks', label: 'Tasks' },
              { id: 'campaigns', label: 'Campaigns' },
              { id: 'metrics', label: 'Log numbers' },
            ] as const
          ).map((item) => {
            const isSelected = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => switchSection(item.id)}
                className={`pb-2 text-sm font-semibold relative transition-colors ${
                  isSelected ? 'text-[#3B4A8C]' : 'text-[#4F4A3F] hover:text-[#1F1B16]'
                }`}
              >
                <span>{item.label}</span>
                {isSelected && (
                  <div className="absolute bottom-[-13px] left-0 right-0 h-[2px] bg-[#3B4A8C]" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {section === 'tasks' && (
            <button
              type="button"
              onClick={openAddTask}
              className="calm-btn-primary"
            >
              Add task
            </button>
          )}
          {section === 'campaigns' && (
            <button
              type="button"
              onClick={openAddCampaign}
              className="calm-btn-primary"
            >
              Add campaign
            </button>
          )}
        </div>
      </div>

      {mutationError && (
        <div
          role="alert"
          className="bg-[#FDF2F2] border border-[#D6453D] text-[#1F1B16] text-sm px-4 py-3 rounded-lg flex items-center justify-between gap-4"
        >
          <span>{mutationError}</span>
          <button
            type="button"
            onClick={() => setMutationError(null)}
            className="text-[#1F1B16] hover:text-[#D6453D] p-1"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SECTION 1: TASKS */}
      {section === 'tasks' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="calm-card p-5">
              <div className="text-[14px] font-semibold text-[#4F4A3F]">Overdue</div>
              <div
                className={`mt-1 font-display text-3xl font-bold tabular-nums ${
                  taskStats.overdue > 0 ? 'text-[#D6453D]' : 'text-[#1F1B16]'
                }`}
              >
                {taskStats.overdue}
              </div>
              <div className="mt-1 text-sm text-[#4F4A3F]">
                Past deadline before {formatShortDate(settings.as_of_date, false)}
              </div>
            </div>

            <div className="calm-card p-5">
              <div className="text-[14px] font-semibold text-[#4F4A3F]">To do</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-[#1F1B16]">
                {taskStats.todo}
              </div>
              <div className="mt-1 text-sm text-[#4F4A3F]">
                Waiting to be picked up
              </div>
            </div>

            <div className="calm-card p-5">
              <div className="text-[14px] font-semibold text-[#4F4A3F]">In progress</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-[#1F1B16]">
                {taskStats.inProgress}
              </div>
              <div className="mt-1 text-sm text-[#4F4A3F]">
                Currently underway
              </div>
            </div>

            <div className="calm-card p-5">
              <div className="text-[14px] font-semibold text-[#4F4A3F]">Done</div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-[#2A9D8F]">
                {taskStats.done}
              </div>
              <div className="mt-1 text-sm text-[#4F4A3F]">
                Completed tasks
              </div>
            </div>
          </div>

          <section className="calm-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DDD5C4] flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {(
                  [
                    { id: 'all', label: 'All', count: tasks.length },
                    { id: 'overdue', label: 'Overdue', count: taskStats.overdue },
                    { id: 'todo', label: 'To do', count: taskStats.todo },
                    { id: 'in_progress', label: 'In progress', count: taskStats.inProgress },
                    { id: 'done', label: 'Done', count: taskStats.done },
                  ] as const
                ).map((f) => {
                  const isSelected = taskFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setTaskFilter(f.id)}
                      className={`font-semibold transition-colors ${
                        isSelected ? 'text-[#3B4A8C] underline' : 'text-[#4F4A3F] hover:text-[#1F1B16]'
                      }`}
                    >
                      {f.label} <span className="text-xs text-[#6C757D]">({f.count})</span>
                    </button>
                  );
                })}
              </div>

              <select
                value={taskCampaignFilter}
                onChange={(e) => setTaskCampaignFilter(e.target.value)}
                aria-label="Filter tasks by campaign"
                className="px-3 py-1.5 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
              >
                <option value="all">All campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DDD5C4] text-[14px] font-semibold text-[#4F4A3F]">
                    <th className="py-3 px-6 whitespace-nowrap">Task</th>
                    <th className="py-3 px-4 whitespace-nowrap">Campaign</th>
                    <th className="py-3 px-4 whitespace-nowrap">Owner</th>
                    <th className="py-3 px-4 whitespace-nowrap">Deadline</th>
                    <th className="py-3 px-4 whitespace-nowrap">Status</th>
                    <th className="py-3 px-6 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE6D8] text-[15px]">
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-sm text-[#4F4A3F]">
                        {tasks.length === 0 ? (
                          <div className="space-y-3">
                            <p>No tasks yet. Add the first one.</p>
                            <button
                              type="button"
                              onClick={openAddTask}
                              className="calm-btn-primary text-sm py-2"
                            >
                              Add task
                            </button>
                          </div>
                        ) : (
                          'No tasks match the selected filter.'
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map((t) => {
                      const overdue = isTaskOverdue(t);
                      const daysLate = overdue ? overdueDaysCount(t) : 0;
                      const camp = t.campaign_id
                        ? campaignById.get(t.campaign_id)
                        : undefined;
                      const isConfirming = confirmDeleteTaskId === t.id;
                      const isAnalystTask = t.created_by === 'chatbot';

                      return (
                        <tr
                          key={t.id}
                          style={{
                            borderLeft: overdue
                              ? '4px solid #D6453D'
                              : '4px solid transparent',
                          }}
                          className={`transition-colors ${
                            overdue ? 'bg-[#FDF1EF]' : 'hover:bg-[#F8F6F0]'
                          }`}
                        >
                          <td className="py-3.5 px-6 max-w-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`font-medium ${
                                  t.status === 'done'
                                    ? 'text-[#6C757D] line-through'
                                    : 'text-[#1F1B16]'
                                }`}
                              >
                                {t.title}
                              </span>
                              {isAnalystTask && (
                                <span className="px-2 py-0.5 text-[12px] text-[#4F4A3F] border border-[#DDD5C4] rounded">
                                  Created by analyst
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-sm text-[#4F4A3F] whitespace-nowrap">
                            {camp ? (
                              <span>
                                <span className="text-[#6C757D] mr-1 tabular-nums">{camp.code}</span>
                                <span className="text-[#1F1B16] font-medium">{camp.name}</span>
                              </span>
                            ) : (
                              <span>General</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-sm text-[#1F1B16] whitespace-nowrap">
                            {t.owner || '—'}
                          </td>

                          <td className="py-3.5 px-4 text-sm tabular-nums whitespace-nowrap">
                            <span className={overdue ? 'font-bold text-[#1F1B16]' : 'text-[#1F1B16]'}>
                              {formatShortDate(t.deadline)}
                            </span>
                            {overdue && (
                              <span className="ml-2 font-bold text-[#1F1B16]">
                                {daysLate} {daysLate === 1 ? 'day' : 'days'} overdue
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2 h-2 rounded-full inline-block"
                                style={{
                                  backgroundColor:
                                    t.status === 'done'
                                      ? '#2A9D8F'
                                      : t.status === 'in_progress'
                                        ? '#F4C430'
                                        : '#6C757D',
                                }}
                              />
                              <select
                                value={t.status}
                                disabled={busyId === `task-status-${t.id}`}
                                onChange={(e) =>
                                  handleQuickTaskStatus(
                                    t.id,
                                    e.target.value as TaskStatus
                                  )
                                }
                                aria-label={`Status for ${t.title}`}
                                className="px-2.5 py-1 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                              >
                                <option value="todo">To do</option>
                                <option value="in_progress">In progress</option>
                                <option value="done">Done</option>
                              </select>
                            </div>
                          </td>

                          <td className="py-3.5 px-6 text-right whitespace-nowrap text-sm">
                            {isConfirming ? (
                              <div className="inline-flex items-center gap-3">
                                <button
                                  type="button"
                                  disabled={busyId === `task-del-${t.id}`}
                                  onClick={() => handleDeleteTask(t.id)}
                                  className="font-bold text-[#D6453D] hover:underline"
                                >
                                  Confirm delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteTaskId(null)}
                                  className="text-[#4F4A3F] hover:underline"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-4">
                                <button
                                  type="button"
                                  onClick={() => openEditTask(t)}
                                  className="text-[#3B4A8C] font-semibold hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteTaskId(t.id)}
                                  className="text-[#D6453D] hover:underline"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* SECTION 2: CAMPAIGNS */}
      {section === 'campaigns' && (
        <section className="calm-card overflow-hidden">
          <div className="px-6 py-4 border-b border-[#DDD5C4]">
            <h2 className="font-display text-xl font-bold text-[#1F1B16]">
              Manage campaigns
            </h2>
            <p className="text-sm text-[#4F4A3F] mt-1">
              Edit targets, show-up assumptions, budgets, or add a new channel.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DDD5C4] text-[14px] font-semibold text-[#4F4A3F]">
                  <th className="py-3 px-6 whitespace-nowrap">Code and name</th>
                  <th className="py-3 px-4 whitespace-nowrap">Kind</th>
                  <th className="py-3 px-4 whitespace-nowrap">Channel and segment</th>
                  <th className="py-3 px-4 whitespace-nowrap">Owner</th>
                  <th className="py-3 px-4 whitespace-nowrap">Start and status</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Budget</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">
                    Targets (Id / Reg / Att)
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">
                    Show-up (Assumed / Target)
                  </th>
                  <th className="py-3 px-6 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE6D8] text-[15px]">
                {campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-sm text-[#4F4A3F]">
                      No campaigns yet. Add the first one.
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => {
                    const isConfirming = confirmDeleteCampaignId === c.id;
                    return (
                      <tr key={c.id} className="hover:bg-[#F8F6F0] transition-colors">
                        <td className="py-3.5 px-6">
                          <div className="font-semibold text-[#1F1B16]">
                            <span className="text-sm text-[#6C757D] mr-2 tabular-nums">
                              {c.code}
                            </span>
                            {c.name}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-sm whitespace-nowrap text-[#4F4A3F]">
                          {c.kind === 'enabler' ? 'Enabler' : 'Acquisition'}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[#4F4A3F] whitespace-nowrap">
                          {c.channel} · {c.segment}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[#1F1B16] whitespace-nowrap">
                          {c.owner}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[#4F4A3F] whitespace-nowrap tabular-nums">
                          {formatShortDate(c.planned_start)} · {c.status}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-sm font-semibold text-[#1F1B16] whitespace-nowrap">
                          {formatInr(c.budget)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-sm text-[#1F1B16] whitespace-nowrap">
                          {formatNumber(c.target_identified)} /{' '}
                          {formatNumber(c.target_registrations)} /{' '}
                          {formatNumber(c.target_attendees)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-sm text-[#1F1B16] whitespace-nowrap">
                          {c.assumed_showup} / {c.target_showup}
                        </td>
                        <td className="py-3.5 px-6 text-right whitespace-nowrap text-sm">
                          {isConfirming ? (
                            <div className="inline-flex items-center gap-3">
                              <button
                                type="button"
                                disabled={busyId === `camp-del-${c.id}`}
                                onClick={() => handleDeleteCampaign(c.id)}
                                className="font-bold text-[#D6453D] hover:underline"
                              >
                                Confirm delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCampaignId(null)}
                                className="text-[#4F4A3F] hover:underline"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-4">
                              <button
                                type="button"
                                onClick={() => openEditCampaign(c)}
                                className="text-[#3B4A8C] font-semibold hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCampaignId(c.id)}
                                className="text-[#D6453D] hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SECTION 3: LOG NUMBERS */}
      {section === 'metrics' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-5 calm-card p-6 space-y-4">
            <div>
              <h2 className="font-display text-xl font-bold text-[#1F1B16]">
                Log today's numbers
              </h2>
              <p className="text-sm text-[#4F4A3F] mt-1">
                Saves a daily entry and updates every chart and projection immediately.
              </p>
            </div>

            <form onSubmit={handleAddMetric} className="space-y-4">
              <div>
                <label
                  htmlFor="metric-campaign"
                  className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5"
                >
                  Campaign
                </label>
                <select
                  id="metric-campaign"
                  value={selectedCampaignId}
                  onChange={(e) =>
                    setMetricForm((p) => ({ ...p, campaign_id: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name} ({c.kind})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="metric-date"
                  className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5"
                >
                  Metric date
                </label>
                <input
                  id="metric-date"
                  type="date"
                  value={selectedMetricDate}
                  onChange={(e) =>
                    setMetricForm((p) => ({ ...p, metric_date: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="metric-identified"
                    className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5"
                  >
                    Identified
                  </label>
                  <input
                    id="metric-identified"
                    type="number"
                    min="0"
                    value={metricForm.identified}
                    onChange={(e) =>
                      setMetricForm((p) => ({ ...p, identified: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="metric-registrations"
                    className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5"
                  >
                    Registrations
                  </label>
                  <input
                    id="metric-registrations"
                    type="number"
                    min="0"
                    value={metricForm.registrations}
                    onChange={(e) =>
                      setMetricForm((p) => ({ ...p, registrations: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="metric-confirmed"
                    className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5"
                  >
                    Confirmed
                  </label>
                  <input
                    id="metric-confirmed"
                    type="number"
                    min="0"
                    value={metricForm.confirmed}
                    onChange={(e) =>
                      setMetricForm((p) => ({ ...p, confirmed: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="metric-cancelled"
                    className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5"
                  >
                    Cancelled
                  </label>
                  <input
                    id="metric-cancelled"
                    type="number"
                    min="0"
                    value={metricForm.cancelled}
                    onChange={(e) =>
                      setMetricForm((p) => ({ ...p, cancelled: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="metric-spend"
                  className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5"
                >
                  Spend (INR)
                </label>
                <input
                  id="metric-spend"
                  type="number"
                  min="0"
                  step="0.01"
                  value={metricForm.spend}
                  onChange={(e) =>
                    setMetricForm((p) => ({ ...p, spend: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowOptionalMetrics((v) => !v)}
                  className="text-sm font-semibold text-[#3B4A8C] hover:underline"
                >
                  {showOptionalMetrics
                    ? 'Hide upper-funnel fields'
                    : 'Show upper-funnel fields (impressions, clicks, sessions)'}
                </button>

                {showOptionalMetrics && (
                  <div className="mt-3 grid grid-cols-2 gap-3 pt-3 border-t border-[#ECE6D8]">
                    <div>
                      <label className="block text-sm text-[#4F4A3F] mb-1">
                        Impressions
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={metricForm.impressions}
                        onChange={(e) =>
                          setMetricForm((p) => ({ ...p, impressions: e.target.value }))
                        }
                        className="w-full px-3 py-1.5 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-[#4F4A3F] mb-1">
                        Clicks
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={metricForm.clicks}
                        onChange={(e) =>
                          setMetricForm((p) => ({ ...p, clicks: e.target.value }))
                        }
                        className="w-full px-3 py-1.5 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-[#4F4A3F] mb-1">
                        Sessions
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={metricForm.landing_page_sessions}
                        onChange={(e) =>
                          setMetricForm((p) => ({
                            ...p,
                            landing_page_sessions: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-1.5 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-[#4F4A3F] mb-1">
                        Reg starts
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={metricForm.registration_starts}
                        onChange={(e) =>
                          setMetricForm((p) => ({
                            ...p,
                            registration_starts: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-1.5 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg"
                      />
                    </div>
                  </div>
                )}
              </div>

              {metricFormError && (
                <p role="alert" className="text-sm text-[#D6453D] font-semibold">
                  {metricFormError}
                </p>
              )}

              <button
                type="submit"
                disabled={busyId === 'metric-save'}
                className="calm-btn-primary w-full"
              >
                {busyId === 'metric-save' ? 'Saving numbers...' : "Save today's numbers"}
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 calm-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DDD5C4]">
              <h2 className="font-display text-xl font-bold text-[#1F1B16]">
                Recently logged entries
              </h2>
              <p className="text-sm text-[#4F4A3F] mt-1">
                Last 25 entries across all campaigns. Click delete to remove a mistaken entry.
              </p>
            </div>

            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DDD5C4] text-[14px] font-semibold text-[#4F4A3F] sticky top-0 bg-white">
                    <th className="py-3 px-6 whitespace-nowrap">Date</th>
                    <th className="py-3 px-4 whitespace-nowrap">Campaign</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Id / Reg</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Spend</th>
                    <th className="py-3 px-6 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE6D8] text-[15px]">
                  {recentMetrics.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-sm text-[#4F4A3F]">
                        No daily metrics logged yet.
                      </td>
                    </tr>
                  ) : (
                    recentMetrics.map((m) => {
                      const camp = campaignById.get(m.campaign_id);
                      const rowKey = `${m.campaign_id}-${m.metric_date}`;
                      const isConfirming = confirmDeleteMetricKey === rowKey;

                      return (
                        <tr key={rowKey} className="hover:bg-[#F8F6F0] transition-colors">
                          <td className="py-3.5 px-6 text-sm tabular-nums text-[#1F1B16] whitespace-nowrap">
                            {formatShortDate(m.metric_date)}
                          </td>
                          <td className="py-3.5 px-4 text-sm text-[#1F1B16] whitespace-nowrap">
                            {camp ? (
                              <span>
                                <span className="text-[#6C757D] mr-1 tabular-nums">{camp.code}</span>
                                <span className="font-medium">{camp.name}</span>
                              </span>
                            ) : (
                              <span>Unknown</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right text-sm tabular-nums text-[#1F1B16] whitespace-nowrap">
                            {formatNumber(m.identified)} / {formatNumber(m.registrations)}
                          </td>
                          <td className="py-3.5 px-4 text-right text-sm tabular-nums text-[#1F1B16] whitespace-nowrap">
                            {formatInr(m.spend)}
                          </td>
                          <td className="py-3.5 px-6 text-right whitespace-nowrap text-sm">
                            {isConfirming ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={busyId === `metric-del-${rowKey}`}
                                  onClick={() => handleDeleteMetric(m, rowKey)}
                                  className="font-bold text-[#D6453D] hover:underline"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteMetricKey(null)}
                                  className="text-[#4F4A3F] hover:underline"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteMetricKey(rowKey)}
                                className="text-sm font-semibold text-[#D6453D] hover:underline"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Task Add / Edit Modal Panel */}
      {showTaskPanel && (
        <div className="fixed inset-0 z-50 bg-[#1F1B16]/40 flex items-center justify-center p-4">
          <div className="calm-card bg-white w-full max-w-lg p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#DDD5C4]">
              <h2 className="font-display text-xl font-bold text-[#1F1B16]">
                {editingTaskId ? 'Edit task' : 'Add task'}
              </h2>
              <button
                type="button"
                onClick={() => setShowTaskPanel(false)}
                className="text-[#1F1B16] hover:text-[#D6453D] p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="space-y-4">
              <div>
                <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                  Task title
                </label>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) =>
                    setTaskForm((p) => ({ ...p, title: e.target.value }))
                  }
                  placeholder="e.g. Audit registration form speed"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Owner
                  </label>
                  <input
                    type="text"
                    value={taskForm.owner}
                    onChange={(e) =>
                      setTaskForm((p) => ({ ...p, owner: e.target.value }))
                    }
                    placeholder="e.g. Priya"
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>

                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Deadline
                  </label>
                  <input
                    type="date"
                    value={taskForm.deadline || ''}
                    onChange={(e) =>
                      setTaskForm((p) => ({
                        ...p,
                        deadline: e.target.value || null,
                      }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Status
                  </label>
                  <select
                    value={taskForm.status}
                    onChange={(e) =>
                      setTaskForm((p) => ({
                        ...p,
                        status: e.target.value as TaskStatus,
                      }))
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  >
                    <option value="todo">To do</option>
                    <option value="in_progress">In progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Campaign (optional)
                  </label>
                  <select
                    value={taskForm.campaign_id || ''}
                    onChange={(e) =>
                      setTaskForm((p) => ({
                        ...p,
                        campaign_id: e.target.value || null,
                      }))
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  >
                    <option value="">General / None</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {taskFormError && (
                <p role="alert" className="text-sm text-[#D6453D] font-semibold">
                  {taskFormError}
                </p>
              )}

              <div className="pt-3 border-t border-[#DDD5C4] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowTaskPanel(false)}
                  className="calm-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyId === 'task-save'}
                  className="calm-btn-primary text-sm py-2"
                >
                  {busyId === 'task-save' ? 'Saving...' : 'Save task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Campaign Add / Edit Modal Panel */}
      {showCampaignPanel && (
        <div className="fixed inset-0 z-50 bg-[#1F1B16]/40 flex items-center justify-center p-4">
          <div className="calm-card bg-white w-full max-w-xl p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#DDD5C4]">
              <h2 className="font-display text-xl font-bold text-[#1F1B16]">
                {editingCampaignId ? 'Edit campaign' : 'Add campaign'}
              </h2>
              <button
                type="button"
                onClick={() => setShowCampaignPanel(false)}
                className="text-[#1F1B16] hover:text-[#D6453D] p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCampaign} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Code
                  </label>
                  <input
                    type="text"
                    value={campaignForm.code}
                    onChange={(e) =>
                      setCampaignForm((p) => ({ ...p, code: e.target.value }))
                    }
                    placeholder="C10"
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={campaignForm.name}
                    onChange={(e) =>
                      setCampaignForm((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="e.g. Campus Ambassador Blitz"
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Channel
                  </label>
                  <input
                    type="text"
                    value={campaignForm.channel}
                    onChange={(e) =>
                      setCampaignForm((p) => ({ ...p, channel: e.target.value }))
                    }
                    placeholder="e.g. WhatsApp"
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Segment
                  </label>
                  <input
                    type="text"
                    value={campaignForm.segment}
                    onChange={(e) =>
                      setCampaignForm((p) => ({ ...p, segment: e.target.value }))
                    }
                    placeholder="e.g. College Leads"
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Owner
                  </label>
                  <input
                    type="text"
                    value={campaignForm.owner}
                    onChange={(e) =>
                      setCampaignForm((p) => ({ ...p, owner: e.target.value }))
                    }
                    placeholder="e.g. Rahul"
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Kind
                  </label>
                  <select
                    value={campaignForm.kind}
                    onChange={(e) =>
                      setCampaignForm((p) => ({
                        ...p,
                        kind: e.target.value as CampaignKind,
                      }))
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  >
                    <option value="acquisition">Acquisition</option>
                    <option value="enabler">Enabler</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Status
                  </label>
                  <select
                    value={campaignForm.status}
                    onChange={(e) =>
                      setCampaignForm((p) => ({ ...p, status: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  >
                    <option value="active">Active</option>
                    <option value="planned">Planned</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Budget (INR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={campaignForm.budget}
                    onChange={(e) =>
                      setCampaignForm((p) => ({
                        ...p,
                        budget: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Target identified
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={campaignForm.target_identified}
                    onChange={(e) =>
                      setCampaignForm((p) => ({
                        ...p,
                        target_identified: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Target registrations
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={campaignForm.target_registrations}
                    onChange={(e) =>
                      setCampaignForm((p) => ({
                        ...p,
                        target_registrations: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Target attendees
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={campaignForm.target_attendees}
                    onChange={(e) =>
                      setCampaignForm((p) => ({
                        ...p,
                        target_attendees: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Assumed show-up
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={campaignForm.assumed_showup}
                    onChange={(e) =>
                      setCampaignForm((p) => ({
                        ...p,
                        assumed_showup: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Target show-up
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={campaignForm.target_showup}
                    onChange={(e) =>
                      setCampaignForm((p) => ({
                        ...p,
                        target_showup: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-[#4F4A3F] mb-1.5">
                    Planned start
                  </label>
                  <input
                    type="date"
                    value={campaignForm.planned_start || ''}
                    onChange={(e) =>
                      setCampaignForm((p) => ({
                        ...p,
                        planned_start: e.target.value || null,
                      }))
                    }
                    className="w-full px-3 py-2 text-sm tabular-nums bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
                  />
                </div>
              </div>

              {campaignFormError && (
                <p role="alert" className="text-sm text-[#D6453D] font-semibold">
                  {campaignFormError}
                </p>
              )}

              <div className="pt-3 border-t border-[#DDD5C4] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCampaignPanel(false)}
                  className="calm-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyId === 'campaign-save'}
                  className="calm-btn-primary text-sm py-2"
                >
                  {busyId === 'campaign-save' ? 'Saving...' : 'Save campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
