const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const listFromEnv = (name, fallback) => {
  const values = (process.env[name] || '').split(',').map((value) => value.trim()).filter(Boolean);
  return values.length ? values : fallback;
};

export const config = {
  port: numberFromEnv('PORT', 8787),
  serverApiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
  serverProvider: process.env.AI_PROVIDER || '',
  models: {
    gemini: listFromEnv('GEMINI_MODEL', ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest']),
    geminiGrader: listFromEnv('GEMINI_GRADER_MODEL', ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash']),
    groq: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    openrouter: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  },
  geminiTutorThinkingBudget: process.env.GEMINI_TUTOR_THINKING_BUDGET ?? '0',
  allowMockProvider: process.env.ALLOW_MOCK_PROVIDER === 'true',
  providerTimeoutMs: numberFromEnv('PROVIDER_TIMEOUT_MS', 45000),
  rateLimitPerMinute: numberFromEnv('RATE_LIMIT_PER_MINUTE', 30),
};
