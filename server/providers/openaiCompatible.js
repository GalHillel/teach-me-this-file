import { config } from '../config.js';
import { AppError } from '../errors.js';
import { count } from '../metrics.js';
import { parseJsonText, postJson, readSseData } from './http.js';

const BASE_URLS = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export const createOpenAiCompatibleProvider = ({ name, apiKey, model }) => {
  const call = async (task, body, signal, onMeta) => {
    const started = Date.now();
    try {
      const response = await postJson(`${BASE_URLS[name]}/chat/completions`, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: { model, ...body },
        signal,
        timeoutMs: task === 'plan' ? config.planTimeoutMs : config.providerTimeoutMs,
      });
      count('aiCalls');
      count('aiLatencyMs', Date.now() - started);
      console.log(`ai ${task} ${model} ok ${Date.now() - started}ms`);
      onMeta?.({ model, backup: false, fallbacks: 0 });
      return response;
    } catch (error) {
      if (!signal?.aborted) {
        count('aiFailures');
        console.log(`ai ${task} ${model} ${error.code ?? 'error'} ${Date.now() - started}ms`);
      }
      throw error;
    }
  };

  return {
    name,
    model,

    async generateJson({ task = 'json', system, prompt, signal, onMeta }) {
      const response = await call(
        task,
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        },
        signal,
        onMeta,
      );
      const data = await response.json();
      return parseJsonText(data.choices?.[0]?.message?.content);
    },

    async *streamText({ system, messages, signal, onMeta }) {
      const response = await call(
        'teach',
        {
          messages: [{ role: 'system', content: system }, ...messages],
          stream: true,
          temperature: 0.6,
        },
        signal,
        onMeta,
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
