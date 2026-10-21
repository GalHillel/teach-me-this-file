const MESSAGES = {
  missing_key: 'Add an AI API key in Settings to start a lesson.',
  unknown_provider: 'This key format is not recognised. Use a Google AI Studio (Gemini), Groq or OpenRouter key, or pick the provider in Settings.',
  invalid_key: 'The AI provider rejected this API key. Check the key in Settings.',
  rate_limited: 'The AI provider\'s rate limit or free quota was reached. Wait a minute and try again, or use another key.',
  model_unavailable: 'The configured AI model is not available for this key.',
  blocked: 'The AI provider refused to answer this message because of its safety filters.',
  timeout: 'The AI provider took too long to answer. Try again.',
  provider_unavailable: 'The AI provider is having problems right now. Try again in a moment.',
  bad_response: 'The AI returned an answer the app could not use. Try again.',
  invalid_request: 'The request was not valid.',
  too_many_requests: 'Too many requests from this browser. Wait a minute and try again.',
  internal: 'Something went wrong on the server. Try again.',
};

const STATUS = {
  missing_key: 401,
  unknown_provider: 400,
  invalid_key: 401,
  rate_limited: 429,
  model_unavailable: 400,
  blocked: 422,
  timeout: 504,
  provider_unavailable: 502,
  bad_response: 502,
  invalid_request: 400,
  too_many_requests: 429,
  internal: 500,
};

const RETRYABLE = new Set(['rate_limited', 'timeout', 'provider_unavailable', 'bad_response', 'too_many_requests', 'internal']);

export class AppError extends Error {
  constructor(code, message = MESSAGES[code] ?? MESSAGES.internal) {
    super(message);
    this.code = MESSAGES[code] ? code : 'internal';
    this.status = STATUS[this.code];
  }
}

export const toAppError = (error) => {
  if (error instanceof AppError) return error;
  if (error?.name === 'TimeoutError') return new AppError('timeout');
  return new AppError('internal');
};

export const errorBody = (error) => ({
  error: { code: error.code, message: error.message, retryable: RETRYABLE.has(error.code) },
});

export const providerError = (status, detail = '') => {
  const text = detail.toLowerCase();
  if (status === 401 || status === 403 || text.includes('api key not valid') || text.includes('api_key_invalid')) {
    return new AppError('invalid_key');
  }
  if (status === 429 || status === 402 || text.includes('quota')) return new AppError('rate_limited');
  if (status === 404) return new AppError('model_unavailable');
  if (status === 400) return new AppError('bad_response', 'The AI provider rejected the request.');
  return new AppError('provider_unavailable');
};
