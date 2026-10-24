import { AppError, providerError } from '../errors.js';

const MAX_RETRY_WAIT_MS = 8000;

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

const bodies = new WeakMap();

const send = async (url, { headers, body, signal, timeoutMs }) => {
  const controller = new AbortController();
  const state = { timedOut: false, timer: null, idleMs: timeoutMs };
  const expire = () => {
    state.timedOut = true;
    controller.abort();
  };
  const stop = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', stop, { once: true });
  state.ended = new Promise((resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(state.timedOut ? new AppError('timeout') : controller.signal.reason), { once: true });
  });
  state.ended.catch(() => {});
  state.timer = setTimeout(expire, timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(state.timer);
    state.restart = () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(expire, state.idleMs);
    };
    state.release = () => {
      clearTimeout(state.timer);
      signal?.removeEventListener('abort', stop);
    };
    bodies.set(response, state);
    return response;
  } catch (error) {
    clearTimeout(state.timer);
    signal?.removeEventListener('abort', stop);
    if (signal?.aborted) throw error;
    if (state.timedOut) throw new AppError('timeout');
    throw new AppError('provider_unavailable');
  }
};

export const postJson = async (url, options) => {
  let response = await send(url, options);
  if (response.status === 429) {
    const detail = await response.text().catch(() => '');
    const error = providerError(429, detail);
    const delay = retryDelayMs(response, detail);
    if (error.code === 'quota_exhausted' || delay > MAX_RETRY_WAIT_MS) throw error;
    await wait(delay, options.signal);
    response = await send(url, options);
  }
  if (!response.ok) {
    throw providerError(response.status, await response.text().catch(() => ''));
  }
  return response;
};

export async function* readSseData(response) {
  const state = bodies.get(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    state?.restart();
    while (true) {
      const { done, value } = await (state ? Promise.race([reader.read(), state.ended]) : reader.read());
      if (done) break;
      state?.restart();
      buffer += decoder.decode(value, { stream: true });
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
  } catch (error) {
    if (state?.timedOut) throw new AppError('timeout');
    throw error;
  } finally {
    state?.release();
    reader.cancel().catch(() => {});
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
