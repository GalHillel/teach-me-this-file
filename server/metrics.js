const startedAt = new Date().toISOString();

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
};

export const count = (name, amount = 1) => {
  counters[name] += amount;
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
});
