import { NEEDS_REVIEW, activeStepIndex, finalCheckQueue, inFinalCheck, reviewQueue } from '../../shared/lesson.js';
import { chooseIntervention, findPrerequisiteGap, remember } from './policy.js';

export { NEEDS_REVIEW, activeStepIndex, reviewQueue };

export const MAX_ATTEMPTS = 3;
export const STALL_LIMIT = 2;

export const OUTCOMES = ['mastered', 'learned', 'recovered', 'review'];
export const REVIEW_RESULTS = ['pass', 'fail'];
export const REVIEW_KINDS = ['final', 'practice'];
export const REVISITS = ['pass', 'fail'];

const ANSWER_VERDICTS = new Set(['correct', 'partial', 'incorrect']);
const PROBE_ISSUES = new Set(['hedged', 'unjustified']);

export const newStepState = (status) => ({
  status,
  phase: 'learn',
  attempts: 0,
  stalls: 0,
  probed: false,
  outcome: null,
  hints: 0,
  used: [],
  detour: null,
  revisit: null,
});

export const createProgress = (plan) => ({
  status: 'active',
  currentStep: 0,
  steps: plan.steps.map((_, index) => newStepState(index === 0 ? 'active' : 'pending')),
  review: null,
  final: null,
});

const result = (move, progress, extra = {}) => ({ move, progress, intervention: null, prerequisite: null, ...extra });

const updateStep = (progress, index, change) => ({
  ...progress,
  steps: progress.steps.map((step, position) => (position === index ? { ...step, ...change } : step)),
});

const updateCurrent = (progress, change) => updateStep(progress, progress.currentStep, change);

const startFinalCheck = (plan, progress) => {
  const queue = finalCheckQueue(plan, progress);
  return { ...progress, status: 'reviewing', review: { kind: 'final', queue, position: 0, results: {}, stalls: 0 } };
};

const completeCurrent = (plan, progress, outcome) => {
  const done = updateCurrent(progress, { status: 'done', phase: 'learn', stalls: 0, detour: null, outcome });
  if (progress.currentStep === progress.steps.length - 1) {
    return { progress: startFinalCheck(plan, done), last: true };
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

const answerOutcome = (step) => (step.attempts === 0 && step.hints === 0 ? 'mastered' : 'learned');

const wrongAnswer = (plan, progress, step, assessment) => {
  const attempts = step.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return result('reveal_and_recheck', updateCurrent(progress, { attempts, stalls: 0, phase: 'recheck', used: remember(step.used, 'guided_solution') }), { intervention: 'guided_solution' });
  }
  const counted = updateCurrent(progress, { attempts, stalls: 0 });
  const gap = step.phase === 'learn' ? findPrerequisiteGap({ plan, progress: counted, stepIndex: progress.currentStep, assessment }) : null;
  if (gap) {
    return result('prerequisite_check', updateCurrent(counted, { detour: gap.index, used: remember(step.used, 'prerequisite') }), {
      intervention: 'prerequisite',
      prerequisite: gap,
    });
  }
  const intervention = chooseIntervention({ situation: 'wrong', assessment, state: { ...step, attempts } });
  const move = assessment?.issue === 'no_knowledge' ? 'reteach' : 'hint';
  return result(move, updateCurrent(counted, { used: remember(step.used, intervention) }), { intervention });
};

const handleAnswer = (plan, progress, step, assessment) => {
  const { verdict, confidence, issue } = assessment;
  if (step.phase === 'recheck') {
    const outcome = verdict === 'correct' ? 'recovered' : 'review';
    const done = completeCurrent(plan, progress, outcome);
    if (done.last) return result('final_check_start', done.progress);
    return result(verdict === 'correct' ? 'advance' : 'review_and_advance', done.progress);
  }

  if (verdict === 'correct') {
    if ((confidence === 'low' || PROBE_ISSUES.has(issue)) && !step.probed) {
      return result('probe', updateCurrent(progress, { probed: true, stalls: 0 }));
    }
    const done = completeCurrent(plan, progress, answerOutcome(step));
    return result(done.last ? 'final_check_start' : 'advance', done.progress);
  }

  return wrongAnswer(plan, progress, step, assessment);
};

const nonAnswerMove = (verdict, issue) => {
  if (issue === 'misread_question') return 'rephrase';
  return verdict === 'off_topic' ? 'redirect' : 'clarify';
};

const isNonAnswer = (verdict, issue) => !ANSWER_VERDICTS.has(verdict) || (issue === 'misread_question' && verdict !== 'correct');

const endDetour = (progress, step, outcome) => {
  const withRevisit = outcome ? updateStep(progress, step.detour, { revisit: outcome }) : progress;
  return updateCurrent(withRevisit, { detour: null, stalls: 0 });
};

const planDetourMove = (progress, step, grade) => {
  if (grade.verdict === 'question') return result('answer_question', progress);
  if (isNonAnswer(grade.verdict, grade.issue)) {
    const stalls = step.stalls + 1;
    if (stalls > STALL_LIMIT) return result('resume_after_reteach', endDetour(progress, step, 'fail'));
    return result(nonAnswerMove(grade.verdict, grade.issue), updateCurrent(progress, { stalls }));
  }
  if (grade.verdict === 'correct') return result('resume', endDetour(progress, step, 'pass'));
  return result('resume_after_reteach', endDetour(progress, step, 'fail'));
};

const startPractice = (progress) => {
  const queue = reviewQueue(progress);
  if (!queue.length) return result('free_chat', progress);
  return result('review_question', { ...progress, status: 'reviewing', review: { kind: 'practice', queue, position: 0, results: {}, stalls: 0 } });
};

const finishFinal = (progress, results, skipped = false) => ({
  ...progress,
  status: 'completed',
  review: null,
  final: { results, skipped },
});

const reviewAnswer = (progress, verdict) => {
  const { review } = progress;
  const index = review.queue[review.position];
  const results = { ...review.results, [index]: verdict === 'correct' ? 'pass' : 'fail' };
  const position = review.position + 1;
  if (review.kind === 'final') {
    if (position >= review.queue.length) return result('final_finish', finishFinal(progress, results));
    return result('final_next', { ...progress, review: { ...review, position, results, stalls: 0 } });
  }
  if (position >= review.queue.length) {
    return result('review_finish', { ...progress, status: 'completed', review: { ...review, position: review.queue.length - 1, results, stalls: 0 } });
  }
  return result('review_next', { ...progress, review: { ...review, position, results, stalls: 0 } });
};

const planReviewMove = (progress, { verdict, issue }) => {
  if (verdict === 'question') return result('answer_question', progress);
  if (isNonAnswer(verdict, issue)) {
    const stalls = progress.review.stalls + 1;
    if (stalls > STALL_LIMIT) return reviewAnswer(progress, 'incorrect');
    return result(nonAnswerMove(verdict, issue), { ...progress, review: { ...progress.review, stalls } });
  }
  return reviewAnswer(progress, verdict);
};

const helpRequest = (progress, kind) => {
  if (progress.status !== 'active') return result('clarify', progress);
  const step = progress.steps[progress.currentStep];
  if (Number.isInteger(step.detour)) return result('clarify', progress);
  const situation = kind === 'hint' ? 'hint_request' : 'explain_request';
  const intervention = chooseIntervention({ situation, state: step });
  const next = updateCurrent(progress, { hints: Math.min(step.hints + 1, 10), used: remember(step.used, intervention) });
  return result(kind === 'hint' ? 'hint' : 'reteach', next, { intervention, requested: true });
};

export const planMove = (progress, { kind, assessment = null, plan }) => {
  if (kind === 'start') return result('introduce', progress);
  if (kind === 'review') return progress.status === 'completed' ? startPractice(progress) : result('clarify', progress);
  if (kind === 'hint' || kind === 'explain') return helpRequest(progress, kind);
  if (kind === 'skip_final') {
    return inFinalCheck(progress) ? result('finish_skipped', finishFinal(progress, progress.review.results, true)) : result('clarify', progress);
  }

  const grade = {
    verdict: assessment?.verdict ?? 'unclear',
    confidence: assessment?.confidence ?? 'medium',
    issue: assessment?.issue ?? 'none',
    misconception: assessment?.misconception ?? '',
    conceptsMissing: assessment?.conceptsMissing ?? [],
  };

  if (progress.status === 'reviewing') return planReviewMove(progress, grade);
  if (progress.status === 'completed') return result('free_chat', progress);

  const step = progress.steps[progress.currentStep];
  if (Number.isInteger(step.detour)) return planDetourMove(progress, step, grade);

  if (grade.verdict === 'question') return result('answer_question', progress);

  if (isNonAnswer(grade.verdict, grade.issue)) {
    const stalls = step.stalls + 1;
    if (stalls > STALL_LIMIT) {
      return handleAnswer(plan, updateCurrent(progress, { stalls: 0 }), { ...step, stalls: 0 }, { verdict: 'incorrect', confidence: 'high', issue: 'none' });
    }
    return result(nonAnswerMove(grade.verdict, grade.issue), updateCurrent(progress, { stalls }));
  }

  return handleAnswer(plan, progress, step, grade);
};

export const lessonPace = (progress) => {
  const current = progress.steps[activeStepIndex(progress)];
  const finished = progress.steps.filter((step) => step.status === 'done');
  const lastTwo = finished.slice(-2);
  if (current.attempts >= 1 || current.hints >= 2 || NEEDS_REVIEW.has(lastTwo.at(-1)?.outcome)) return 'slower';
  if (lastTwo.length === 2 && lastTwo.every((step) => step.outcome === 'mastered')) return 'faster';
  return 'normal';
};

export const stepsToReview = (plan, progress) => reviewQueue(progress).map((index) => plan.steps[index].title);
