import { isTeaching } from '../server/lesson/progress.js';

export const asked = (progress) => (progress && isTeaching(progress)
  ? { ...progress, steps: progress.steps.map((step, index) => (index === progress.currentStep ? { ...step, phase: 'learn' } : step)) }
  : progress);
