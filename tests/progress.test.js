import { describe, expect, it } from 'vitest';
import { createProgress, lessonPace, planMove, stepsToReview } from '../server/lesson/progress.js';

const plan = { steps: [{ title: 'Cells' }, { title: 'Nucleus' }, { title: 'Membrane' }] };

const answer = (progress, verdict) => planMove(progress, { kind: 'reply', verdict });

describe('lesson progress', () => {
  it('starts on the first step', () => {
    const progress = createProgress(plan);
    expect(progress.currentStep).toBe(0);
    expect(progress.steps.map((step) => step.status)).toEqual(['active', 'pending', 'pending']);
    expect(planMove(progress, { kind: 'start' }).move).toBe('introduce');
  });

  it('advances on a correct answer and records mastery', () => {
    const { move, progress } = answer(createProgress(plan), 'correct');
    expect(move).toBe('advance');
    expect(progress.currentStep).toBe(1);
    expect(progress.steps[0]).toEqual({ status: 'done', attempts: 0, outcome: 'mastered' });
    expect(progress.steps[1].status).toBe('active');
  });

  it('gives hints for wrong or partial answers before revealing', () => {
    let state = createProgress(plan);
    let result = answer(state, 'incorrect');
    expect(result.move).toBe('hint');
    expect(result.progress.steps[0].attempts).toBe(1);
    expect(result.progress.currentStep).toBe(0);

    state = result.progress;
    result = answer(state, 'partial');
    expect(result.move).toBe('hint');
    expect(result.progress.steps[0].attempts).toBe(2);

    result = answer(result.progress, 'incorrect');
    expect(result.move).toBe('reveal_and_advance');
    expect(result.progress.steps[0]).toMatchObject({ status: 'done', outcome: 'revealed' });
    expect(result.progress.currentStep).toBe(1);
  });

  it('records a step learned after hints', () => {
    const afterHint = answer(createProgress(plan), 'partial').progress;
    const { progress } = answer(afterHint, 'correct');
    expect(progress.steps[0].outcome).toBe('learned');
  });

  it('does not count questions or off-topic messages as attempts', () => {
    const progress = createProgress(plan);
    expect(answer(progress, 'question')).toEqual({ move: 'answer_question', progress });
    expect(answer(progress, 'off_topic')).toEqual({ move: 'redirect', progress });
    expect(answer(progress, 'unclear')).toEqual({ move: 'respond', progress });
  });

  it('finishes the lesson after the last step', () => {
    let progress = createProgress(plan);
    progress = answer(progress, 'correct').progress;
    progress = answer(progress, 'correct').progress;
    const result = answer(progress, 'correct');
    expect(result.move).toBe('finish');
    expect(result.progress.status).toBe('completed');
    expect(planMove(result.progress, { kind: 'reply', verdict: 'correct' }).move).toBe('free_chat');
  });

  it('never mutates the previous state', () => {
    const progress = createProgress(plan);
    const snapshot = structuredClone(progress);
    answer(progress, 'incorrect');
    answer(progress, 'correct');
    expect(progress).toEqual(snapshot);
  });

  it('adapts pace and lists steps to review', () => {
    let progress = createProgress(plan);
    expect(lessonPace(progress)).toBe('normal');
    expect(lessonPace(answer(progress, 'incorrect').progress)).toBe('slower');

    progress = answer(progress, 'correct').progress;
    progress = answer(progress, 'correct').progress;
    expect(lessonPace(progress)).toBe('faster');

    let struggling = createProgress(plan);
    for (let i = 0; i < 3; i += 1) struggling = answer(struggling, 'incorrect').progress;
    expect(stepsToReview(plan, struggling)).toEqual(['Cells']);
  });
});
