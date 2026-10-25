export const NEEDS_REVIEW = new Set(['recovered', 'review']);

export const activeStepIndex = (progress) =>
  progress.status === 'reviewing' && progress.review ? progress.review.queue[progress.review.position] : progress.currentStep;

export const assessedStepIndex = (progress) => {
  const index = activeStepIndex(progress);
  const detour = progress.steps[index]?.detour;
  return Number.isInteger(detour) ? detour : index;
};

export const inFinalCheck = (progress) => progress.status === 'reviewing' && progress.review?.kind === 'final';

export const LEVELS = ['not_started', 'in_progress', 'needs_practice', 'shown_with_help', 'shown', 'applied'];

export const stepEvidence = (progress, index) => {
  const state = progress.steps[index];
  const finalResult = progress.final?.results?.[index] ?? null;
  const practiceResult = progress.review?.kind === 'practice' ? progress.review.results?.[index] ?? null : null;
  const signals = [];
  if (state.status === 'pending') return { level: 'not_started', signals };
  if (state.status === 'active') return { level: 'in_progress', signals };

  if (state.outcome === 'mastered') signals.push('first_try');
  if (state.hints > 0) signals.push('hints');
  if (state.outcome === 'recovered' || state.outcome === 'review') signals.push('explained');
  if (state.revisit === 'fail') signals.push('prerequisite_gap');
  if (finalResult) signals.push(finalResult === 'pass' ? 'final_pass' : 'final_fail');
  if (practiceResult) signals.push(practiceResult === 'pass' ? 'practice_pass' : 'practice_fail');

  if (finalResult === 'pass') return { level: 'applied', signals };
  const weak = finalResult === 'fail' || state.outcome === 'review' || state.revisit === 'fail';
  if (weak) return { level: practiceResult === 'pass' ? 'shown_with_help' : 'needs_practice', signals };
  if (state.outcome === 'mastered') return { level: 'shown', signals };
  return { level: 'shown_with_help', signals };
};

export const reviewQueue = (progress) =>
  progress.steps
    .map((step, index) => {
      if (step.status !== 'done') return null;
      const { level } = stepEvidence({ ...progress, review: null }, index);
      return level === 'needs_practice' || (level === 'shown_with_help' && (NEEDS_REVIEW.has(step.outcome) || step.attempts >= 2)) ? index : null;
    })
    .filter((index) => index !== null);

const WEAKNESS = { review: 3, recovered: 2, learned: 1, mastered: 0 };

export const finalCheckSize = (stepCount) => Math.min(stepCount, 3);

export const finalCheckQueue = (plan, progress) => {
  const count = progress.steps.length;
  const dependents = plan.steps.map((step) => plan.steps.filter((other) => (other.prerequisites ?? []).includes(step.id)).length);
  const scored = progress.steps.map((state, index) => {
    const weakness = WEAKNESS[state.outcome] ?? 0;
    const help = Math.min(state.hints ?? 0, 2) * 0.5;
    const gap = state.revisit === 'fail' ? 2 : 0;
    const spacing = count > 1 ? (count - 1 - index) / (count - 1) : 0;
    const justAnswered = index === count - 1 && count > 1 ? -1 : 0;
    return { index, score: weakness + help + gap + dependents[index] * 0.5 + spacing * 0.5 + justAnswered };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, finalCheckSize(count))
    .map((item) => item.index)
    .sort((a, b) => a - b);
};

const REVIEW_DAYS = { needs_practice: 1, shown_with_help: 3, shown: 7, applied: 14 };

export const reviewSchedule = (progress) =>
  progress.steps
    .map((_, index) => {
      const { level } = stepEvidence(progress, index);
      return REVIEW_DAYS[level] ? { index, level, days: REVIEW_DAYS[level] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days || a.index - b.index);
