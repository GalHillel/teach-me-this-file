import { config } from '../config.js';
import { AppError, providerError } from '../errors.js';

export const postJson = async (url, { headers, body, signal }) => {
  const timeout = AbortSignal.timeout(config.providerTimeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new AppError('timeout');
    throw new AppError('provider_unavailable');
  }
  if (!response.ok) {
    throw providerError(response.status, await response.text().catch(() => ''));
  }
  return response;
};

export async function* readSseData(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop();
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
    }
  }
}

export const parseJsonText = (text) => {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        throw new AppError('bad_response');
      }
    }
    throw new AppError('bad_response');
  }
};
