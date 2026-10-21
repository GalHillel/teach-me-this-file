import { config } from '../config.js';
import { AppError, providerError } from '../errors.js';

const MAX_RETRY_WAIT_MS = 10000;

const retryDelayMs = (response, detail) => {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const match = detail.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Number(match[1]) * 1000 : 2000;
};

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

const send = async (url, { headers, body, signal }) => {
  const timeout = AbortSignal.timeout(config.providerTimeoutMs);
  try {
    return await fetch(url, {
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
};

export const postJson = async (url, options) => {
  let response = await send(url, options);
  if (response.status === 429) {
    const detail = await response.text().catch(() => '');
    const delay = retryDelayMs(response, detail);
    if (delay > MAX_RETRY_WAIT_MS) throw providerError(429, detail);
    await wait(delay, options.signal);
    response = await send(url, options);
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
