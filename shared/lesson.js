export const NEEDS_REVIEW = new Set(['recovered', 'review']);

export const activeStepIndex = (progress) =>
  progress.status === 'reviewing' && progress.review ? progress.review.queue[progress.review.position] : progress.currentStep;

export const reviewQueue = (progress) =>
  progress.steps
    .map((step, index) => (NEEDS_REVIEW.has(step.outcome) || step.attempts >= 2 ? index : null))
    .filter((index) => index !== null);
