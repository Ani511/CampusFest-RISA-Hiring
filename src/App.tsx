import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigErrorBanner } from './components/ConfigErrorBanner';
import { DashboardTab } from './components/DashboardTab';
import { DiagnosisTab } from './components/DiagnosisTab';
import { ExecutionTab, type ExecutionSection } from './components/ExecutionTab';
import {
  GrowthChatDrawer,
  type ProposedTaskCard,
} from './components/GrowthChatDrawer';
import { formatShortDate } from './components/uiHelpers';
import { getSupabaseConnection } from './config/supabase';
import { computeGrowthAnalytics, formatNumber } from './lib/analytics';
import {
  createCampaign,
  createTask,
  deleteCampaign,
  deleteDailyMetric,
  deleteTask,
  fetchAllGrowthData,
  insertDailyMetric,
  updateCampaign,
  updateTask,
  type CampaignInput,
  type DailyMetricInput,
  type GrowthDataPayload,
  type TaskInput,
} from './lib/dataService';
import type { DailyMetric } from './types/growth';

type ActiveTab = 'dashboard' | 'diagnosis' | 'execution';

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'dashboard', label: 'Performance' },
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'execution', label: 'Tasks and campaigns' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [executionSection, setExecutionSection] =
    useState<ExecutionSection>('tasks');
  const [connectionTick, setConnectionTick] = useState(0);
  const [data, setData] = useState<GrowthDataPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [prefillRequest, setPrefillRequest] = useState<{
    id: number;
    prompt: string;
  } | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const connection = useMemo(() => {
    void connectionTick;
    return getSupabaseConnection();
  }, [connectionTick]);

  const loadData = useCallback(
    async (isBackgroundRefresh = false) => {
      if (!connection.client) {
        setLoading(false);
        setRefreshing(false);
        setError(connection.configError ?? 'Supabase client is not configured.');
        return;
      }

      if (isBackgroundRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const payload = await fetchAllGrowthData(connection.client);
        setData(payload);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load campaign data from Supabase.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [connection]
  );

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  const handleRetryConnection = () => {
    setConnectionTick((n) => n + 1);
  };

  const analytics = useMemo(() => {
    if (!data) return null;
    return computeGrowthAnalytics(
      data.campaigns,
      data.dailyMetrics,
      data.settings
    );
  }, [data]);

  const pageHeadline = useMemo(() => {
    if (!data || !analytics) {
      return 'CampusFest 2026 Growth Center';
    }

    if (activeTab === 'dashboard') {
      const proj = Math.round(analytics.summary.totalProjectedAttendees);
      const diff = proj - Math.round(data.settings.total_target_base);
      if (diff >= 0) {
        return `${formatNumber(proj)} projected so far, ${formatNumber(diff)} above the base target`;
      }
      return `${formatNumber(proj)} projected so far, ${formatNumber(Math.abs(diff))} short of the base target`;
    }

    if (activeTab === 'diagnosis') {
      const needAttention = analytics.diagnosis.filter(
        (d) => d.status === 'Underperforming' || d.status === 'At risk'
      );
      if (needAttention.length === 0) {
        const scoredCount = analytics.diagnosis.filter(
          (d) => d.status !== 'Planned'
        ).length;
        return `All ${scoredCount} active campaigns are on track`;
      }
      const topConcern = needAttention[0].computed.campaign.name;
      return `${needAttention.length} ${needAttention.length === 1 ? 'campaign needs' : 'campaigns need'} attention, ${topConcern} most of all`;
    }

    const asOf = data.settings.as_of_date;
    let overdueCount = 0;
    let openCount = 0;
    for (const t of data.tasks) {
      if (t.status !== 'done') {
        openCount += 1;
        if (t.deadline && asOf && t.deadline < asOf) {
          overdueCount += 1;
        }
      }
    }
    return `${overdueCount} ${overdueCount === 1 ? 'task' : 'tasks'} overdue, ${openCount} open`;
  }, [activeTab, data, analytics]);

  const contextSubtitle = useMemo(() => {
    if (!data || !analytics) {
      return 'Loading campaign data · Bengaluru';
    }
    const asOfFormatted = formatShortDate(data.settings.as_of_date, true);
    const eventFormatted = formatShortDate(data.settings.event_date, false);
    const daysLeft = analytics.summary.daysRemaining;
    return `As of ${asOfFormatted} · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to the event on ${eventFormatted} · Bengaluru`;
  }, [data, analytics]);

  const handleAskAnalyst = (prompt: string) => {
    setPrefillRequest({ id: Date.now(), prompt });
    setChatOpen(true);
  };

  const handleCreateCampaign = async (input: CampaignInput) => {
    if (!connection.client) throw new Error('Supabase not connected');
    await createCampaign(connection.client, input);
    await loadData(true);
  };

  const handleUpdateCampaign = async (id: string, input: CampaignInput) => {
    if (!connection.client) throw new Error('Supabase not connected');
    await updateCampaign(connection.client, id, input);
    await loadData(true);
  };

  const handleDeleteCampaign = async (id: string) => {
    if (!connection.client) throw new Error('Supabase not connected');
    await deleteCampaign(connection.client, id);
    await loadData(true);
  };

  const handleCreateTask = async (input: TaskInput) => {
    if (!connection.client || !data) throw new Error('Supabase not connected');
    await createTask(connection.client, input, data.taskSchemaHints);
    await loadData(true);
  };

  const handleUpdateTask = async (id: string, input: Partial<TaskInput>) => {
    if (!connection.client || !data) throw new Error('Supabase not connected');
    await updateTask(connection.client, id, input, data.taskSchemaHints);
    await loadData(true);
  };

  const handleDeleteTask = async (id: string) => {
    if (!connection.client) throw new Error('Supabase not connected');
    await deleteTask(connection.client, id);
    await loadData(true);
  };

  const handleInsertDailyMetric = async (input: DailyMetricInput) => {
    if (!connection.client) throw new Error('Supabase not connected');
    await insertDailyMetric(connection.client, input);
    await loadData(true);
  };

  const handleDeleteDailyMetric = async (metric: DailyMetric) => {
    if (!connection.client) throw new Error('Supabase not connected');
    await deleteDailyMetric(connection.client, metric);
    await loadData(true);
  };

  const handleConfirmProposedTask = async (proposal: ProposedTaskCard) => {
    if (!connection.client) throw new Error('Supabase not connected');
    const hints = data?.taskSchemaHints ?? {
      titleCol: 'title',
      deadlineCol: 'deadline',
      campaignCol: 'campaign_id',
    };
    await createTask(
      connection.client,
      {
        title: proposal.title,
        status: 'todo',
        owner: proposal.owner,
        deadline: proposal.deadline || null,
        campaign_id: proposal.campaign_id,
        created_by: 'chatbot',
      },
      hints
    );
    await loadData(true);
    showToast('Task added');
  };

  return (
    <div className="min-h-screen bg-[#FFFEF7] text-[#1F1B16] flex flex-col min-[900px]:flex-row">
      {/* Sidebar: 232px, paper background, 1px right border */}
      <aside
        aria-label="Primary navigation"
        className="w-full min-[900px]:w-[232px] min-[900px]:shrink-0 bg-[#FFFEF7] border-b min-[900px]:border-b-0 min-[900px]:border-r border-[#DDD5C4] min-[900px]:sticky min-[900px]:top-0 min-[900px]:h-screen flex flex-col justify-between"
      >
        <div className="px-6 py-6 min-[900px]:py-8 flex flex-row min-[900px]:flex-col items-center min-[900px]:items-stretch justify-between gap-6">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('dashboard');
            }}
            className="text-left whitespace-nowrap shrink-0"
          >
            <div className="font-display text-lg font-bold text-[#1F1B16] leading-tight">
              CampusFest 2026
            </div>
            <div className="text-[13px] text-[#4F4A3F]">Growth Center</div>
          </a>

          <nav
            aria-label="Workspace sections"
            className="flex flex-row min-[900px]:flex-col items-center min-[900px]:items-stretch gap-1 min-[900px]:mt-6 overflow-x-auto"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`text-left px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? 'bg-[#FEF9E7] text-[#1F1B16] border-l-4 border-l-[#F4C430]'
                      : 'text-[#4F4A3F] hover:text-[#1F1B16] hover:bg-[#F8F6F0]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden min-[900px]:block px-6 py-6 border-t border-[#DDD5C4] space-y-3">
          {data && (
            <div className="text-[13px] text-[#6C757D] tabular-nums leading-snug">
              {data.campaigns.length} campaigns · {data.tasks.length} tasks
            </div>
          )}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={loading || refreshing || !connection.client}
            className="w-full px-3 py-2 text-[13px] font-semibold text-[#1F1B16] bg-white border border-[#DDD5C4] hover:border-[#3B4A8C] disabled:opacity-50 rounded-lg whitespace-nowrap"
          >
            {refreshing ? 'Syncing data...' : 'Refresh data'}
          </button>
        </div>
      </aside>

      {/* Main Content Area (with 96px bottom padding so chat button never covers content) */}
      <div id="top" className="flex-1 min-w-0 pb-32">
        <main className="max-w-[1240px] mx-auto px-6 py-8">
          {/* Page Header with "21 days to go" sticker */}
          <header className="mb-8 pb-6 border-b border-[#DDD5C4] flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-4xl space-y-2">
              <span className="calm-sticker">
                21 days to go
              </span>
              <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#1F1B16] leading-tight headline-balance">
                {pageHeadline}
              </h1>
              <p className="text-sm text-[#4F4A3F] tabular-nums">
                {contextSubtitle}
              </p>
            </div>

            {!loading && !error && data && activeTab === 'dashboard' && (
              <button
                type="button"
                onClick={() => {
                  setExecutionSection('metrics');
                  setActiveTab('execution');
                }}
                className="calm-btn-primary"
              >
                Log today's numbers
              </button>
            )}
          </header>

          {/* Skeleton Loading State */}
          {loading && (
            <div className="space-y-8" aria-busy="true" aria-label="Loading data">
              <div className="calm-card p-6 h-80 animate-pulse">
                <div className="h-6 w-56 bg-[#DDD5C4] rounded-lg" />
                <div className="mt-3 h-4 w-96 max-w-full bg-[#ECE6D8] rounded-lg" />
                <div className="mt-8 h-44 w-full bg-[#F8F6F0] rounded-lg" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="calm-card p-6 h-36 animate-pulse"
                  >
                    <div className="h-4 w-24 bg-[#DDD5C4] rounded-lg" />
                    <div className="mt-4 h-9 w-28 bg-[#DDD5C4] rounded-lg" />
                    <div className="mt-4 h-4 w-40 bg-[#ECE6D8] rounded-lg" />
                  </div>
                ))}
              </div>

              <div className="calm-card p-6 space-y-3 animate-pulse">
                <div className="h-5 w-48 bg-[#DDD5C4] rounded-lg" />
                {Array.from({ length: 5 }).map((_, idx) => (
                  <div key={idx} className="h-10 w-full bg-[#F8F6F0] rounded-lg" />
                ))}
              </div>
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <ConfigErrorBanner
              errorMessage={error}
              currentUrl={connection.url}
              currentKey={connection.anonKey}
              isUsingOverride={connection.isUsingOverride}
              onRetry={handleRetryConnection}
            />
          )}

          {/* Active Section */}
          {!loading && !error && data && analytics && (
            <>
              {activeTab === 'dashboard' && (
                <DashboardTab
                  campaignRows={analytics.campaignRows}
                  dailyMetrics={data.dailyMetrics}
                  summary={analytics.summary}
                  settings={data.settings}
                />
              )}

              {activeTab === 'diagnosis' && (
                <DiagnosisTab
                  diagnosis={analytics.diagnosis}
                  campaignRows={analytics.campaignRows}
                  summary={analytics.summary}
                  settings={data.settings}
                  onAskAnalyst={handleAskAnalyst}
                />
              )}

              {activeTab === 'execution' && (
                <ExecutionTab
                  campaigns={data.campaigns}
                  dailyMetrics={data.dailyMetrics}
                  tasks={data.tasks}
                  settings={data.settings}
                  initialSection={executionSection}
                  onSectionChange={setExecutionSection}
                  onNotify={showToast}
                  onCreateCampaign={handleCreateCampaign}
                  onUpdateCampaign={handleUpdateCampaign}
                  onDeleteCampaign={handleDeleteCampaign}
                  onCreateTask={handleCreateTask}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDeleteTask}
                  onInsertDailyMetric={handleInsertDailyMetric}
                  onDeleteDailyMetric={handleDeleteDailyMetric}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-6 z-50 px-4 py-3 text-sm font-semibold bg-[#1F1B16] text-white rounded-lg shadow-lg"
        >
          {toastMessage}
        </div>
      )}

      {/* Analyst Chat Drawer */}
      <GrowthChatDrawer
        isOpen={chatOpen}
        onOpenChange={setChatOpen}
        prefillRequest={prefillRequest}
        onConfirmProposedTask={handleConfirmProposedTask}
        onNavigateToTasks={() => {
          setExecutionSection('tasks');
          setActiveTab('execution');
        }}
      />
    </div>
  );
}
