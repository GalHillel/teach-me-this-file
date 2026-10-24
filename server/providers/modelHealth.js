import { createHash } from 'node:crypto';

const COOLDOWN_MS = {
  provider_unavailable: 30000,
  timeout: 60000,
  rate_limited: 20000,
  quota_exhausted: 15 * 60000,
  model_unavailable: 60 * 60000,
};

const MAX_ENTRIES = 500;
const coolingUntil = new Map();

export const healthScope = (apiKey) => createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

export const isCooling = (scope, model, now = Date.now()) => (coolingUntil.get(`${scope}:${model}`) ?? 0) > now;

export const coolDown = (scope, model, code, now = Date.now()) => {
  const duration = COOLDOWN_MS[code];
  if (!duration) return;
  if (coolingUntil.size > MAX_ENTRIES) {
    for (const [entry, until] of coolingUntil) {
      if (until <= now) coolingUntil.delete(entry);
    }
  }
  coolingUntil.set(`${scope}:${model}`, now + duration);
};

export const resetModelHealth = () => coolingUntil.clear();
