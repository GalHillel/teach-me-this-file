import { AppError } from '../errors.js';
import { parseJsonText, postJson, readSseData } from './http.js';

const BASE_URLS = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export const createOpenAiCompatibleProvider = ({ name, apiKey, model }) => {
  const call = (body, signal) =>
    postJson(`${BASE_URLS[name]}/chat/completions`, {
      headers: { authorization: `Bearer ${apiKey}` },
      body: { model, ...body },
      signal,
    });

  return {
    name,
    model,

    async generateJson({ system, prompt, signal }) {
      const response = await call(
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        },
        signal,
      );
      const data = await response.json();
      return parseJsonText(data.choices?.[0]?.message?.content);
    },

    async *streamText({ system, messages, signal }) {
      const response = await call(
        {
          messages: [{ role: 'system', content: system }, ...messages],
          stream: true,
          temperature: 0.6,
        },
        signal,
      );
      for await (const data of readSseData(response)) {
        if (data === '[DONE]') return;
        const chunk = JSON.parse(data);
        if (chunk.error) throw new AppError('provider_unavailable');
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    },
  };
};
