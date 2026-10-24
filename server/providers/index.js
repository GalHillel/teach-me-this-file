import { config } from '../config.js';
import { AppError } from '../errors.js';
import { createGeminiProvider } from './gemini.js';
import { createMockProvider } from './mock.js';
import { createOpenAiCompatibleProvider } from './openaiCompatible.js';

export const PROVIDER_NAMES = ['gemini', 'groq', 'openrouter'];

export const detectProvider = (apiKey) => {
  if (apiKey.startsWith('AIza')) return 'gemini';
  if (apiKey.startsWith('gsk_')) return 'groq';
  if (apiKey.startsWith('sk-or-')) return 'openrouter';
  return null;
};

const createProvider = (name, apiKey) => {
  if (name === 'gemini') {
    return createGeminiProvider({
      apiKey,
      models: config.models.gemini,
      backupModels: config.models.geminiBackup,
      timeoutMs: config.providerTimeoutMs,
      deadlineMs: config.providerDeadlineMs,
      planTimeoutMs: config.planTimeoutMs,
      planDeadlineMs: config.planDeadlineMs,
    });
  }
  return createOpenAiCompatibleProvider({ name, apiKey, model: config.models[name] });
};

export const resolveProvider = ({ apiKey: userKey = '', provider: requested = '' }) => {
  const choice = requested.trim().toLowerCase();
  if (choice === 'mock' && config.allowMockProvider) return { provider: createMockProvider(), usesServerKey: false };

  const usesServerKey = !userKey.trim();
  const apiKey = usesServerKey ? config.serverApiKey : userKey.trim();
  if (!apiKey) throw new AppError('missing_key');

  const explicit = PROVIDER_NAMES.includes(choice) ? choice : null;
  const name = explicit ?? (usesServerKey && PROVIDER_NAMES.includes(config.serverProvider) ? config.serverProvider : detectProvider(apiKey));
  if (!name) throw new AppError('unknown_provider');

  return { provider: createProvider(name, apiKey), usesServerKey };
};
