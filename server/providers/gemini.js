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

export const createGeminiProvider = ({ apiKey, model, graderModel = model }) => {
  const call = (method, body, signal, modelName = model) =>
    postJson(`${BASE_URL}/${encodeURIComponent(modelName)}:${method}`, {
      headers: { 'x-goog-api-key': apiKey },
      body,
      signal,
    });

  return {
    name: 'gemini',
    model,

    async generateJson({ task, system, prompt, signal }) {
      const response = await call(
        'generateContent',
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
        },
        signal,
        task === 'assessment' ? graderModel : model,
      );
      return parseJsonText(answerText(await response.json()));
    },

    async *streamText({ system, messages, signal }) {
      const response = await call(
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
