import { stepState } from './learner.js';

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
  const step = progress.steps[index];
  const model = stepState(progress, index);
  const signals = [];
  if (step.status === 'pending') return { level: 'not_started', signals, ...model };
  if (step.status === 'active') return { level: 'in_progress', signals, ...model };

  if (step.outcome === 'mastered') signals.push('first_try');
  if (step.hints > 0) signals.push('hints');
  if (model.worked) signals.push('explained');
  if (model.gap) signals.push('prerequisite_gap');
  const finalResult = progress.final?.results?.[index] ?? null;
  const practiceResult = progress.review?.kind === 'practice' ? progress.review.results?.[index] ?? null : null;
  if (finalResult) signals.push(finalResult === 'pass' ? 'final_pass' : 'final_fail');
  if (practiceResult) signals.push(practiceResult === 'pass' ? 'practice_pass' : 'practice_fail');

  return { level: LEVEL_OF_STATE[model.state](model), signals, ...model };
};

const LEVEL_OF_STATE = {
  demonstrated: (model) => (model.transfer && model.confidence === 'high' ? 'applied' : 'shown'),
  developing: () => 'shown_with_help',
  emerging: () => 'needs_practice',
  needs_review: () => 'needs_practice',
  not_assessed: () => 'shown_with_help',
};

export const reviewQueue = (progress) =>
  progress.steps
    .map((step, index) => {
      if (step.status !== 'done') return null;
      const { state, worked } = stepState({ ...progress, review: null }, index);
      return state === 'needs_review' || state === 'emerging' || (state === 'developing' && (worked || step.attempts >= 2)) ? index : null;
    })
    .filter((index) => index !== null);

const WEAKNESS = { needs_review: 3, emerging: 3, developing: 1, demonstrated: 0, not_assessed: 1 };

export const finalCheckSize = (stepCount) => Math.min(stepCount, 3);

export const finalCheckQueue = (plan, progress) => {
  const count = progress.steps.length;
  const dependents = plan.steps.map((step) => plan.steps.filter((other) => (other.prerequisites ?? []).includes(step.id)).length);
  const scored = progress.steps.map((state, index) => {
    const model = stepState(progress, index);
    const weakness = WEAKNESS[model.state] + (model.state === 'developing' && model.worked ? 1 : 0);
    const help = Math.min(state.hints ?? 0, 2) * 0.5;
    const spacing = count > 1 ? (count - 1 - index) / (count - 1) : 0;
    const justAnswered = index === count - 1 && count > 1 ? -1 : 0;
    return { index, score: weakness + help + dependents[index] * 0.5 + spacing * 0.5 + justAnswered };
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
