import { describe, expect, it } from 'vitest';
import { finalCheckQueue, reviewSchedule, stepEvidence } from '../shared/lesson.js';
import { MAX_ATTEMPTS, STALL_LIMIT, activeStepIndex, createProgress, lessonPace, planMove, stepsToReview } from '../server/lesson/progress.js';

const makePlan = (titles, prerequisites = {}) => ({
  steps: titles.map((title, index) => ({
    id: `s${index + 1}`,
    title,
    goal: `Understand ${title}`,
    keyConcepts: [title.toLowerCase()],
    prerequisites: prerequisites[index] ?? [],
  })),
});

const plan = makePlan(['Cells', 'Nucleus', 'Membrane']);

const grade = (verdict, confidence = 'high', issue = 'none', extra = {}) => ({ verdict, confidence, issue, ...extra });
const answerIn = (lessonPlan) => (progress, verdict, confidence, issue, extra) => planMove(progress, { kind: 'reply', assessment: grade(verdict, confidence, issue, extra), plan: lessonPlan });
const answer = answerIn(plan);
const request = (progress, kind, lessonPlan = plan) => planMove(progress, { kind, plan: lessonPlan });

const runIn = (lessonPlan) => (verdicts, start = createProgress(lessonPlan)) =>
  verdicts.reduce(
    ({ progress, moves, interventions }, verdict) => {
      const result = answerIn(lessonPlan)(progress, ...[].concat(verdict));
      return { progress: result.progress, moves: [...moves, result.move], interventions: [...interventions, result.intervention] };
    },
    { progress: start, moves: [], interventions: [] },
  );
const run = runIn(plan);

describe('lesson progress state machine', () => {
  it('starts on the first step in the learn phase', () => {
    const progress = createProgress(plan);
    expect(progress.currentStep).toBe(0);
    expect(progress.steps[0]).toEqual({ status: 'active', phase: 'learn', attempts: 0, stalls: 0, probed: false, outcome: null, hints: 0, used: [], detour: null, revisit: null });
    expect(progress.review).toBe(null);
    expect(progress.final).toBe(null);
    expect(progress.steps.slice(1).every((step) => step.status === 'pending')).toBe(true);
    expect(request(progress, 'start').move).toBe('introduce');
  });

  it('advances on a correct first answer and records mastery', () => {
    const { move, progress } = answer(createProgress(plan), 'correct');
    expect(move).toBe('advance');
    expect(progress.currentStep).toBe(1);
    expect(progress.steps[0]).toMatchObject({ status: 'done', outcome: 'mastered' });
    expect(progress.steps[1].status).toBe('active');
  });

  it('gives two different hints, then explains and re-checks instead of moving on', () => {
    const { progress, moves, interventions } = run(['incorrect', 'partial', 'incorrect']);
    expect(moves).toEqual(['hint', 'hint', 'reveal_and_recheck']);
    expect(interventions).toEqual(['nudge', 'focused_hint', 'guided_solution']);
    expect(progress.steps[0]).toMatchObject({ phase: 'recheck', attempts: MAX_ATTEMPTS, status: 'active', used: ['nudge', 'focused_hint', 'guided_solution'] });
  });

  it('answers a misconception with a counter-example, and never repeats the same help on a step', () => {
    const wrongIdea = { misconception: 'thinks cells are only in animals' };
    const { interventions } = run([['incorrect', 'high', 'none', wrongIdea], ['incorrect', 'high', 'none', wrongIdea]]);
    expect(interventions).toEqual(['counterexample', 'focused_hint']);
  });

  it('marks a step recovered when the re-check is answered correctly', () => {
    const { progress, moves } = run(['incorrect', 'incorrect', 'incorrect', 'correct']);
    expect(moves.at(-1)).toBe('advance');
    expect(progress.steps[0]).toMatchObject({ status: 'done', outcome: 'recovered' });
    expect(progress.currentStep).toBe(1);
  });

  it('moves on but marks the step for review when the re-check fails', () => {
    const { progress, moves } = run(['incorrect', 'incorrect', 'incorrect', 'partial']);
    expect(moves.at(-1)).toBe('review_and_advance');
    expect(progress.steps[0]).toMatchObject({ status: 'done', outcome: 'review' });
  });

  it('records a step learned after hints', () => {
    const { progress } = run(['partial', 'correct']);
    expect(progress.steps[0].outcome).toBe('learned');
  });

  it('gives a requested hint without counting an attempt, and a right answer after it is not mastery', () => {
    const hinted = request(createProgress(plan), 'hint');
    expect(hinted).toMatchObject({ move: 'hint', intervention: 'nudge', requested: true });
    expect(hinted.progress.steps[0]).toMatchObject({ attempts: 0, hints: 1, used: ['nudge'] });
    const second = request(hinted.progress, 'hint');
    expect(second.intervention).toBe('focused_hint');
    expect(answer(second.progress, 'correct').progress.steps[0].outcome).toBe('learned');
  });

  it('explains differently on request with an analogy first, then a worked example', () => {
    const first = request(createProgress(plan), 'explain');
    expect(first).toMatchObject({ move: 'reteach', intervention: 'analogy' });
    expect(request(first.progress, 'explain').intervention).toBe('worked_example');
  });

  it('refuses help requests outside the learning phase', () => {
    const { progress } = run(['correct', 'correct', 'correct']);
    expect(request(progress, 'hint').move).toBe('clarify');
    expect(request(progress, 'explain').progress).toBe(progress);
  });

  it('probes once when a correct answer is graded with low confidence', () => {
    const first = answer(createProgress(plan), 'correct', 'low');
    expect(first.move).toBe('probe');
    expect(first.progress.steps[0]).toMatchObject({ probed: true, attempts: 0 });
    const second = answer(first.progress, 'correct', 'low');
    expect(second.move).toBe('advance');
    expect(second.progress.steps[0].outcome).toBe('mastered');
  });

  it('does not probe during a re-check', () => {
    const { progress } = run(['incorrect', 'incorrect', 'incorrect']);
    expect(answer(progress, 'correct', 'low').move).toBe('advance');
  });

  it('answers questions without counting an attempt', () => {
    const { move, progress } = answer(createProgress(plan), 'question');
    expect(move).toBe('answer_question');
    expect(progress.steps[0].attempts).toBe(0);
  });

  it('redirects off-topic messages and asks again after unclear grades', () => {
    expect(answer(createProgress(plan), 'off_topic').move).toBe('redirect');
    expect(answer(createProgress(plan), 'unclear').move).toBe('clarify');
    expect(planMove(createProgress(plan), { kind: 'reply', assessment: null, plan }).move).toBe('clarify');
  });

  it('counts a non-answer as an attempt after too many in a row, so a step can not stall forever', () => {
    const verdicts = Array.from({ length: STALL_LIMIT + 1 }, () => 'off_topic');
    const { progress, moves } = run(verdicts);
    expect(moves).toEqual([...Array(STALL_LIMIT).fill('redirect'), 'hint']);
    expect(progress.steps[0]).toMatchObject({ attempts: 1, stalls: 0 });
  });

  it('needs at most 15 non-question replies to end a step without prerequisites, and that bound is reached', () => {
    const single = makePlan(['Only']);
    const worst = [
      'off_topic', 'unclear', ['correct', 'low'],
      'off_topic', 'unclear', 'off_topic',
      'off_topic', 'unclear', 'off_topic',
      'off_topic', 'unclear', 'off_topic',
      'off_topic', 'unclear', 'off_topic',
    ];
    const before = runIn(single)(worst.slice(0, -1));
    expect(before.progress.steps[0].status).toBe('active');
    const after = runIn(single)(worst);
    expect(after.progress.steps[0]).toMatchObject({ status: 'done', outcome: 'review' });
    expect(after.moves.at(-1)).toBe('final_check_start');
  });

  it('ends the re-check as review after too many non-answers instead of explaining again', () => {
    const { progress, moves } = run(['incorrect', 'incorrect', 'incorrect', 'off_topic', 'unclear', 'off_topic']);
    expect(moves.slice(3)).toEqual(['redirect', 'clarify', 'review_and_advance']);
    expect(progress.steps[0]).toMatchObject({ status: 'done', outcome: 'review', attempts: MAX_ATTEMPTS });
  });

  it('does not let questions reset the stall counter, so mixing them in can not stall a step', () => {
    const { progress, moves } = run(['off_topic', 'off_topic', 'question', 'off_topic']);
    expect(moves).toEqual(['redirect', 'redirect', 'answer_question', 'hint']);
    expect(progress.steps[0]).toMatchObject({ attempts: 1, stalls: 0 });
  });

  it('rephrases the question when the student answered a different one, without counting an attempt', () => {
    const { move, progress } = answer(createProgress(plan), 'incorrect', 'high', 'misread_question');
    expect(move).toBe('rephrase');
    expect(progress.steps[0]).toMatchObject({ attempts: 0, stalls: 1 });
    const { moves } = run([['incorrect', 'high', 'misread_question'], ['partial', 'high', 'misread_question'], ['incorrect', 'high', 'misread_question']]);
    expect(moves).toEqual(['rephrase', 'rephrase', 'hint']);
  });

  it('explains again with a worked example, then an analogy, when the student does not know', () => {
    const { moves, interventions, progress } = run([['incorrect', 'high', 'no_knowledge'], ['incorrect', 'high', 'no_knowledge'], ['incorrect', 'high', 'no_knowledge']]);
    expect(moves).toEqual(['reteach', 'reteach', 'reveal_and_recheck']);
    expect(interventions).toEqual(['worked_example', 'analogy', 'guided_solution']);
    expect(progress.steps[0].attempts).toBe(MAX_ATTEMPTS);
  });

  it('probes once for hedged or unjustified right answers', () => {
    expect(answer(createProgress(plan), 'correct', 'high', 'hedged').move).toBe('probe');
    expect(answer(createProgress(plan), 'correct', 'high', 'unjustified').move).toBe('probe');
    const { moves } = run([['correct', 'high', 'unjustified'], ['correct', 'high', 'unjustified']]);
    expect(moves).toEqual(['probe', 'advance']);
  });

  it('resets the stall counter when the student answers', () => {
    const { progress } = run(['off_topic', 'off_topic', 'partial', 'off_topic']);
    expect(progress.steps[0]).toMatchObject({ attempts: 1, stalls: 1 });
  });

  it('always reaches the end of a step: no sequence of answers keeps it active forever', () => {
    const verdicts = ['off_topic', 'unclear', 'off_topic', 'question', 'unclear', 'incorrect', 'off_topic', 'off_topic', 'off_topic', 'partial', 'unclear', 'unclear', 'unclear'];
    const { progress } = run(verdicts);
    expect(progress.currentStep).toBe(1);
    expect(progress.steps[0].outcome).toBe('review');
  });

  it('never mutates the previous state', () => {
    const progress = createProgress(plan);
    const snapshot = structuredClone(progress);
    answer(progress, 'incorrect');
    answer(progress, 'correct', 'low');
    answer(progress, 'off_topic');
    request(progress, 'hint');
    expect(progress).toEqual(snapshot);
  });

  it('adapts pace and lists steps to review', () => {
    expect(lessonPace(createProgress(plan))).toBe('normal');
    expect(lessonPace(answer(createProgress(plan), 'incorrect').progress)).toBe('slower');
    expect(lessonPace(run(['correct', 'correct']).progress)).toBe('faster');
    expect(lessonPace(run(['incorrect', 'incorrect', 'incorrect', 'correct']).progress)).toBe('slower');
    const { progress } = run(['incorrect', 'incorrect', 'incorrect', 'correct', 'partial', 'correct']);
    expect(stepsToReview(plan, progress)).toEqual(['Cells']);
  });
});

describe('going back to a prerequisite', () => {
  const chain = makePlan(['Photosynthesis inputs', 'Chlorophyll role', 'Glucose output'], { 1: ['s1'], 2: ['s1', 's2'] });
  const runChain = runIn(chain);
  const answerChain = answerIn(chain);

  it('checks the earlier step when the missing ideas belong to it, then returns to the current question', () => {
    const { progress: atStep2 } = runChain(['correct']);
    const gap = answerChain(atStep2, 'incorrect', 'high', 'none', { conceptsMissing: ['the photosynthesis inputs'] });
    expect(gap).toMatchObject({ move: 'prerequisite_check', intervention: 'prerequisite', prerequisite: { index: 0, reason: 'missing_concept' } });
    expect(gap.progress.steps[1]).toMatchObject({ detour: 0, attempts: 1, used: ['prerequisite'] });

    const back = answerChain(gap.progress, 'correct');
    expect(back.move).toBe('resume');
    expect(back.progress.steps[1]).toMatchObject({ detour: null, status: 'active', attempts: 1 });
    expect(back.progress.steps[0].revisit).toBe('pass');
  });

  it('records a failed revisit and re-explains before returning; only one detour per step', () => {
    const { progress: atStep2 } = runChain(['correct']);
    const gap = answerChain(atStep2, 'incorrect', 'high', 'none', { conceptsMissing: ['photosynthesis inputs'] });
    const back = answerChain(gap.progress, 'incorrect');
    expect(back.move).toBe('resume_after_reteach');
    expect(back.progress.steps[0].revisit).toBe('fail');
    const again = answerChain(back.progress, 'incorrect', 'high', 'none', { conceptsMissing: ['photosynthesis inputs'] });
    expect(again).toMatchObject({ move: 'hint', intervention: 'focused_hint' });
    expect(again.progress.steps[1].attempts).toBe(2);
  });

  it('goes back to a weak prerequisite even when the grader names no concept', () => {
    const { progress } = runChain(['incorrect', 'incorrect', 'incorrect', 'partial']);
    expect(progress.steps[0].outcome).toBe('review');
    const first = answerChain(progress, 'incorrect');
    expect(first).toMatchObject({ move: 'prerequisite_check', prerequisite: { index: 0, reason: 'weak_prerequisite' } });
  });

  it('does not count concepts the current step itself teaches as a prerequisite gap', () => {
    const { progress: atStep2 } = runChain(['correct']);
    expect(answerChain(atStep2, 'incorrect', 'high', 'none', { conceptsMissing: ['chlorophyll role'] }).move).toBe('hint');
  });

  it('remembers the detour even after many other kinds of help, so it never happens twice on a step', () => {
    const { progress: atStep2 } = runChain(['correct']);
    const gap = answerChain(atStep2, 'incorrect', 'high', 'none', { conceptsMissing: ['photosynthesis inputs'] });
    let progress = answerChain(gap.progress, 'correct').progress;
    for (let turn = 0; turn < 10; turn += 1) progress = request(progress, turn % 2 ? 'hint' : 'explain', chain).progress;
    expect(progress.steps[1].used).toContain('prerequisite');
    expect(progress.steps[1].used.length).toBeLessThanOrEqual(8);
    expect(answerChain(progress, 'incorrect', 'high', 'none', { conceptsMissing: ['photosynthesis inputs'] }).move).not.toBe('prerequisite_check');
  });

  it('counts a passed final check as applied, even after a failed revisit', () => {
    const { progress: atStep2 } = runChain(['correct']);
    const gap = answerChain(atStep2, 'incorrect', 'high', 'none', { conceptsMissing: ['photosynthesis inputs'] });
    const back = answerChain(gap.progress, 'incorrect');
    const { progress: checking } = runChain(['correct', 'correct'], back.progress);
    expect(checking.review.kind).toBe('final');
    expect(checking.review.queue).toContain(0);
    const { progress: done } = runChain(checking.review.queue.map(() => 'correct'), checking);
    expect(done.steps[0].revisit).toBe('fail');
    expect(stepEvidence(done, 0)).toMatchObject({ level: 'applied', signals: expect.arrayContaining(['prerequisite_gap', 'final_pass']) });
  });

  it('limits non-answers during the detour', () => {
    const { progress: atStep2 } = runChain(['correct']);
    const gap = answerChain(atStep2, 'incorrect', 'high', 'none', { conceptsMissing: ['photosynthesis inputs'] });
    const { moves, progress } = runChain(['off_topic', 'question', 'unclear', 'off_topic'], gap.progress);
    expect(moves).toEqual(['redirect', 'answer_question', 'clarify', 'resume_after_reteach']);
    expect(progress.steps[1].detour).toBe(null);
  });
});

describe('final check', () => {
  it('starts a short final check when the last step is done, instead of ending the lesson', () => {
    const { progress, moves } = run(['correct', 'correct', 'correct']);
    expect(moves.at(-1)).toBe('final_check_start');
    expect(progress.status).toBe('reviewing');
    expect(progress.review).toMatchObject({ kind: 'final', position: 0, results: {} });
    expect(progress.review.queue).toHaveLength(3);
  });

  it('grades each final question once, with no hints, and records the results', () => {
    const { progress: checking } = run(['correct', 'correct', 'correct']);
    const { progress, moves } = run(['correct', 'partial', 'correct'], checking);
    expect(moves).toEqual(['final_next', 'final_next', 'final_finish']);
    expect(progress).toMatchObject({ status: 'completed', review: null, final: { results: { 0: 'pass', 1: 'fail', 2: 'pass' }, skipped: false } });
  });

  it('asks again after a misread or unclear answer, and stops after too many', () => {
    const { progress: checking } = run(['correct', 'correct', 'correct']);
    expect(run([['incorrect', 'high', 'misread_question']], checking).moves).toEqual(['rephrase']);
    const { moves, progress } = run(['off_topic', 'unclear', 'off_topic'], checking);
    expect(moves).toEqual(['redirect', 'clarify', 'final_next']);
    expect(progress.review.results[checking.review.queue[0]]).toBe('fail');
  });

  it('can be skipped, and then nothing counts as applied', () => {
    const { progress: checking } = run(['correct', 'correct', 'correct']);
    const skipped = request(checking, 'skip_final');
    expect(skipped.move).toBe('finish_skipped');
    expect(skipped.progress).toMatchObject({ status: 'completed', final: { skipped: true } });
    expect(stepEvidence(skipped.progress, 0).level).toBe('shown');
    expect(request(createProgress(plan), 'skip_final').move).toBe('clarify');
  });

  it('chooses the weakest and most foundational steps, skips the one just answered, and keeps lesson order', () => {
    const lessonPlan = makePlan(['A', 'B', 'C', 'D', 'E'], { 2: ['s1'], 3: ['s1'], 4: ['s3'] });
    const progress = {
      steps: [
        { outcome: 'mastered', hints: 0 },
        { outcome: 'learned', hints: 1 },
        { outcome: 'mastered', hints: 0 },
        { outcome: 'review', hints: 0 },
        { outcome: 'recovered', hints: 0 },
      ],
    };
    expect(finalCheckQueue(lessonPlan, progress)).toEqual([0, 1, 3]);
    expect(finalCheckQueue(makePlan(['Only']), { steps: [{ outcome: 'mastered' }] })).toEqual([0]);
  });

  it('turns final results and revisits into evidence levels and a review schedule', () => {
    const { progress: checking } = run(['correct', 'partial', 'correct', 'correct']);
    const { progress } = run(['correct', 'incorrect', 'correct'], checking);
    expect(progress.steps.map((_, index) => stepEvidence(progress, index).level)).toEqual(['applied', 'needs_practice', 'applied']);
    expect(stepEvidence(progress, 1).signals).toEqual(['final_fail']);
    expect(reviewSchedule(progress).map((item) => [item.index, item.days])).toEqual([[1, 1], [0, 14], [2, 14]]);
  });

  it('practises what the final check showed was weak, and the practice result changes the evidence', () => {
    const { progress: checking } = run(['correct', 'correct', 'correct']);
    const { progress: done } = run(['correct', 'incorrect', 'correct'], checking);
    const start = request(done, 'review');
    expect(start.move).toBe('review_question');
    expect(start.progress.review).toMatchObject({ kind: 'practice', queue: [1] });
    expect(activeStepIndex(start.progress)).toBe(1);
    const finish = answer(start.progress, 'correct');
    expect(finish.move).toBe('review_finish');
    expect(stepEvidence(finish.progress, 1).level).toBe('shown_with_help');
  });

  it('has nothing to practise after a clean lesson, and only practises a completed lesson', () => {
    const { progress: checking } = run(['correct', 'correct', 'correct']);
    const { progress } = run(['correct', 'correct', 'correct'], checking);
    expect(request(progress, 'review').move).toBe('free_chat');
    expect(request(createProgress(plan), 'review').move).toBe('clarify');
    expect(answer(progress, 'correct').move).toBe('free_chat');
  });
});
