export const MAX_ATTEMPTS = 3;

export const createProgress = (plan) => ({
  status: 'active',
  currentStep: 0,
  steps: plan.steps.map((_, index) => ({
    status: index === 0 ? 'active' : 'pending',
    attempts: 0,
    outcome: null,
  })),
});

const completeCurrentStep = (progress, outcome) => {
  const steps = progress.steps.map((step, index) =>
    index === progress.currentStep ? { ...step, status: 'done', outcome } : step,
  );
  const isLast = progress.currentStep === steps.length - 1;
  if (isLast) {
    return { progress: { ...progress, status: 'completed', steps }, isLast };
  }
  const next = progress.currentStep + 1;
  steps[next] = { ...steps[next], status: 'active' };
  return { progress: { ...progress, currentStep: next, steps }, isLast };
};

const addAttempt = (progress) => ({
  ...progress,
  steps: progress.steps.map((step, index) =>
    index === progress.currentStep ? { ...step, attempts: step.attempts + 1 } : step,
  ),
});

export const planMove = (progress, { kind, verdict }) => {
  if (kind === 'start') return { move: 'introduce', progress };
  if (progress.status === 'completed') return { move: 'free_chat', progress };
  if (verdict === 'question') return { move: 'answer_question', progress };
  if (verdict === 'off_topic') return { move: 'redirect', progress };
  if (!['correct', 'partial', 'incorrect'].includes(verdict)) return { move: 'respond', progress };

  if (verdict === 'correct') {
    const attempts = progress.steps[progress.currentStep].attempts;
    const result = completeCurrentStep(progress, attempts === 0 ? 'mastered' : 'learned');
    return { move: result.isLast ? 'finish' : 'advance', progress: result.progress };
  }

  const tried = addAttempt(progress);
  if (tried.steps[tried.currentStep].attempts < MAX_ATTEMPTS) {
    return { move: 'hint', progress: tried };
  }
  const result = completeCurrentStep(tried, 'revealed');
  return { move: result.isLast ? 'reveal_and_finish' : 'reveal_and_advance', progress: result.progress };
};

export const lessonPace = (progress) => {
  const current = progress.steps[progress.currentStep];
  const finished = progress.steps.filter((step) => step.status === 'done');
  const lastTwo = finished.slice(-2);
  if (current.attempts >= 1 || lastTwo.at(-1)?.outcome === 'revealed') return 'slower';
  if (lastTwo.length === 2 && lastTwo.every((step) => step.outcome === 'mastered')) return 'faster';
  return 'normal';
};

export const stepsToReview = (plan, progress) =>
  progress.steps
    .map((step, index) => (step.outcome === 'revealed' || step.attempts >= 2 ? plan.steps[index].title : null))
    .filter(Boolean);
