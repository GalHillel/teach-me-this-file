const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  port: numberFromEnv('PORT', 8787),
  serverApiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
  serverProvider: process.env.AI_PROVIDER || '',
  models: {
    gemini: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    geminiGrader: process.env.GEMINI_GRADER_MODEL || 'gemini-3.5-flash-lite',
    groq: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    openrouter: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  },
  geminiTutorThinkingBudget: process.env.GEMINI_TUTOR_THINKING_BUDGET ?? '0',
  allowMockProvider: process.env.ALLOW_MOCK_PROVIDER === 'true',
  providerTimeoutMs: numberFromEnv('PROVIDER_TIMEOUT_MS', 45000),
  rateLimitPerMinute: numberFromEnv('RATE_LIMIT_PER_MINUTE', 30),
};
