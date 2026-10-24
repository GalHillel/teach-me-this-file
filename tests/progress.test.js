import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, STALL_LIMIT, activeStepIndex, createProgress, lessonPace, planMove, stepsToReview } from '../server/lesson/progress.js';

const plan = { steps: [{ title: 'Cells' }, { title: 'Nucleus' }, { title: 'Membrane' }] };

const grade = (verdict, confidence = 'high', issue = 'none') => ({ verdict, confidence, issue });
const answer = (progress, verdict, confidence, issue) => planMove(progress, { kind: 'reply', assessment: grade(verdict, confidence, issue) });

const run = (verdicts, start = createProgress(plan)) =>
  verdicts.reduce(
    ({ progress, moves }, verdict) => {
      const result = answer(progress, ...[].concat(verdict));
      return { progress: result.progress, moves: [...moves, result.move] };
    },
    { progress: start, moves: [] },
  );

describe('lesson progress state machine', () => {
  it('starts on the first step in the learn phase', () => {
    const progress = createProgress(plan);
    expect(progress.currentStep).toBe(0);
    expect(progress.steps[0]).toEqual({ status: 'active', phase: 'learn', attempts: 0, stalls: 0, probed: false, outcome: null });
    expect(progress.review).toBe(null);
    expect(progress.steps.slice(1).every((step) => step.status === 'pending')).toBe(true);
    expect(planMove(progress, { kind: 'start' }).move).toBe('introduce');
  });

  it('advances on a correct first answer and records mastery', () => {
    const { move, progress } = answer(createProgress(plan), 'correct');
    expect(move).toBe('advance');
    expect(progress.currentStep).toBe(1);
    expect(progress.steps[0]).toMatchObject({ status: 'done', outcome: 'mastered' });
    expect(progress.steps[1].status).toBe('active');
  });

  it('gives two hints, then explains and re-checks instead of moving on', () => {
    const { progress, moves } = run(['incorrect', 'partial', 'incorrect']);
    expect(moves).toEqual(['hint', 'hint', 'reveal_and_recheck']);
    expect(progress.currentStep).toBe(0);
    expect(progress.steps[0]).toMatchObject({ phase: 'recheck', attempts: MAX_ATTEMPTS, status: 'active' });
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

  it('probes once when a correct answer is graded with low confidence', () => {
    const first = answer(createProgress(plan), 'correct', 'low');
    expect(first.move).toBe('probe');
    expect(first.progress.currentStep).toBe(0);
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
    expect(planMove(createProgress(plan), { kind: 'reply', assessment: null }).move).toBe('clarify');
  });

  it('counts a non-answer as an attempt after too many in a row, so a step can not stall forever', () => {
    const verdicts = Array.from({ length: STALL_LIMIT + 1 }, () => 'off_topic');
    const { progress, moves } = run(verdicts);
    expect(moves).toEqual([...Array(STALL_LIMIT).fill('redirect'), 'hint']);
    expect(progress.steps[0]).toMatchObject({ attempts: 1, stalls: 0 });
  });

  it('needs at most 15 non-question replies to end a step, and that bound is reached', () => {
    const worst = [
      'off_topic', 'unclear', ['correct', 'low'],
      'off_topic', 'unclear', 'off_topic',
      'off_topic', 'unclear', 'off_topic',
      'off_topic', 'unclear', 'off_topic',
      'off_topic', 'unclear', 'off_topic',
    ];
    const before = run(worst.slice(0, -1), createProgress({ steps: [{ title: 'Only' }] }));
    expect(before.progress.status).toBe('active');
    const after = run(worst, createProgress({ steps: [{ title: 'Only' }] }));
    expect(after.progress).toMatchObject({ status: 'completed' });
    expect(after.progress.steps[0].outcome).toBe('review');
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

  it('explains again instead of hinting when the student does not know', () => {
    const { moves, progress } = run([['incorrect', 'high', 'no_knowledge'], ['incorrect', 'high', 'no_knowledge'], ['incorrect', 'high', 'no_knowledge']]);
    expect(moves).toEqual(['reteach', 'reteach', 'reveal_and_recheck']);
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

  it('finishes the lesson after the last step', () => {
    const { progress, moves } = run(['correct', 'correct', 'correct']);
    expect(moves.at(-1)).toBe('finish');
    expect(progress.status).toBe('completed');
    expect(answer(progress, 'correct').move).toBe('free_chat');
  });

  it('finishes with a review when the last re-check fails', () => {
    const { progress, moves } = run(['correct', 'correct', 'incorrect', 'incorrect', 'incorrect', 'incorrect']);
    expect(moves.at(-1)).toBe('review_and_finish');
    expect(progress.status).toBe('completed');
  });

  it('reviews the weak steps once after the lesson and records the results', () => {
    const { progress: done } = run(['incorrect', 'incorrect', 'incorrect', 'correct', 'correct', 'partial', 'incorrect', 'correct']);
    expect(done.status).toBe('completed');
    const start = planMove(done, { kind: 'review' });
    expect(start.move).toBe('review_question');
    expect(start.progress).toMatchObject({ status: 'reviewing', review: { queue: [0, 2], position: 0, results: {} } });
    expect(activeStepIndex(start.progress)).toBe(0);

    const first = answer(start.progress, 'correct');
    expect(first.move).toBe('review_next');
    expect(activeStepIndex(first.progress)).toBe(2);
    const second = answer(first.progress, 'incorrect');
    expect(second.move).toBe('review_finish');
    expect(second.progress).toMatchObject({ status: 'completed', review: { results: { 0: 'pass', 2: 'fail' } } });
    expect(second.progress.steps.map((step) => step.outcome)).toEqual(done.steps.map((step) => step.outcome));
  });

  it('answers questions during the review and limits non-answers there too', () => {
    const { progress: done } = run(['incorrect', 'incorrect', 'incorrect', 'correct', 'correct', 'correct']);
    const start = planMove(done, { kind: 'review' }).progress;
    expect(answer(start, 'question').move).toBe('answer_question');
    const moves = run(['off_topic', 'off_topic', 'off_topic'], start).moves;
    expect(moves).toEqual(['redirect', 'redirect', 'review_finish']);
  });

  it('has nothing to review after a clean lesson, and only reviews a completed lesson', () => {
    const { progress } = run(['correct', 'correct', 'correct']);
    expect(planMove(progress, { kind: 'review' }).move).toBe('free_chat');
    expect(planMove(createProgress(plan), { kind: 'review' }).move).toBe('clarify');
  });

  it('never mutates the previous state', () => {
    const progress = createProgress(plan);
    const snapshot = structuredClone(progress);
    answer(progress, 'incorrect');
    answer(progress, 'correct', 'low');
    answer(progress, 'off_topic');
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
