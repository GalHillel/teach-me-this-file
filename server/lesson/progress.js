import { NEEDS_REVIEW, activeStepIndex, reviewQueue } from '../../shared/lesson.js';

export { NEEDS_REVIEW, activeStepIndex, reviewQueue };

export const MAX_ATTEMPTS = 3;
export const STALL_LIMIT = 2;

export const OUTCOMES = ['mastered', 'learned', 'recovered', 'review'];
export const REVIEW_RESULTS = ['pass', 'fail'];

const ANSWER_VERDICTS = new Set(['correct', 'partial', 'incorrect']);
const PROBE_ISSUES = new Set(['hedged', 'unjustified']);

export const newStepState = (status) => ({ status, phase: 'learn', attempts: 0, stalls: 0, probed: false, outcome: null });

export const createProgress = (plan) => ({
  status: 'active',
  currentStep: 0,
  steps: plan.steps.map((_, index) => newStepState(index === 0 ? 'active' : 'pending')),
  review: null,
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

const wrongAnswer = (progress, step, issue) => {
  const attempts = step.attempts + 1;
  if (attempts < MAX_ATTEMPTS) {
    return { move: issue === 'no_knowledge' ? 'reteach' : 'hint', progress: updateCurrent(progress, { attempts, stalls: 0 }) };
  }
  return { move: 'reveal_and_recheck', progress: updateCurrent(progress, { attempts, stalls: 0, phase: 'recheck' }) };
};

const handleAnswer = (progress, step, { verdict, confidence, issue }) => {
  if (step.phase === 'recheck') {
    const result = completeCurrent(progress, verdict === 'correct' ? 'recovered' : 'review');
    if (verdict === 'correct') return { move: result.last ? 'finish' : 'advance', progress: result.progress };
    return { move: result.last ? 'review_and_finish' : 'review_and_advance', progress: result.progress };
  }

  if (verdict === 'correct') {
    if ((confidence === 'low' || PROBE_ISSUES.has(issue)) && !step.probed) {
      return { move: 'probe', progress: updateCurrent(progress, { probed: true, stalls: 0 }) };
    }
    const result = completeCurrent(progress, answerOutcome(step));
    return { move: result.last ? 'finish' : 'advance', progress: result.progress };
  }

  return wrongAnswer(progress, step, issue);
};

const nonAnswerMove = (verdict, issue) => {
  if (issue === 'misread_question') return 'rephrase';
  return verdict === 'off_topic' ? 'redirect' : 'clarify';
};

const isNonAnswer = (verdict, issue) => !ANSWER_VERDICTS.has(verdict) || (issue === 'misread_question' && verdict !== 'correct');

const startReview = (progress) => {
  const queue = reviewQueue(progress);
  if (!queue.length) return { move: 'free_chat', progress };
  return { move: 'review_question', progress: { ...progress, status: 'reviewing', review: { queue, position: 0, results: {}, stalls: 0 } } };
};

const reviewAnswer = (progress, verdict) => {
  const { review } = progress;
  const index = review.queue[review.position];
  const results = { ...review.results, [index]: verdict === 'correct' ? 'pass' : 'fail' };
  const position = review.position + 1;
  if (position >= review.queue.length) {
    return { move: 'review_finish', progress: { ...progress, status: 'completed', review: { ...review, position: review.queue.length - 1, results, stalls: 0 } } };
  }
  return { move: 'review_next', progress: { ...progress, review: { ...review, position, results, stalls: 0 } } };
};

const planReviewMove = (progress, { verdict, issue }) => {
  if (verdict === 'question') return { move: 'answer_question', progress };
  if (isNonAnswer(verdict, issue)) {
    const stalls = progress.review.stalls + 1;
    if (stalls > STALL_LIMIT) return reviewAnswer(progress, 'incorrect');
    return { move: nonAnswerMove(verdict, issue), progress: { ...progress, review: { ...progress.review, stalls } } };
  }
  return reviewAnswer(progress, verdict);
};

export const planMove = (progress, { kind, assessment = null }) => {
  if (kind === 'start') return { move: 'introduce', progress };
  if (kind === 'review') return progress.status === 'completed' ? startReview(progress) : { move: 'clarify', progress };

  const grade = {
    verdict: assessment?.verdict ?? 'unclear',
    confidence: assessment?.confidence ?? 'medium',
    issue: assessment?.issue ?? 'none',
  };

  if (progress.status === 'reviewing') return planReviewMove(progress, grade);
  if (progress.status === 'completed') return { move: 'free_chat', progress };

  const step = progress.steps[progress.currentStep];

  if (grade.verdict === 'question') return { move: 'answer_question', progress };

  if (isNonAnswer(grade.verdict, grade.issue)) {
    const stalls = step.stalls + 1;
    if (stalls > STALL_LIMIT) {
      return handleAnswer(updateCurrent(progress, { stalls: 0 }), { ...step, stalls: 0 }, { verdict: 'incorrect', confidence: 'high', issue: 'none' });
    }
    return { move: nonAnswerMove(grade.verdict, grade.issue), progress: updateCurrent(progress, { stalls }) };
  }

  return handleAnswer(progress, step, grade);
};

export const lessonPace = (progress) => {
  const current = progress.steps[activeStepIndex(progress)];
  const finished = progress.steps.filter((step) => step.status === 'done');
  const lastTwo = finished.slice(-2);
  if (current.attempts >= 1 || NEEDS_REVIEW.has(lastTwo.at(-1)?.outcome)) return 'slower';
  if (lastTwo.length === 2 && lastTwo.every((step) => step.outcome === 'mastered')) return 'faster';
  return 'normal';
};

export const stepsToReview = (plan, progress) => reviewQueue(progress).map((index) => plan.steps[index].title);
