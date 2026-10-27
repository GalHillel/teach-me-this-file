import express from 'express';
import { config } from './config.js';
import { AppError, errorBody, toAppError } from './errors.js';
import { evalModelCall, readEvalCall } from './evalModel.js';
import { createLessonPlan } from './lesson/planner.js';
import { runTurn } from './lesson/tutor.js';
import { count, metricsSnapshot } from './metrics.js';
import { resolveProvider } from './providers/index.js';
import { rateLimit } from './rateLimit.js';
import { createServerKeyBudget, isSameOrigin } from './serverKey.js';
import { openEventStream } from './sse.js';
import { validatePlanRequest, validateTurnRequest } from './validation.js';

const providerFrom = (req) =>
  resolveProvider({
    apiKey: req.get('x-ai-key') ?? '',
    provider: req.get('x-ai-provider') ?? '',
  });

const abortOnClose = (res) => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
};

const requestLog = (req, res, next) => {
  const started = Date.now();
  res.on('close', () => {
    const outcome = res.writableFinished ? res.statusCode : `${res.statusCode} aborted`;
    console.log(`${req.method} ${req.path} ${outcome} ${Date.now() - started}ms`);
  });
  next();
};

export const createApp = ({ providerFor = providerFrom, serverKeyBudget = createServerKeyBudget(config.serverKeyDailyLimit) } = {}) => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestLog);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const limiter = rateLimit({ perMinute: config.rateLimitPerMinute });

  const providerForRequest = (req) => {
    const { provider, usesServerKey } = providerFor(req);
    if (usesServerKey) {
      if (!isSameOrigin(req)) throw new AppError('server_key_restricted');
      if (!serverKeyBudget.take()) throw new AppError('server_key_budget');
    }
    return provider;
  };

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, serverKey: Boolean(config.serverApiKey), metrics: metricsSnapshot() });
  });

  app.post('/api/lessons', limiter, async (req, res) => {
    const input = validatePlanRequest(req.body);
    const provider = providerForRequest(req);
    const models = [];
    let backup = false;
    const onMeta = (meta) => {
      models.push(meta.model);
      backup ||= meta.backup;
    };
    const lesson = await createLessonPlan({ provider, ...input, signal: abortOnClose(res), onMeta });
    res.json({ ...lesson, provider: { name: provider.name, models, backup } });
  });

  app.post('/api/turns', limiter, async (req, res) => {
    const input = validateTurnRequest(req.body);
    const provider = providerForRequest(req);
    const signal = abortOnClose(res);
    const stream = openEventStream(res);
    try {
      await runTurn({ provider, input, signal, send: stream.send });
    } catch (error) {
      if (signal.aborted) {
        count('cancelledTurns');
        console.log('turn cancelled by client');
      } else {
        const appError = toAppError(error);
        count('turnErrors');
        if (appError.code === 'internal') console.error(`turn failed: ${error?.message}`);
        stream.send('error', errorBody(appError).error);
      }
    } finally {
      stream.end();
    }
  });

  app.post('/api/eval/model', limiter, async (req, res) => {
    const call = readEvalCall(req.body);
    const provider = providerForRequest(req);
    res.json(await evalModelCall({ provider, call, signal: abortOnClose(res) }));
  });

  app.use('/api', (req, res, next) => next(new AppError('invalid_request', 'Unknown API route.')));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.name === 'AbortError') return res.end();
    const appError = error?.type === 'entity.too.large'
      ? new AppError('invalid_request', 'The request is too large.')
      : error?.type === 'entity.parse.failed'
        ? new AppError('invalid_request', 'The request body is not valid JSON.')
        : toAppError(error);
    if (appError.code === 'internal') console.error(`request failed: ${error?.message}`);
    res.status(appError.status).json(errorBody(appError));
  });

  return app;
};
