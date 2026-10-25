import { activeStepIndex, finalCheckQueue, reviewQueue } from '../../shared/lesson.js';
import { chunksById, findRelatedPassages } from './sources.js';

const UPCOMING_LIMIT = 8;
const REQUESTS = new Set(['hint', 'explain', 'skip_final']);

export const isRequest = (kind) => REQUESTS.has(kind);

export const stepSources = (state, index) => {
  const step = index === undefined ? null : state.plan.steps[index];
  return step ? chunksById(state.chunks, step.sourceIds ?? []) : [];
};

export const stepsForTurn = (progress, kind) => {
  if (kind === 'review') return reviewQueue(progress).slice(0, 2);
  if (progress.status === 'reviewing') {
    const { queue, position } = progress.review;
    return [queue[position], queue[position + 1]];
  }
  const detour = progress.steps[progress.currentStep]?.detour;
  if (Number.isInteger(detour)) return [detour, progress.currentStep];
  return [activeStepIndex(progress), progress.currentStep + 1];
};

export const upcomingSources = (state, exclude) => {
  const { plan, progress } = state;
  if (progress.status !== 'active') return [];
  const step = plan.steps[progress.currentStep];
  const prerequisites = (step?.prerequisites ?? []).map((id) => plan.steps.findIndex((item) => item.id === id)).filter((index) => index >= 0);
  const finalFirst = progress.currentStep === plan.steps.length - 1 ? finalCheckQueue(plan, progress).slice(0, 1) : [];
  const skip = new Set(exclude);
  const ids = [...new Set([...prerequisites, ...finalFirst].flatMap((index) => plan.steps[index].sourceIds ?? []))].filter((id) => !skip.has(id));
  return chunksById(state.chunks, ids).slice(0, UPCOMING_LIMIT);
};

export const turnSources = (state, kind, studentMessage = '') => {
  const [currentIndex, nextIndex] = stepsForTurn(state.progress, kind);
  const current = stepSources(state, currentIndex);
  const next = stepSources(state, nextIndex);
  const shown = [...current, ...next].map((chunk) => chunk.id);
  const upcoming = upcomingSources(state, shown);
  const related = kind === 'reply' ? findRelatedPassages(studentMessage, state.chunks, { exclude: shown }) : [];
  return { current, next, related, upcoming };
};
