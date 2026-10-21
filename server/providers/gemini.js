import { config } from '../config.js';
import { AppError } from '../errors.js';
import { parseJsonText, postJson, readSseData } from './http.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const toContents = (messages) =>
  messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));

const tutorGenerationConfig = () => {
  const budget = Number.parseInt(config.geminiTutorThinkingBudget, 10);
  return Number.isInteger(budget)
    ? { temperature: 0.6, thinkingConfig: { thinkingBudget: budget } }
    : { temperature: 0.6 };
};

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

const FALLBACK_CODES = new Set(['provider_unavailable', 'rate_limited', 'model_unavailable', 'timeout']);

const asList = (models) => (Array.isArray(models) ? models : [models]);

export const createGeminiProvider = ({ apiKey, models, graderModels = models }) => {
  const call = async (modelNames, method, body, signal) => {
    let lastError;
    for (const modelName of asList(modelNames)) {
      try {
        return await postJson(`${BASE_URL}/${encodeURIComponent(modelName)}:${method}`, {
          headers: { 'x-goog-api-key': apiKey },
          body,
          signal,
        });
      } catch (error) {
        if (!(error instanceof AppError) || !FALLBACK_CODES.has(error.code)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  };

  return {
    name: 'gemini',
    model: asList(models)[0],

    async generateJson({ task, system, prompt, signal }) {
      const response = await call(
        task === 'assessment' ? graderModels : models,
        'generateContent',
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
        },
        signal,
      );
      return parseJsonText(answerText(await response.json()));
    },

    async *streamText({ system, messages, signal }) {
      const response = await call(
        models,
        'streamGenerateContent?alt=sse',
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: toContents(messages),
          generationConfig: tutorGenerationConfig(),
        },
        signal,
      );
      for await (const data of readSseData(response)) {
        const text = answerText(JSON.parse(data));
        if (text) yield text;
      }
    },
  };
};
