export const MAX_ATTEMPTS = 3;
export const STALL_LIMIT = 2;

export const OUTCOMES = ['mastered', 'learned', 'recovered', 'review'];
export const NEEDS_REVIEW = new Set(['recovered', 'review']);

const ANSWER_VERDICTS = new Set(['correct', 'partial', 'incorrect']);

export const newStepState = (status) => ({ status, phase: 'learn', attempts: 0, stalls: 0, probed: false, outcome: null });

export const createProgress = (plan) => ({
  status: 'active',
  currentStep: 0,
  steps: plan.steps.map((_, index) => newStepState(index === 0 ? 'active' : 'pending')),
});

const updateCurrent = (progress, change) => ({
  ...progress,
  steps: progress.steps.map((step, index) => (index === progress.currentStep ? { ...step, ...change } : step)),
});

const completeCurrent = (progress, outcome) => {
  const done = updateCurrent(progress, { status: 'done', phase: 'learn', stalls: 0, outcome });
  if (progress.currentStep === progress.steps.length - 1) {
    return { progress: { ...done, status: 'completed' }, last: true };
  }
  const next = progress.currentStep + 1;
  return {
    progress: {
      ...done,
      currentStep: next,
      steps: done.steps.map((step, index) => (index === next ? { ...step, status: 'active' } : step)),
    },
    last: false,
  };
};

const answerOutcome = (step) => (step.attempts === 0 ? 'mastered' : 'learned');

const handleAnswer = (progress, step, verdict, confidence) => {
  if (step.phase === 'recheck') {
    const result = completeCurrent(progress, verdict === 'correct' ? 'recovered' : 'review');
    if (verdict === 'correct') return { move: result.last ? 'finish' : 'advance', progress: result.progress };
    return { move: result.last ? 'review_and_finish' : 'review_and_advance', progress: result.progress };
  }

  if (verdict === 'correct') {
    if (confidence === 'low' && !step.probed) {
      return { move: 'probe', progress: updateCurrent(progress, { probed: true, stalls: 0 }) };
    }
    const result = completeCurrent(progress, answerOutcome(step));
    return { move: result.last ? 'finish' : 'advance', progress: result.progress };
  }

  const attempts = step.attempts + 1;
  if (attempts < MAX_ATTEMPTS) {
    return { move: 'hint', progress: updateCurrent(progress, { attempts, stalls: 0 }) };
  }
  return { move: 'reveal_and_recheck', progress: updateCurrent(progress, { attempts, stalls: 0, phase: 'recheck' }) };
};

export const planMove = (progress, { kind, assessment = null }) => {
  if (kind === 'start') return { move: 'introduce', progress };
  if (progress.status === 'completed') return { move: 'free_chat', progress };

  const step = progress.steps[progress.currentStep];
  const verdict = assessment?.verdict ?? 'unclear';

  if (verdict === 'question') {
    return { move: 'answer_question', progress: updateCurrent(progress, { stalls: 0 }) };
  }

  if (!ANSWER_VERDICTS.has(verdict)) {
    const stalls = step.stalls + 1;
    if (stalls > STALL_LIMIT) return handleAnswer(updateCurrent(progress, { stalls: 0 }), step, 'incorrect', 'high');
    return { move: verdict === 'off_topic' ? 'redirect' : 'clarify', progress: updateCurrent(progress, { stalls }) };
  }

  return handleAnswer(progress, step, verdict, assessment.confidence);
};

export const lessonPace = (progress) => {
  const current = progress.steps[progress.currentStep];
  const finished = progress.steps.filter((step) => step.status === 'done');
  const lastTwo = finished.slice(-2);
  if (current.attempts >= 1 || NEEDS_REVIEW.has(lastTwo.at(-1)?.outcome)) return 'slower';
  if (lastTwo.length === 2 && lastTwo.every((step) => step.outcome === 'mastered')) return 'faster';
  return 'normal';
};

export const stepsToReview = (plan, progress) =>
  progress.steps
    .map((step, index) => (NEEDS_REVIEW.has(step.outcome) || step.attempts >= 2 ? plan.steps[index].title : null))
    .filter(Boolean);
