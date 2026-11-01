import { EVIDENCE_LIMIT } from '../../shared/learner.js';
import { NEEDS_REVIEW, activeStepIndex, finalCheckQueue, inFinalCheck, reviewQueue } from '../../shared/lesson.js';
import { NARROWS_QUESTION, chooseIntervention, findPrerequisiteGap, ladderOf, remember } from './policy.js';

export { NEEDS_REVIEW, activeStepIndex, reviewQueue };

export const MAX_ATTEMPTS = 3;
export const STALL_LIMIT = 2;

export const OUTCOMES = ['mastered', 'learned', 'recovered', 'review'];
export const REVIEW_RESULTS = ['pass', 'fail'];
export const REVIEW_KINDS = ['final', 'practice'];
export const REVISITS = ['pass', 'fail'];

const ANSWER_VERDICTS = new Set(['correct', 'partial', 'incorrect']);
const PROBE_ISSUES = new Set(['hedged', 'unjustified', 'copied']);

export const newStepState = (status) => ({
  status,
  phase: 'learn',
  attempts: 0,
  stalls: 0,
  probed: false,
  scaffold: false,
  built: false,
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
  evidence: [],
});

const result = (move, progress, reason, extra = {}) => ({ move, progress, reason, intervention: null, prerequisite: null, ...extra });

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
    return result('reveal_and_recheck', updateCurrent(progress, { attempts, stalls: 0, phase: 'recheck', scaffold: false, used: remember(step.used, 'guided_solution') }), 'attempts_used_up', { intervention: 'guided_solution' });
  }
  const counted = updateCurrent(progress, { attempts, stalls: 0 });
  const gap = step.phase === 'learn' ? findPrerequisiteGap({ plan, progress: counted, stepIndex: progress.currentStep, assessment }) : null;
  if (gap) {
    return result('prerequisite_check', updateCurrent(counted, { detour: gap.index, scaffold: false, used: remember(step.used, 'prerequisite') }), gap.reason, {
      intervention: 'prerequisite',
      prerequisite: gap,
    });
  }
  const intervention = chooseIntervention({ situation: 'wrong', assessment, state: { ...step, attempts } });
  const move = assessment?.issue === 'no_knowledge' ? 'reteach' : 'hint';
  return result(move, updateCurrent(counted, { used: remember(step.used, intervention), scaffold: step.scaffold || NARROWS_QUESTION.has(intervention) }), ladderOf('wrong', assessment, attempts), { intervention });
};

const handleAnswer = (plan, progress, step, assessment) => {
  const { verdict, confidence, issue } = assessment;
  if (step.phase === 'recheck') {
    const outcome = verdict === 'correct' ? 'recovered' : 'review';
    const reason = verdict === 'correct' ? 'right_after_explanation' : 'wrong_after_explanation';
    const done = completeCurrent(plan, progress, outcome);
    if (done.last) return result('final_check_start', done.progress, reason);
    return result(verdict === 'correct' ? 'advance' : 'review_and_advance', done.progress, reason);
  }

  if (verdict === 'correct') {
    if (step.scaffold && !assessment.wholeQuestion) {
      return result('build_up', updateCurrent(progress, { scaffold: false, built: true, stalls: 0 }), 'narrowed_question_right');
    }
    if ((confidence === 'low' || PROBE_ISSUES.has(issue)) && !step.probed) {
      return result('probe', updateCurrent(progress, { probed: true, stalls: 0 }), PROBE_ISSUES.has(issue) ? `${issue}_answer` : 'unsure_grade');
    }
    const outcome = answerOutcome(step);
    const done = completeCurrent(plan, progress, outcome);
    return result(done.last ? 'final_check_start' : 'advance', done.progress, outcome === 'mastered' ? 'right_without_help' : 'right_with_help');
  }

  return wrongAnswer(plan, progress, step, assessment);
};

export const needsWholeQuestionGrade = (progress, assessment) => {
  const step = progress.status === 'active' ? progress.steps[progress.currentStep] : null;
  return Boolean(step?.scaffold && step.phase === 'learn' && !Number.isInteger(step.detour) && assessment?.verdict === 'correct' && assessment.issue === 'none' && assessment.confidence !== 'low');
};

const nonAnswerMove = (verdict, issue) => {
  if (issue === 'misread_question') return 'rephrase';
  return verdict === 'off_topic' ? 'redirect' : 'clarify';
};

const NON_ANSWER_REASON = { rephrase: 'answered_another_question', redirect: 'off_topic', clarify: 'unclear_answer' };

const nonAnswer = (verdict, issue, progress) => {
  const move = nonAnswerMove(verdict, issue);
  return result(move, progress, NON_ANSWER_REASON[move]);
};

const isNonAnswer = (verdict, issue) => !ANSWER_VERDICTS.has(verdict) || (issue === 'misread_question' && verdict !== 'correct');

const endDetour = (progress, step, outcome) => {
  const withRevisit = outcome ? updateStep(progress, step.detour, { revisit: outcome }) : progress;
  return updateCurrent(withRevisit, { detour: null, stalls: 0 });
};

const planDetourMove = (progress, step, grade) => {
  if (grade.verdict === 'question') return result('answer_question', progress, 'student_question');
  if (isNonAnswer(grade.verdict, grade.issue)) {
    const stalls = step.stalls + 1;
    if (stalls > STALL_LIMIT) return result('resume_after_reteach', endDetour(progress, step, 'fail'), 'no_answer_on_earlier_step');
    return nonAnswer(grade.verdict, grade.issue, updateCurrent(progress, { stalls }));
  }
  if (grade.verdict === 'correct') return result('resume', endDetour(progress, step, 'pass'), 'earlier_step_right');
  return result('resume_after_reteach', endDetour(progress, step, 'fail'), 'earlier_step_wrong');
};

const startPractice = (progress) => {
  const queue = reviewQueue(progress);
  if (!queue.length) return result('free_chat', progress, 'nothing_to_practise');
  return result('review_question', { ...progress, status: 'reviewing', review: { kind: 'practice', queue, position: 0, results: {}, stalls: 0 } }, 'weak_steps');
};

const finishFinal = (progress, results, skipped = false) => ({
  ...progress,
  status: 'completed',
  review: null,
  final: { results, skipped },
});

const reviewAnswer = (progress, verdict, reason) => {
  const { review } = progress;
  const index = review.queue[review.position];
  const results = { ...review.results, [index]: verdict === 'correct' ? 'pass' : 'fail' };
  const position = review.position + 1;
  if (review.kind === 'final') {
    if (position >= review.queue.length) return result('final_finish', finishFinal(progress, results), reason);
    return result('final_next', { ...progress, review: { ...review, position, results, stalls: 0 } }, reason);
  }
  if (position >= review.queue.length) {
    return result('review_finish', { ...progress, status: 'completed', review: { ...review, position: review.queue.length - 1, results, stalls: 0 } }, reason);
  }
  return result('review_next', { ...progress, review: { ...review, position, results, stalls: 0 } }, reason);
};

const REVIEW_PROBES = new Set(['copied', 'unjustified']);

const planReviewMove = (progress, { verdict, issue }) => {
  if (verdict === 'question') return result('answer_question', progress, 'student_question');
  const unproven = verdict === 'correct' && REVIEW_PROBES.has(issue);
  if (isNonAnswer(verdict, issue) || unproven) {
    const stalls = progress.review.stalls + 1;
    const next = { ...progress, review: { ...progress.review, stalls } };
    if (stalls > STALL_LIMIT) return reviewAnswer(progress, 'incorrect', 'no_answer');
    return unproven ? result('probe', next, `${issue}_answer`) : nonAnswer(verdict, issue, next);
  }
  return reviewAnswer(progress, verdict, verdict === 'correct' ? 'right_without_help' : 'not_right');
};

const helpRequest = (progress, kind) => {
  if (progress.status !== 'active') return result('clarify', progress, 'no_help_now');
  const step = progress.steps[progress.currentStep];
  if (Number.isInteger(step.detour)) return result('clarify', progress, 'no_help_now');
  const situation = kind === 'hint' ? 'hint_request' : 'explain_request';
  const intervention = chooseIntervention({ situation, state: step });
  const next = updateCurrent(progress, { hints: Math.min(step.hints + 1, 10), used: remember(step.used, intervention), scaffold: step.phase === 'learn' && (step.scaffold || NARROWS_QUESTION.has(intervention)) });
  return result(kind === 'hint' ? 'hint' : 'reteach', next, ladderOf(situation), { intervention, requested: true });
};

const decide = (progress, { kind, assessment, plan }) => {
  if (kind === 'start') return result('introduce', progress, 'lesson_start');
  if (kind === 'review') return progress.status === 'completed' ? startPractice(progress) : result('clarify', progress, 'lesson_not_finished');
  if (kind === 'hint' || kind === 'explain') return helpRequest(progress, kind);
  if (kind === 'skip_final') {
    return inFinalCheck(progress) ? result('finish_skipped', finishFinal(progress, progress.review.results, true), 'final_skipped') : result('clarify', progress, 'no_final_check');
  }

  const grade = {
    verdict: assessment?.verdict ?? 'unclear',
    confidence: assessment?.confidence ?? 'medium',
    issue: assessment?.issue ?? 'none',
    misconception: assessment?.misconception ?? '',
    conceptsMissing: assessment?.conceptsMissing ?? [],
    missingPrerequisite: assessment?.missingPrerequisite ?? 0,
    wholeQuestion: assessment?.wholeQuestion === true,
  };

  if (progress.status === 'reviewing') return planReviewMove(progress, grade);
  if (progress.status === 'completed') return result('free_chat', progress, 'lesson_complete');

  const step = progress.steps[progress.currentStep];
  if (Number.isInteger(step.detour)) return planDetourMove(progress, step, grade);

  if (grade.verdict === 'question') return result('answer_question', progress, 'student_question');

  if (isNonAnswer(grade.verdict, grade.issue)) {
    const stalls = step.stalls + 1;
    if (stalls > STALL_LIMIT) {
      return { ...handleAnswer(plan, updateCurrent(progress, { stalls: 0 }), { ...step, stalls: 0 }, { verdict: 'incorrect', confidence: 'high', issue: 'none' }), reason: 'no_answer' };
    }
    return nonAnswer(grade.verdict, grade.issue, updateCurrent(progress, { stalls }));
  }

  return handleAnswer(plan, progress, step, grade);
};

const WORKED = new Set(['worked_example', 'guided_solution']);

const supportOf = (step) => {
  if (step.phase === 'recheck' || step.used.some((item) => WORKED.has(item))) return 'worked';
  if (step.scaffold || step.built || step.used.some((item) => NARROWS_QUESTION.has(item))) return 'narrowed';
  return step.used.length || step.hints > 0 ? 'hinted' : 'independent';
};

const subjectOf = (progress) => {
  if (progress.status === 'reviewing') {
    return { step: activeStepIndex(progress), question: progress.review.kind === 'final' ? 'transfer' : 'practice', support: 'independent' };
  }
  const step = progress.steps[progress.currentStep];
  if (Number.isInteger(step.detour)) return { step: step.detour, question: 'detour', support: 'reminded' };
  return { step: progress.currentStep, question: step.scaffold ? 'narrowed' : 'check', support: supportOf(step) };
};

const isEvidence = (kind, before, grade, reason) => kind === 'reply' && before.status !== 'completed' && grade && (reason === 'no_answer' || !isNonAnswer(grade.verdict, grade.issue ?? 'none'));

const recordEvidence = (before, decision, { kind, assessment, sourceIds = [] }) => {
  const log = before.evidence;
  if (!Array.isArray(log) || !isEvidence(kind, before, assessment, decision.reason)) return decision.progress;
  const last = log.at(-1)?.n ?? 0;
  const entries = [{
    n: last + 1,
    ...subjectOf(before),
    verdict: decision.reason === 'no_answer' ? 'incorrect' : assessment.verdict,
    issue: assessment.issue ?? 'none',
    misconception: (assessment.misconception ?? '').slice(0, 160),
    sources: sourceIds.slice(0, 6),
    move: decision.move,
    reason: decision.reason,
  }];
  if (decision.move === 'prerequisite_check') {
    entries.push({ n: last + 2, step: decision.prerequisite.index, gap: true, from: before.currentStep, move: decision.move, reason: decision.reason });
  }
  return { ...decision.progress, evidence: [...log, ...entries].slice(-EVIDENCE_LIMIT) };
};

export const planMove = (progress, options) => {
  const decision = decide(progress, options);
  return { ...decision, progress: recordEvidence(progress, decision, options) };
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
