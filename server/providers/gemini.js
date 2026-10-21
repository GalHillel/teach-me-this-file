import { AppError } from '../errors.js';
import { parseJsonText, postJson, readSseData } from './http.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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

export const createGeminiProvider = ({ apiKey, model }) => {
  const call = (method, body, signal) =>
    postJson(`${BASE_URL}/${encodeURIComponent(model)}:${method}`, {
      headers: { 'x-goog-api-key': apiKey },
      body,
      signal,
    });

  return {
    name: 'gemini',
    model,

    async generateJson({ system, prompt, signal }) {
      const response = await call(
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
        'streamGenerateContent?alt=sse',
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: toContents(messages),
          generationConfig: { temperature: 0.6 },
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
