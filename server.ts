import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChatApiError,
  extractApiError,
  runGrowthChatTurn,
} from './server/geminiChat.ts';
import { getAvailableModels, initGeminiModels } from './server/modelRegistry.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '4mb' }));

  // Discover and cache ordered Gemini models on startup
  await initGeminiModels().catch((err) => {
    console.error('[Startup] Gemini models.list check failed:', err);
  });

  app.get('/api/chat/models', async (_req, res) => {
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
  });

  app.post('/api/chat', async (req, res) => {
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
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Growth Center server running at http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
