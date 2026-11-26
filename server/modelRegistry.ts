import { GoogleGenAI, type Model } from '@google/genai';
import { TimeoutError, withTimeout } from './growthTools.ts';

export interface GeminiModelInfo {
  id: string;
  displayName: string;
  supportedActions: string[];
}

const LIST_TIMEOUT_MS = 30_000;

let storedModels: GeminiModelInfo[] = [];
let initialized = false;
let initPromise: Promise<GeminiModelInfo[]> | null = null;
let lastInitError: string | null = null;

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeModelId(rawName: string): string {
  return rawName.replace(/^models\//, '').trim();
}

function isExcludedByCapabilityOrName(id: string, model: Model): boolean {
  const lower = id.toLowerCase();
  const displayLower = String(model.displayName ?? '').toLowerCase();
  const descLower = String(model.description ?? '').toLowerCase();

  // Requirement 1: Never use "pro" models
  if (lower.includes('pro') || displayLower.includes(' pro')) {
    return true;
  }

  // Must support generateContent
  const actions = (model.supportedActions ?? []).map((a) => a.toLowerCase());
  if (!actions.includes('generatecontent')) {
    return true;
  }

  // Exclude specialized non-tool / non-text-chat modalities (TTS, STT, image-only, music, video, robotics, embeddings, gemma, computer-use/aqa)
  const nonFunctionCallingTokens = [
    'tts',
    'transcribe',
    'image',
    'nano-banana',
    'lyria',
    'imagen',
    'veo',
    'embedding',
    'aqa',
    'robotics',
    'genie',
    'decision',
    'gemma',
    'learnlm',
    '-live',
    'native-audio',
    'computer-use',
    'deep-research',
    'omni',
    'antigravity',
  ];
  if (nonFunctionCallingTokens.some((tok) => lower.includes(tok))) {
    return true;
  }

  if (
    descLower.includes('does not support function calling') ||
    descLower.includes('text-to-speech') ||
    descLower.includes('speech-to-text') ||
    descLower.includes('image generation')
  ) {
    return true;
  }

  return false;
}

function modelPreferenceScore(id: string): {
  tier: number;
  versionNum: number;
  isLatestOrStable: number;
} {
  const lower = id.toLowerCase();

  // Requirement 1: Prefer names containing "flash-lite", then "flash"
  let tier = 2;
  if (lower.includes('flash-lite')) {
    tier = 0;
  } else if (lower.includes('flash')) {
    tier = 1;
  }

  // Extract numeric version e.g. 3.8, 3.5, 4, 2.5 to order newer versions first within each tier
  const verMatch = lower.match(/gemini-(\d+(?:\.\d+)?)/);
  const versionNum = verMatch ? Number.parseFloat(verMatch[1]) : 0;

  // Prefer non-preview / non-exp / non-dated aliases slightly over dated previews at same version
  const isPreviewOrExp =
    lower.includes('preview') ||
    lower.includes('exp') ||
    /-\d{2}-\d{4}/.test(lower) ||
    /-\d{3}$/.test(lower);
  const isLatestOrStable = lower.includes('latest') ? 2 : isPreviewOrExp ? 0 : 1;

  return { tier, versionNum, isLatestOrStable };
}

export function sortPreferredModels(models: GeminiModelInfo[]): GeminiModelInfo[] {
  return [...models].sort((a, b) => {
    const sa = modelPreferenceScore(a.id);
    const sb = modelPreferenceScore(b.id);
    if (sa.tier !== sb.tier) return sa.tier - sb.tier;
    if (sa.versionNum !== sb.versionNum) return sb.versionNum - sa.versionNum;
    if (sa.isLatestOrStable !== sb.isLatestOrStable) {
      return sb.isLatestOrStable - sa.isLatestOrStable;
    }
    return a.id.localeCompare(b.id);
  });
}

export async function refreshGeminiModels(): Promise<GeminiModelInfo[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    lastInitError = 'GEMINI_API_KEY is not configured in the server environment.';
    initialized = false;
    storedModels = [];
    return [];
  }

  const ai = createGeminiClient(apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);

  try {
    const discovered: GeminiModelInfo[] = [];
    const seen = new Set<string>();

    const fetchAll = async () => {
      const pager = await ai.models.list({
        config: {
          pageSize: 100,
          abortSignal: controller.signal,
        },
      });
      for await (const m of pager) {
        const rawName = String(m.name ?? '');
        const id = normalizeModelId(rawName);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        if (isExcludedByCapabilityOrName(id, m)) continue;

        discovered.push({
          id,
          displayName: String(m.displayName ?? id),
          supportedActions: Array.isArray(m.supportedActions)
            ? m.supportedActions
            : [],
        });
      }
      return discovered;
    };

    const rawFiltered = await withTimeout(
      fetchAll(),
      LIST_TIMEOUT_MS,
      'Gemini models.list'
    );

    const ordered = sortPreferredModels(rawFiltered);
    storedModels = ordered;
    initialized = true;
    lastInitError = null;

    console.log(
      `[GeminiModels] Discovered ${ordered.length} eligible models:`,
      ordered.map((m) => m.id)
    );
    return [...storedModels];
  } catch (err) {
    if (err instanceof TimeoutError || controller.signal.aborted) {
      lastInitError = `Gemini models.list timed out after ${LIST_TIMEOUT_MS / 1000}s`;
    } else {
      lastInitError = err instanceof Error ? err.message : String(err);
    }
    console.error('[GeminiModels] Failed to list models:', lastInitError);
    return [...storedModels];
  } finally {
    clearTimeout(timer);
  }
}

export async function initGeminiModels(): Promise<GeminiModelInfo[]> {
  if (initialized && storedModels.length > 0) {
    return [...storedModels];
  }
  if (!initPromise) {
    initPromise = refreshGeminiModels().finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export async function getAvailableModels(): Promise<{
  models: GeminiModelInfo[];
  error: string | null;
}> {
  if (!initialized || storedModels.length === 0) {
    await initGeminiModels();
  }
  return {
    models: [...storedModels],
    error: lastInitError,
  };
}

export function dropModelFromList(modelId: string): GeminiModelInfo[] {
  const normalized = normalizeModelId(modelId);
  const before = storedModels.length;
  storedModels = storedModels.filter((m) => m.id !== normalized);
  if (storedModels.length !== before) {
    console.warn(
      `[GeminiModels] Dropped model "${normalized}" (404). Remaining:`,
      storedModels.map((m) => m.id)
    );
  }
  return [...storedModels];
}
