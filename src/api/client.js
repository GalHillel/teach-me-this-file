import { readEvents } from './sse.js';

export class ApiError extends Error {
  constructor(code, message, retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

const headersFor = (settings) => {
  const headers = { 'content-type': 'application/json' };
  if (settings.apiKey.trim()) headers['x-ai-key'] = settings.apiKey.trim();
  if (settings.provider !== 'auto') headers['x-ai-provider'] = settings.provider;
  return headers;
};

const toApiError = (error) => new ApiError(error?.code ?? 'internal', error?.message ?? 'Something went wrong.', error?.retryable ?? true);

const readError = async (response) => {
  try {
    const body = await response.json();
    return toApiError(body.error);
  } catch {
    if (response.status === 413) return new ApiError('invalid_request', 'The file is too large to send to the server.', false);
    return new ApiError('internal', `The server answered with an error (${response.status}). Try again.`);
  }
};

const send = async (path, { settings, body, signal }) => {
  let response;
  try {
    response = await fetch(path, { method: 'POST', headers: headersFor(settings), body: JSON.stringify(body), signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('network', 'Could not reach the server. Check your connection and try again.');
  }
  if (!response.ok) throw await readError(response);
  return response;
};

export const fetchHealth = async () => {
  try {
    const response = await fetch('/api/health');
    return response.ok ? await response.json() : { ok: false, serverKey: false };
  } catch {
    return { ok: false, serverKey: false };
  }
};

export const createLesson = async ({ settings, teacherPrompt, document, signal }) => {
  const response = await send('/api/lessons', { settings, body: { teacherPrompt, document }, signal });
  return response.json();
};

export const streamTurn = async ({ settings, body, signal, onEvent }) => {
  const response = await send('/api/turns', { settings, body, signal });
  let finished = false;
  try {
    for await (const { event, data } of readEvents(response.body)) {
      if (event === 'error') throw toApiError(data);
      onEvent(event, data);
      if (event === 'done') finished = true;
    }
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof ApiError) throw error;
    throw new ApiError('network', 'The connection was interrupted. Try again.');
  }
  if (!finished) throw new ApiError('network', 'The answer was cut off before it finished. Try again.');
};
