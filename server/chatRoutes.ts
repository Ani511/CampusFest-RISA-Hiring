import type { IncomingMessage, ServerResponse } from 'node:http';
import { ChatApiError, extractApiError, runGrowthChatTurn } from './geminiChat.js';
import { getAvailableModels } from './modelRegistry.js';

// Shared by the local Express server (server.ts) and the Vercel functions (api/).
export type ApiRequest = IncomingMessage & { body?: any };
export type ApiResponse = ServerResponse & {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  flushHeaders?: () => void;
};

export async function handleModels(_req: ApiRequest, res: ApiResponse) {
  try {
    const { models, error } = await getAvailableModels();
    res.json({
      models,
      defaultModel: models[0]?.id ?? null,
      error,
    });
  } catch (err) {
    const { statusCode, message } = extractApiError(err);
    res.status(statusCode).json({ models: [], defaultModel: null, error: message });
  }
}

export async function handleChat(req: ApiRequest, res: ApiResponse) {
  const { message, history, model, supabaseCredentials } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ status: 400, error: 'Message text is required.' });
    return;
  }

  const wantsStream = String(req.headers.accept ?? '').includes(
    'text/event-stream'
  );

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      const result = await runGrowthChatTurn({
        message: message.trim(),
        history,
        model: typeof model === 'string' ? model : undefined,
        supabaseCredentials,
        onToolStart: (toolName) => {
          sendEvent('tool_start', { tool: toolName });
        },
        onStatus: (statusMessage) => {
          sendEvent('status', { message: statusMessage });
        },
      });
      sendEvent('done', result);
    } catch (err) {
      const { statusCode, message: errMsg } = extractApiError(err);
      const availableModels =
        err instanceof ChatApiError ? err.availableModels : undefined;
      console.error('/api/chat SSE error:', statusCode, errMsg);
      sendEvent('error', {
        status: statusCode,
        error: errMsg,
        ...(availableModels ? { availableModels } : {}),
      });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  try {
    const result = await runGrowthChatTurn({
      message: message.trim(),
      history,
      model: typeof model === 'string' ? model : undefined,
      supabaseCredentials,
    });
    res.json(result);
  } catch (err) {
    const { statusCode, message: errMsg } = extractApiError(err);
    const availableModels =
      err instanceof ChatApiError ? err.availableModels : undefined;
    console.error('/api/chat error:', statusCode, errMsg);
    res.status(statusCode).json({
      status: statusCode,
      error: errMsg,
      ...(availableModels ? { availableModels } : {}),
    });
  }
}
