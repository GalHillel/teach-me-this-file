import { activeStepIndex, reviewQueue, stepEvidence } from '../../shared/lesson.js';

export const DISPLAY_LEVELS = ['not_started', 'in_progress', 'needs_review', 'needs_practice', 'shown_with_help', 'shown', 'applied'];

export const stepView = (progress, index) => {
  const evidence = stepEvidence(progress, index);
  const helped = evidence.assisted && progress.steps[index].status === 'done' && !evidence.signals.some((signal) => signal === 'hints' || signal === 'explained');
  return { ...evidence, signals: helped ? ['with_help', ...evidence.signals] : evidence.signals, display: evidence.level === 'needs_practice' && evidence.state === 'needs_review' ? 'needs_review' : evidence.level };
};

export const shownCount = (progress) => progress.steps.filter((_, index) => stepEvidence(progress, index).state === 'demonstrated').length;

export const nextAction = (progress) => {
  if (progress.status === 'active') {
    const step = progress.steps[progress.currentStep];
    if (Number.isInteger(step.detour)) return { code: 'detour', step: step.detour + 1, back: progress.currentStep + 1 };
    return { code: step.phase === 'recheck' ? 'recheck' : 'step', step: progress.currentStep + 1 };
  }
  if (progress.status === 'reviewing') return { code: progress.review.kind === 'final' ? 'final' : 'practice', step: activeStepIndex(progress) + 1 };
  const queue = reviewQueue(progress);
  return queue.length ? { code: 'practise', steps: queue.map((index) => index + 1).join(', ') } : { code: 'done' };
};
