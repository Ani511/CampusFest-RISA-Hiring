import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import { getActiveSupabaseCredentials } from '../config/supabase';
import { ConfettiBurst, formatShortDate } from './uiHelpers';

const MODEL_STORAGE_KEY = 'growth_chat_model';
const STREAM_IDLE_TIMEOUT_MS = 90_000;

export interface ProposedTaskCard {
  id: string;
  title: string;
  owner: string;
  deadline: string;
  campaign: string;
  campaign_id: string | null;
  campaign_name: string | null;
  reason: string;
  decision?: 'pending' | 'confirmed' | 'cancelled';
}

interface ModelOption {
  id: string;
  displayName?: string;
}

interface ChatUiMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  statusCode?: number;
  errorDetail?: string;
  retryPrompt?: string;
  toolsCalled?: string[];
  modelUsed?: string;
  proposals?: ProposedTaskCard[];
}

interface GrowthChatDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  prefillRequest?: { id: number; prompt: string } | null;
  onConfirmProposedTask: (proposal: ProposedTaskCard) => Promise<void>;
  onNavigateToTasks: () => void;
}

const STARTER_QUESTIONS = [
  'How are we pacing against the targets?',
  'Which campaign needs attention first?',
  'What did we spend per attendee in 2025?',
];

interface SsePayloadDone {
  reply?: string;
  history?: unknown[];
  proposals?: ProposedTaskCard[];
  toolsCalled?: string[];
  modelUsed?: string;
  availableModels?: ModelOption[];
}

function readStoredModel(): string | null {
  try {
    return window.localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredModel(modelId: string): void {
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  } catch {
    // Ignore storage errors
  }
}

function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-[#1F1B16]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function renderFormattedAnalystMessage(rawText: string): React.ReactNode {
  const lines = rawText.split('\n');
  const sectionLabels = new Set([
    'evidence',
    'assumption',
    'assumptions',
    'recommendation',
    'recommendations',
    'finding',
    'numbers',
  ]);

  return (
    <div className="space-y-2 text-base text-[#1F1B16] leading-relaxed">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) {
          return <div key={idx} className="h-1" aria-hidden="true" />;
        }

        const headingCleaned = line.replace(/^#{1,4}\s+/, '');
        const isHeadingLine = line.startsWith('#') || /^\*\*[^*]+:?\*\*$/.test(line);
        const labelCandidate = headingCleaned
          .replace(/^\*\*|\*\*$/g, '')
          .replace(/:$/, '')
          .trim()
          .toLowerCase();

        if (isHeadingLine && sectionLabels.has(labelCandidate)) {
          const prettyLabel =
            labelCandidate.charAt(0).toUpperCase() + labelCandidate.slice(1);
          return (
            <div key={idx} className="pt-2 font-semibold text-[#4F4A3F]">
              {prettyLabel}
            </div>
          );
        }

        const prefixMatch = headingCleaned.match(
          /^(?:\*\*)?(Evidence|Assumption|Assumptions|Recommendation|Recommendations|Finding|Numbers):(?:\*\*)?\s*(.*)$/i
        );
        if (prefixMatch) {
          const title =
            prefixMatch[1].charAt(0).toUpperCase() +
            prefixMatch[1].slice(1).toLowerCase();
          const rest = prefixMatch[2];
          return (
            <p key={idx} className="my-1">
              <strong className="font-semibold text-[#4F4A3F]">{title}:</strong>{' '}
              {renderInlineBold(rest)}
            </p>
          );
        }

        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={idx} className="pl-4 relative my-1">
              <span
                aria-hidden="true"
                className="absolute left-1 top-0 text-[#6C757D]"
              >
                ·
              </span>
              <span>{renderInlineBold(line.slice(2))}</span>
            </div>
          );
        }

        return <p key={idx} className="my-1">{renderInlineBold(headingCleaned)}</p>;
      })}
    </div>
  );
}

export const GrowthChatDrawer: React.FC<GrowthChatDrawerProps> = ({
  isOpen,
  onOpenChange,
  prefillRequest,
  onConfirmProposedTask,
  onNavigateToTasks,
}) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [geminiHistory, setGeminiHistory] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Thinking...');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(
    () => readStoredModel() ?? ''
  );

  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const applyModelList = useCallback((nextModels: ModelOption[]) => {
    if (!Array.isArray(nextModels) || nextModels.length === 0) {
      setModels([]);
      return;
    }
    setModels(nextModels);
    setSelectedModel((prev) => {
      const stored = prev || readStoredModel();
      if (stored && nextModels.some((m) => m.id === stored)) {
        return stored;
      }
      const fallback = nextModels[0].id;
      writeStoredModel(fallback);
      return fallback;
    });
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/models');
      if (!res.ok) return;
      const data = (await res.json()) as { models?: ModelOption[] };
      if (Array.isArray(data.models)) {
        applyModelList(data.models);
      }
    } catch {
      // Non-fatal
    }
  }, [applyModelList]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (isOpen && models.length === 0) {
      void loadModels();
    }
  }, [isOpen, models.length, loadModels]);

  useEffect(() => {
    if (prefillRequest && prefillRequest.prompt) {
      setInput(prefillRequest.prompt);
      window.setTimeout(() => {
        textareaRef.current?.focus();
      }, 40);
    }
  }, [prefillRequest]);

  useEffect(() => {
    if (isOpen) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, loadingLabel, isOpen]);

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value;
    setSelectedModel(nextId);
    writeStoredModel(nextId);
  };

  const appendErrorBubble = (
    statusCode: number | undefined,
    rawMessage: string,
    retryPrompt: string
  ) => {
    const isRateLimit =
      statusCode === 429 ||
      rawMessage.includes('429') ||
      rawMessage.toLowerCase().includes('rate limit') ||
      rawMessage.includes('RESOURCE_EXHAUSTED');

    const text = isRateLimit
      ? 'Rate limit hit, retry in a minute'
      : statusCode
        ? `Error ${statusCode}: ${rawMessage}`
        : rawMessage;

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'error',
        text,
        statusCode: isRateLimit ? 429 : statusCode,
        errorDetail: isRateLimit ? rawMessage : undefined,
        retryPrompt,
      },
    ]);
  };

  const sendMessage = async (rawText: string, skipUserBubble = false) => {
    const trimmed = rawText.trim();
    if (!trimmed || loading) return;

    if (!skipUserBubble) {
      setInput('');
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'user',
          text: trimmed,
        },
      ]);
    }

    setLoading(true);
    setLoadingLabel(
      selectedModel ? `Calling ${selectedModel}...` : 'Thinking...'
    );

    const controller = new AbortController();
    let watchdog = window.setTimeout(
      () => controller.abort(),
      STREAM_IDLE_TIMEOUT_MS
    );
    const bumpWatchdog = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(
        () => controller.abort(),
        STREAM_IDLE_TIMEOUT_MS
      );
    };

    try {
      const creds = getActiveSupabaseCredentials();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          history: geminiHistory,
          model: selectedModel || undefined,
          supabaseCredentials: {
            url: creds.url,
            anonKey: creds.anonKey,
          },
        }),
      });

      bumpWatchdog();
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || !contentType.includes('text/event-stream')) {
        let payload: { status?: number; error?: string } & SsePayloadDone = {};
        try {
          payload = await response.json();
        } catch {
          // ignore
        }
        if (Array.isArray(payload.availableModels)) {
          applyModelList(payload.availableModels);
        }
        if (!response.ok) {
          appendErrorBubble(
            payload.status ?? response.status,
            payload.error || response.statusText || 'Request failed',
            trimmed
          );
          return;
        }
        const proposals: ProposedTaskCard[] = Array.isArray(payload.proposals)
          ? payload.proposals.map((p) => ({
              ...p,
              decision: 'pending' as const,
            }))
          : [];
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: payload.reply || 'No response returned.',
            toolsCalled: Array.isArray(payload.toolsCalled)
              ? payload.toolsCalled
              : [],
            modelUsed: payload.modelUsed,
            proposals,
          },
        ]);
        if (Array.isArray(payload.history)) {
          setGeminiHistory(payload.history);
        }
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        appendErrorBubble(500, 'Readable stream unavailable from server.', trimmed);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let receivedTerminalEvent = false;

      const processFrame = (frame: string) => {
        const lines = frame.split('\n');
        let eventName = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length === 0) return;
        const dataStr = dataLines.join('\n');
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(dataStr) as Record<string, unknown>;
        } catch {
          return;
        }

        bumpWatchdog();

        if (eventName === 'tool_start') {
          const toolName = String(parsed.tool ?? '').trim();
          if (toolName) {
            setLoadingLabel(`Calling ${toolName}...`);
          }
        } else if (eventName === 'status') {
          const statusMsg = String(parsed.message ?? '').trim();
          if (statusMsg) {
            setLoadingLabel(statusMsg);
          }
        } else if (eventName === 'done') {
          receivedTerminalEvent = true;
          const payload = parsed as SsePayloadDone;
          if (Array.isArray(payload.availableModels)) {
            applyModelList(payload.availableModels);
          }
          const proposals: ProposedTaskCard[] = Array.isArray(payload.proposals)
            ? payload.proposals.map((p) => ({
                ...p,
                decision: 'pending' as const,
              }))
            : [];
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: payload.reply || 'No response returned.',
              toolsCalled: Array.isArray(payload.toolsCalled)
                ? payload.toolsCalled
                : [],
              modelUsed: payload.modelUsed,
              proposals,
            },
          ]);
          if (Array.isArray(payload.history)) {
            setGeminiHistory(payload.history);
          }
        } else if (eventName === 'error') {
          receivedTerminalEvent = true;
          if (Array.isArray(parsed.availableModels)) {
            applyModelList(parsed.availableModels as ModelOption[]);
          }
          const status =
            typeof parsed.status === 'number' ? parsed.status : 500;
          const errMsg = String(parsed.error ?? 'Unexpected server error.');
          appendErrorBubble(status, errMsg, trimmed);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bumpWatchdog();
        buffer += decoder.decode(value, { stream: true });

        let boundaryIdx = buffer.indexOf('\n\n');
        while (boundaryIdx !== -1) {
          const frame = buffer.slice(0, boundaryIdx).trim();
          buffer = buffer.slice(boundaryIdx + 2);
          if (frame) processFrame(frame);
          boundaryIdx = buffer.indexOf('\n\n');
        }
      }

      if (buffer.trim()) {
        processFrame(buffer.trim());
      }

      if (!receivedTerminalEvent) {
        appendErrorBubble(
          500,
          'Connection closed before receiving a final response.',
          trimmed
        );
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      appendErrorBubble(
        isAbort ? 504 : undefined,
        isAbort
          ? 'Request timed out while waiting for the server.'
          : err instanceof Error
            ? err.message
            : 'Unable to reach analyst.',
        trimmed
      );
    } finally {
      window.clearTimeout(watchdog);
      setLoading(false);
      setLoadingLabel('Thinking...');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const handleConfirmProposal = async (
    messageId: string,
    proposal: ProposedTaskCard
  ) => {
    setConfirmingId(proposal.id);
    try {
      await onConfirmProposedTask(proposal);
      setShowConfetti(true);
      setMessages((prev) =>
        prev.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                proposals: m.proposals?.map((p) =>
                  p.id === proposal.id
                    ? { ...p, decision: 'confirmed' as const }
                    : p
                ),
              }
        )
      );
    } catch (err) {
      appendErrorBubble(
        undefined,
        err instanceof Error ? err.message : 'Failed to create proposed task.',
        ''
      );
    } finally {
      setConfirmingId(null);
    }
  };

  const handleCancelProposal = (messageId: string, proposalId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id !== messageId
          ? m
          : {
              ...m,
              proposals: m.proposals?.map((p) =>
                p.id === proposalId
                  ? { ...p, decision: 'cancelled' as const }
                  : p
              ),
            }
      )
    );
  };

  const handleClear = () => {
    setMessages([]);
    setGeminiHistory([]);
  };

  return (
    <>
      <ConfettiBurst active={showConfetti} onComplete={() => setShowConfetti(false)} />

      {/* Floating Button Bottom-Right: 40px high, 14px, white on indigo #3B4A8C, 24px margin */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="fixed bottom-6 right-6 z-40 px-4 h-10 text-[14px] font-semibold text-white bg-[#3B4A8C] hover:bg-[#2F3B70] rounded-lg shadow-md whitespace-nowrap shrink-0 flex items-center justify-center"
        >
          Ask the analyst
        </button>
      )}

      {/* 420px Side Drawer: white, 1px left border */}
      {isOpen && (
        <aside
          aria-label="Growth analyst chat"
          className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-white border-l border-[#DDD5C4] shadow-2xl flex flex-col"
        >
          {/* Drawer Header */}
          <div className="px-5 py-4 border-b border-[#DDD5C4] bg-[#FFFEF7] flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-[#1F1B16]">
                Growth analyst
              </h2>
              <p className="text-[13px] text-[#4F4A3F] truncate">
                Live numbers from 2026 and 2025
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                aria-label="Select AI model"
                value={selectedModel}
                onChange={handleModelChange}
                disabled={loading || models.length === 0}
                title="Select Gemini model"
                className="max-w-[130px] px-2 py-1 text-[13px] bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16] disabled:opacity-60 truncate"
              >
                {models.length === 0 ? (
                  <option value="">No models</option>
                ) : (
                  models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))
                )}
              </select>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  title="Clear conversation"
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[13px] font-medium text-[#4F4A3F] hover:text-[#1F1B16] whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close analyst chat"
                className="p-1.5 text-[#4F4A3F] hover:text-[#1F1B16] rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-[#FFFEF7]">
            {messages.length === 0 && (
              <div className="space-y-4 py-2">
                <p className="text-base text-[#1F1B16] leading-relaxed">
                  Ask about target pacing, campaign bottlenecks, budget moves, open tasks, or 2025 attendance data.
                </p>
                <div className="space-y-2">
                  <div className="text-[14px] font-semibold text-[#4F4A3F]">
                    Suggested questions
                  </div>
                  <div className="space-y-2">
                    {STARTER_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => void sendMessage(q)}
                        className="w-full text-left px-3.5 py-2.5 text-sm text-[#1F1B16] bg-white border border-[#DDD5C4] hover:border-[#3B4A8C] rounded-lg transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === 'error') {
                return (
                  <div
                    key={msg.id}
                    role="alert"
                    className="bg-[#FDF2F2] border border-[#D6453D] rounded-lg px-4 py-3 text-sm text-[#D6453D] space-y-2"
                  >
                    <div className="font-semibold">{msg.text}</div>
                    {msg.errorDetail && (
                      <div className="text-[13px] break-words">
                        {msg.statusCode ? `HTTP ${msg.statusCode}: ` : ''}
                        {msg.errorDetail}
                      </div>
                    )}
                    {msg.retryPrompt && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void sendMessage(msg.retryPrompt!, true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold text-white bg-[#D6453D] hover:bg-[#b53832] rounded-lg"
                      >
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                        Retry
                      </button>
                    )}
                  </div>
                );
              }

              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] px-4 py-3 text-base text-white bg-[#3B4A8C] rounded-lg whitespace-pre-wrap leading-relaxed">
                      {msg.text}
                    </div>
                  </div>
                );
              }

              const uniqueTools = msg.toolsCalled
                ? [...new Set(msg.toolsCalled)]
                : [];

              return (
                <div key={msg.id} className="space-y-3">
                  <div className="bg-white border border-[#DDD5C4] rounded-lg px-4 py-4 space-y-2">
                    {renderFormattedAnalystMessage(msg.text)}

                    {(uniqueTools.length > 0 || msg.modelUsed) && (
                      <div className="mt-3 pt-2.5 border-t border-[#ECE6D8] flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#6C757D]">
                        {uniqueTools.length > 0 && (
                          <span>Used: {uniqueTools.join(', ')}</span>
                        )}
                        {msg.modelUsed && <span>{msg.modelUsed}</span>}
                      </div>
                    )}
                  </div>

                  {/* Task Proposals */}
                  {msg.proposals &&
                    msg.proposals.map((p) => {
                      if (p.decision === 'confirmed') {
                        return (
                          <div
                            key={p.id}
                            className="bg-white border border-[#DDD5C4] border-l-4 border-l-[#2A9D8F] rounded-lg px-4 py-3 flex items-center justify-between gap-3"
                          >
                            <span className="text-sm font-semibold text-[#2A9D8F]">
                              Task created
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onNavigateToTasks();
                                onOpenChange(false);
                              }}
                              className="text-sm font-semibold text-[#3B4A8C] hover:underline whitespace-nowrap shrink-0"
                            >
                              View in Tasks
                            </button>
                          </div>
                        );
                      }

                      if (p.decision === 'cancelled') {
                        return (
                          <div
                            key={p.id}
                            className="bg-white border border-[#DDD5C4] rounded-lg px-4 py-3 text-sm text-[#6C757D]"
                          >
                            Task dismissed: {p.title}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={p.id}
                          style={{ borderLeft: '4px solid #F4C430' }}
                          className="bg-white border border-[#DDD5C4] rounded-lg p-4 space-y-3"
                        >
                          <div className="text-[13px] font-semibold text-[#4F4A3F]">
                            Proposed task
                          </div>

                          <div className="text-base font-semibold text-[#1F1B16]">
                            {p.title}
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <span className="text-[#6C757D] block text-xs">Owner</span>
                              <span className="font-medium text-[#1F1B16]">
                                {p.owner || 'Unassigned'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[#6C757D] block text-xs">
                                Deadline
                              </span>
                              <span className="tabular-nums font-medium text-[#1F1B16]">
                                {formatShortDate(p.deadline)}
                              </span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-[#6C757D] block text-xs">
                                Campaign
                              </span>
                              <span className="font-medium text-[#1F1B16]">
                                {p.campaign}
                              </span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-[#6C757D] block text-xs">Reason</span>
                              <span className="text-[#1F1B16]">{p.reason}</span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-[#ECE6D8] flex items-center gap-4">
                            <button
                              type="button"
                              disabled={confirmingId === p.id}
                              onClick={() => handleConfirmProposal(msg.id, p)}
                              className="calm-btn-primary text-sm py-2 disabled:opacity-60"
                            >
                              {confirmingId === p.id
                                ? 'Creating...'
                                : 'Create this task'}
                            </button>
                            <button
                              type="button"
                              disabled={confirmingId === p.id}
                              onClick={() =>
                                handleCancelProposal(msg.id, p.id)
                              }
                              className="text-sm font-semibold text-[#3B4A8C] hover:underline whitespace-nowrap shrink-0"
                            >
                              Not now
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}

            {loading && (
              <div className="bg-white border border-[#DDD5C4] rounded-lg px-4 py-3 text-sm text-[#4F4A3F] flex items-center gap-2">
                <Loader2
                  className="w-4 h-4 animate-spin text-[#3B4A8C] shrink-0"
                  aria-hidden="true"
                />
                <span>{loadingLabel}</span>
              </div>
            )}

            <div ref={scrollEndRef} />
          </div>

          {/* Input Area */}
          <form
            onSubmit={handleSubmit}
            className="p-4 border-t border-[#DDD5C4] bg-[#FFFEF7] shrink-0"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about pacing, bottlenecks, 2025 data, or tasks..."
                aria-label="Ask the analyst"
                className="flex-1 resize-none px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16] placeholder:text-[#6C757D]"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Send message"
                className="inline-flex items-center justify-center p-2.5 text-white bg-[#3B4A8C] hover:bg-[#2F3B70] disabled:opacity-50 rounded-lg shrink-0"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </form>
        </aside>
      )}
    </>
  );
};
