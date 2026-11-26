import {
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type Part,
} from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../src/config/supabase.js';
import {
  executeGrowthTool,
  growthToolDeclarations,
  TimeoutError,
  withTimeout,
  type ProposedTaskPayload,
  type ToolExecutionContext,
} from './growthTools.js';
import {
  createGeminiClient,
  dropModelFromList,
  getAvailableModels,
  type GeminiModelInfo,
} from './modelRegistry.js';

const GEMINI_TIMEOUT_MS = 30_000;
const MAX_TOOL_ROUNDS = 6;
const RETRY_DELAYS_MS = [2000, 4000, 8000] as const;

const GROWTH_ANALYST_SYSTEM_INSTRUCTION = `You are the Growth Analyst for CampusFest 2026. Rules:
1. Answer only from tool results. Always call a tool before stating any number, and quote the figures and campaign names you used.
2. Label statements "Evidence" (from data) or "Assumption" (your inference). Never present an assumption as a fact.
3. If the data does not contain what is needed (for example colleges, demographics, ad creatives, revenue, NPS, competitors, weather, individual people), say exactly what is missing and do not guess. Suggest what data to collect.
4. Recommend actions as scale / change / stop with numbers.
5. Never say a task exists until the user confirms the proposal card.
6. Re-query tools on every question, since data may have changed. Treat settings.as_of_date as "today".
7. Impressions, reach, clicks and sessions are anonymous counts, not people. Attendance means admitted + verified, external only.
8. If a question assumes something the data contradicts, open with a one-line verdict that starts with 'No:' or 'Not quite:' and gives the key numbers (target attainment, cost per expected attendee, show-up rate). Then state which part of the premise is partly true, if any. Your recommendation must be consistent with the verdict and the cost numbers; never recommend scaling a campaign that is below target and more expensive per expected attendee. In comparisons, always say which side is better for each metric.
9. Keep answers short: finding first, numbers second, recommendation third.
10. When asked how a number is computed, explain it only from the components a tool returned. Never invent or estimate intermediate numbers. If a component isn't returned, call another tool or say it isn't available.
11. Projected attendees = (registrations to date + 7-day average daily registrations x days remaining) x assumed_showup, plus walk-ins. Net confirmed is shown separately and is not part of the projection.
12. When explaining why a campaign projects low or high, state the biggest driver from the returned inputs (show-up rate, registration pace, identified->registered rate, cancel rate), and mention the assumed_showup when it is below 70%.
13. Only recommend actions the data supports; do not refer to budget changes or plans that are not in the data.
14. When comparing campaign efficiency, always use "cost per expected attendee to date" = spend to date / (registrations to date x assumed_showup), and mention "INR per projected attendee (at full-event projection)" only if asked. In every comparison, explicitly state which campaign is better on each metric.
15. To explain a drop in registrations, first compare the upstream funnel stages (impressions, clicks, sessions, registration starts, registrations) between the last 7 days and the previous 7 days, and name the stage where the rate fell. State causes that the data supports as Evidence. Any cause not supported by these numbers (ad fatigue, creative quality, audience saturation) must be labelled Assumption and must not contradict the stage data.
16. Check list_tasks for existing tasks on the same campaign and mention them, e.g. an overdue related task.
17. Before calling propose_task, call list_tasks for the same campaign. If an open task already covers the action, do not propose a duplicate. Instead recommend completing it, and propose a different task only if something new is needed (for example "Escalate overdue audit, new deadline" with the campaign owner, deadline within 3 days of as_of_date, campaign, reason).
18. When recommending a concrete new action not already covered by an open task, call propose_task for it in the same reply (title, owner = the campaign owner, deadline within 3 days of as_of_date, campaign, reason). Say "Please confirm the task card." ONLY when propose_task was actually called in this reply; if propose_task was not called, never say "Please confirm the task card."
19. If the user types "confirm" or "yes" but there is no pending proposal, ask which task to propose.
20. When calling simulate_budget_move, if move_possible_as_asked is false, explicitly state that the move is not possible as asked, report the source campaign's remaining unspent budget (budget - spend to date), present the simulation (both attendee impact and budget impact) for the maximum feasible amount labelled as Assumption, and report how both campaigns' new budgets compare with the plan (planned budget, new budget, change vs plan).`;

export class ChatApiError extends Error {
  statusCode: number;
  availableModels?: GeminiModelInfo[];
  constructor(
    statusCode: number,
    message: string,
    availableModels?: GeminiModelInfo[]
  ) {
    super(message);
    this.name = 'ChatApiError';
    this.statusCode = statusCode;
    this.availableModels = availableModels;
  }
}

export function extractApiError(err: unknown): {
  statusCode: number;
  message: string;
} {
  if (err instanceof ChatApiError) {
    return { statusCode: err.statusCode, message: err.message };
  }
  if (err instanceof TimeoutError) {
    return { statusCode: 504, message: err.message };
  }

  const rawMsg = err instanceof Error ? err.message : String(err);
  let statusCode = 500;
  let cleanMessage = rawMsg;

  const anyErr = err as Record<string, unknown> | null;
  if (anyErr && typeof anyErr.status === 'number') {
    statusCode = anyErr.status;
  } else if (anyErr && typeof anyErr.statusCode === 'number') {
    statusCode = anyErr.statusCode;
  }

  // @google/genai often embeds JSON payload inside Error.message
  try {
    const jsonStart = rawMsg.indexOf('{');
    if (jsonStart !== -1) {
      const parsed = JSON.parse(rawMsg.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed?.error) {
        if (typeof parsed.error.code === 'number') {
          statusCode = parsed.error.code;
        }
        if (parsed.error.message) {
          cleanMessage = parsed.error.message;
        }
      }
    }
  } catch {
    // Keep raw message if not JSON
  }

  if (statusCode === 500) {
    if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) {
      statusCode = 429;
    } else if (rawMsg.includes('404') || rawMsg.includes('NOT_FOUND')) {
      statusCode = 404;
    } else if (rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE')) {
      statusCode = 503;
    } else if (rawMsg.includes('403') || rawMsg.includes('PERMISSION_DENIED')) {
      statusCode = 403;
    } else if (rawMsg.includes('400') || rawMsg.includes('INVALID_ARGUMENT')) {
      statusCode = 400;
    } else if (
      rawMsg.toLowerCase().includes('timed out') ||
      rawMsg.toLowerCase().includes('aborted') ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      statusCode = 504;
    }
  }

  return { statusCode, message: cleanMessage };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ChatTurnRequest {
  message: string;
  history?: Content[];
  model?: string;
  supabaseCredentials?: {
    url?: string;
    anonKey?: string;
  };
  onToolStart?: (toolName: string) => void;
  onStatus?: (statusMessage: string) => void;
}

export interface ChatTurnResponse {
  reply: string;
  history: Content[];
  proposals: ProposedTaskPayload[];
  toolsCalled: string[];
  modelUsed: string;
  availableModels: GeminiModelInfo[];
}

export async function runGrowthChatTurn(
  req: ChatTurnRequest
): Promise<ChatTurnResponse> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ChatApiError(
      500,
      'GEMINI_API_KEY is not configured in the server environment.'
    );
  }

  const { models: storedModels, error: listError } = await getAvailableModels();
  if (storedModels.length === 0) {
    throw new ChatApiError(
      503,
      listError ||
        'No eligible Gemini models supporting generateContent and function calling are currently available.',
      []
    );
  }

  // Order models to try for this turn: selected dropdown model first, then remaining ordered models
  const requestedModel = req.model?.replace(/^models\//, '').trim();
  const orderedIds = storedModels.map((m) => m.id);
  const candidateQueue: string[] =
    requestedModel && orderedIds.includes(requestedModel)
      ? [requestedModel, ...orderedIds.filter((id) => id !== requestedModel)]
      : [...orderedIds];

  const sbUrl = req.supabaseCredentials?.url?.trim() || SUPABASE_URL;
  const sbKey = req.supabaseCredentials?.anonKey?.trim() || SUPABASE_ANON_KEY;
  const supabase = createClient(sbUrl, sbKey);
  const ai: GoogleGenAI = createGeminiClient(apiKey);

  const contents: Content[] = Array.isArray(req.history)
    ? [...req.history]
    : [];
  contents.push({
    role: 'user',
    parts: [{ text: req.message }],
  });

  const ctx: ToolExecutionContext = {
    supabase,
    proposals: [],
    toolsCalled: [],
  };

  let currentQueueIdx = 0;

  const callSingleAttempt = async (
    model: string,
    withTools: boolean,
    inputContents: Content[]
  ) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    const useLowThinking =
      model.startsWith('gemini-4-') && !model.includes('flash-lite');

    try {
      return await withTimeout(
        ai.models.generateContent({
          model,
          contents: inputContents,
          config: {
            abortSignal: controller.signal,
            systemInstruction: GROWTH_ANALYST_SYSTEM_INSTRUCTION,
            ...(useLowThinking
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
            ...(withTools
              ? { tools: [{ functionDeclarations: growthToolDeclarations }] }
              : {}),
          },
        }),
        GEMINI_TIMEOUT_MS,
        `Gemini ${model} call`
      );
    } catch (err) {
      if (err instanceof TimeoutError) throw err;
      if (controller.signal.aborted) {
        throw new TimeoutError(
          `Gemini ${model} call timed out after ${GEMINI_TIMEOUT_MS / 1000}s`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const callGeminiWithRetryAndFallback = async (
    withTools: boolean,
    inputContents: Content[]
  ): Promise<{ response: Awaited<ReturnType<typeof callSingleAttempt>>; modelUsed: string }> => {
    let lastError: { statusCode: number; message: string } = {
      statusCode: 500,
      message: 'All available models failed.',
    };

    while (currentQueueIdx < candidateQueue.length) {
      const model = candidateQueue[currentQueueIdx];
      let moveToNextModel = false;

      // Attempt 0 + up to 3 retries (2s, 4s, 8s) on 503 or 429
      for (let retryIdx = 0; retryIdx <= RETRY_DELAYS_MS.length; retryIdx++) {
        try {
          req.onStatus?.(`Calling ${model}...`);
          const response = await callSingleAttempt(model, withTools, inputContents);
          return { response, modelUsed: model };
        } catch (err) {
          const parsed = extractApiError(err);
          lastError = parsed;

          // Requirement 4: On a 404, drop that model from the list and move to the next
          if (parsed.statusCode === 404) {
            dropModelFromList(model);
            moveToNextModel = true;
            break;
          }

          // Requirement 3: On a 503 or 429, retry same model up to 3 times (2s, 4s, 8s)
          if (
            (parsed.statusCode === 503 || parsed.statusCode === 429) &&
            retryIdx < RETRY_DELAYS_MS.length
          ) {
            const waitMs = RETRY_DELAYS_MS[retryIdx];
            const retryNum = retryIdx + 1;
            const totalRetries = RETRY_DELAYS_MS.length;
            console.warn(
              `[Gemini] ${model} returned ${parsed.statusCode}; waiting ${waitMs / 1000}s before retry (${retryNum}/${totalRetries})`
            );
            req.onStatus?.(`Model busy, retrying (${retryNum}/${totalRetries})...`);
            await sleep(waitMs);
            continue;
          }

          // If exhausted retries on 503/429 (or model doesn't support function calling on 400), try next model
          if (
            parsed.statusCode === 503 ||
            parsed.statusCode === 429 ||
            parsed.statusCode === 400
          ) {
            console.warn(
              `[Gemini] ${model} failed (${parsed.statusCode}: ${parsed.message}); trying next model if available.`
            );
            moveToNextModel = true;
            break;
          }

          // Auth/fatal errors (401, 403, 504 timeout, etc.) — fail immediately with real status/message
          const { models: latestModels } = await getAvailableModels();
          throw new ChatApiError(parsed.statusCode, parsed.message, latestModels);
        }
      }

      if (moveToNextModel) {
        currentQueueIdx += 1;
        continue;
      }
    }

    const { models: latestModels } = await getAvailableModels();
    throw new ChatApiError(
      lastError.statusCode,
      `All available models failed (last error from ${candidateQueue[candidateQueue.length - 1] ?? 'model'}: ${lastError.message}).`,
      latestModels
    );
  };

  let activeModelUsed = candidateQueue[0] ?? '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { response, modelUsed } = await callGeminiWithRetryAndFallback(
      true,
      contents
    );
    activeModelUsed = modelUsed;

    const candidateContent = response.candidates?.[0]?.content;
    if (candidateContent) {
      contents.push(candidateContent);
    }

    const functionCalls = response.functionCalls;
    if (!functionCalls || functionCalls.length === 0) {
      const replyText = (response.text ?? '').trim();
      const { models: latestModels } = await getAvailableModels();
      return {
        reply:
          replyText ||
          'I checked the live data, but could not generate a response.',
        history: contents,
        proposals: ctx.proposals,
        toolsCalled: ctx.toolsCalled,
        modelUsed: activeModelUsed,
        availableModels: latestModels,
      };
    }

    const functionResponseParts: Part[] = [];
    for (const call of functionCalls) {
      const toolName = call.name ?? '';
      const toolArgs =
        call.args && typeof call.args === 'object'
          ? (call.args as Record<string, unknown>)
          : {};

      req.onToolStart?.(toolName);

      let result: Record<string, unknown>;
      try {
        result = await executeGrowthTool(toolName, toolArgs, ctx);
      } catch (err) {
        const parsed = extractApiError(err);
        if (err instanceof TimeoutError) {
          throw new ChatApiError(504, parsed.message);
        }
        result = {
          error: parsed.message,
        };
      }

      functionResponseParts.push({
        functionResponse: {
          id: call.id,
          name: toolName,
          response: { result },
        },
      });
    }

    contents.push({
      role: 'user',
      parts: functionResponseParts,
    });
  }

  // Reached 6-iteration tool cap: summarize strictly with what we already fetched
  const finalContents: Content[] = [
    ...contents,
    {
      role: 'user',
      parts: [
        {
          text: 'Tool call limit reached for this turn. Stop calling tools and summarize your answer strictly using the tool results already collected above.',
        },
      ],
    },
  ];

  const { response: finalResponse, modelUsed: finalModelUsed } =
    await callGeminiWithRetryAndFallback(false, finalContents);
  activeModelUsed = finalModelUsed;

  const finalCandidate = finalResponse.candidates?.[0]?.content;
  if (finalCandidate) {
    contents.push(finalCandidate);
  }
  const finalText = (finalResponse.text ?? '').trim();
  const { models: latestModels } = await getAvailableModels();

  return {
    reply:
      finalText ||
      `Reached the 6-step tool limit after calling: ${ctx.toolsCalled.join(', ')}. Please ask a narrower follow-up question.`,
    history: contents,
    proposals: ctx.proposals,
    toolsCalled: ctx.toolsCalled,
    modelUsed: activeModelUsed,
    availableModels: latestModels,
  };
}
