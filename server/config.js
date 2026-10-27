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
  serverKeyDailyLimit: numberFromEnv('SERVER_KEY_DAILY_LIMIT', 400),
  models: {
    gemini: listFromEnv('GEMINI_MODELS', ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash']),
    geminiBackup: listFromEnv('GEMINI_BACKUP_MODELS', ['gemini-3.5-flash-lite']),
    groq: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    openrouter: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  },
  allowMockProvider: process.env.ALLOW_MOCK_PROVIDER === 'true',
  demoMode: process.env.DEMO_MODE === 'true',
  providerTimeoutMs: numberFromEnv('PROVIDER_TIMEOUT_MS', 15000),
  providerDeadlineMs: numberFromEnv('PROVIDER_DEADLINE_MS', 40000),
  planTimeoutMs: numberFromEnv('PLAN_TIMEOUT_MS', 35000),
  planDeadlineMs: numberFromEnv('PLAN_DEADLINE_MS', 75000),
  rateLimitPerMinute: numberFromEnv('RATE_LIMIT_PER_MINUTE', 30),
};
