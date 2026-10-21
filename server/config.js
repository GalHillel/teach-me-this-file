const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  port: numberFromEnv('PORT', 8787),
  serverApiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
  serverProvider: process.env.AI_PROVIDER || '',
  models: {
    gemini: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    groq: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    openrouter: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  },
  allowMockProvider: process.env.ALLOW_MOCK_PROVIDER === 'true',
  providerTimeoutMs: numberFromEnv('PROVIDER_TIMEOUT_MS', 45000),
  rateLimitPerMinute: numberFromEnv('RATE_LIMIT_PER_MINUTE', 30),
};
