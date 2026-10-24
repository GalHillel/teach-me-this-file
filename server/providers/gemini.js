import { AppError, FALLBACK_CODES } from '../errors.js';
import { count } from '../metrics.js';
import { parseJsonText, postJson, readSseData } from './http.js';
import { coolDown, healthScope, isCooling } from './modelHealth.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MIN_ATTEMPT_MS = 1500;
const THINKING_LEVEL_MODELS = /^gemini-3(\.\d+)?-flash(-lite)?$/;

export const supportsThinkingLevel = (model) => THINKING_LEVEL_MODELS.test(model);

const toContents = (messages) =>
  messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));

const answerText = (data) => {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    if (data.promptFeedback?.blockReason) throw new AppError('blocked');
    return '';
  }
  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
    throw new AppError('blocked');
  }
  return (candidate.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
};

const orderByHealth = (tiers, scope) => {
  const healthy = tiers.filter((tier) => !isCooling(scope, tier.model));
  return healthy.length ? healthy : tiers;
};

export const createGeminiProvider = ({ apiKey, models, backupModels = [], timeoutMs = 20000, deadlineMs = 45000 }) => {
  const scope = healthScope(apiKey);
  const tiers = [
    ...models.map((model) => ({ model, backup: false })),
    ...backupModels.map((model) => ({ model, backup: true })),
  ];

  const call = async ({ task, method, bodyFor, signal, onMeta }) => {
    const deadline = Date.now() + deadlineMs;
    let lastError = null;
    let failures = 0;
    for (const tier of orderByHealth(tiers, scope)) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) break;
      const started = Date.now();
      try {
        const response = await postJson(`${BASE_URL}/${encodeURIComponent(tier.model)}:${method}`, {
          headers: { 'x-goog-api-key': apiKey },
          body: bodyFor(tier.model),
          signal,
          timeoutMs: Math.min(timeoutMs, remaining),
        });
        const ms = Date.now() - started;
        count('aiCalls');
        count('aiLatencyMs', ms);
        if (failures) count('fallbacks');
        if (tier.backup) count('backupModelUses');
        console.log(`ai ${task} ${tier.model} ok ${ms}ms${failures ? ` after ${failures} failed` : ''}`);
        onMeta?.({ model: tier.model, backup: tier.backup, fallbacks: failures });
        return response;
      } catch (error) {
        if (signal?.aborted) throw error;
        count('aiFailures');
        console.log(`ai ${task} ${tier.model} ${error.code ?? 'error'} ${Date.now() - started}ms`);
        if (!(error instanceof AppError) || !FALLBACK_CODES.has(error.code)) throw error;
        coolDown(scope, tier.model, error.code);
        lastError = error;
        failures += 1;
      }
    }
    throw lastError ?? new AppError('timeout');
  };

  return {
    name: 'gemini',
    model: models[0],

    async generateJson({ task = 'json', system, prompt, signal, onMeta }) {
      const response = await call({
        task,
        method: 'generateContent',
        signal,
        onMeta,
        bodyFor: () => ({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      });
      return parseJsonText(answerText(await response.json()));
    },

    async *streamText({ system, messages, signal, onMeta }) {
      const response = await call({
        task: 'teach',
        method: 'streamGenerateContent?alt=sse',
        signal,
        onMeta,
        bodyFor: (model) => ({
          systemInstruction: { parts: [{ text: system }] },
          contents: toContents(messages),
          generationConfig: supportsThinkingLevel(model)
            ? { temperature: 0.6, thinkingConfig: { thinkingLevel: 'low' } }
            : { temperature: 0.6 },
        }),
      });
      for await (const data of readSseData(response)) {
        const text = answerText(JSON.parse(data));
        if (text) yield text;
      }
    },
  };
};
