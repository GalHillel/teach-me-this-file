const startedAt = new Date().toISOString();
const SAMPLE_LIMIT = 200;

const counters = {
  aiCalls: 0,
  aiFailures: 0,
  aiLatencyMs: 0,
  fallbacks: 0,
  backupModelUses: 0,
  turns: 0,
  turnErrors: 0,
  cancelledTurns: 0,
  firstTokenMs: 0,
  firstTokenCount: 0,
  citedTurns: 0,
  invalidCitations: 0,
};

const firstTokenSamples = [];

export const count = (name, amount = 1) => {
  counters[name] += amount;
};

export const recordFirstToken = (ms) => {
  counters.firstTokenMs += ms;
  counters.firstTokenCount += 1;
  firstTokenSamples.push(ms);
  if (firstTokenSamples.length > SAMPLE_LIMIT) firstTokenSamples.shift();
};

const percentile = (values, share) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};

export const metricsSnapshot = () => ({
  since: startedAt,
  aiCalls: counters.aiCalls,
  aiFailures: counters.aiFailures,
  averageAiMs: counters.aiCalls ? Math.round(counters.aiLatencyMs / counters.aiCalls) : null,
  fallbacks: counters.fallbacks,
  backupModelUses: counters.backupModelUses,
  turns: counters.turns,
  turnErrors: counters.turnErrors,
  cancelledTurns: counters.cancelledTurns,
  averageFirstTokenMs: counters.firstTokenCount ? Math.round(counters.firstTokenMs / counters.firstTokenCount) : null,
  firstTokenP50Ms: percentile(firstTokenSamples, 0.5),
  firstTokenP95Ms: percentile(firstTokenSamples, 0.95),
  firstTokenSamples: firstTokenSamples.length,
  citedTurns: counters.citedTurns,
  invalidCitations: counters.invalidCitations,
});
