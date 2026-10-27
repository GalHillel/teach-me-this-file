import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_LIMIT, QUESTIONS, SUPPORTS, learnerModel, misconceptionsShown, stepState } from '../shared/learner.js';
import { createProgress, planMove } from '../server/lesson/progress.js';
import { validateTurnRequest } from '../server/validation.js';

const plan = {
  title: 'Sound',
  languageCode: 'en',
  audience: 'Students',
  style: '',
  objectives: [],
  steps: [
    { id: 's1', title: 'Vibration', goal: 'g', keyConcepts: ['vibration'], checkQuestion: 'Q1?', successCriteria: 's', commonMistake: '', prerequisites: [], sourceIds: ['c1'] },
    { id: 's2', title: 'Travel', goal: 'g', keyConcepts: ['medium'], checkQuestion: 'Q2?', successCriteria: 's', commonMistake: '', prerequisites: ['s1'], sourceIds: ['c2'] },
    { id: 's3', title: 'Speed', goal: 'g', keyConcepts: ['speed'], checkQuestion: 'Q3?', successCriteria: 's', commonMistake: '', prerequisites: ['s2'], sourceIds: ['c3'] },
  ],
};

const grade = (verdict, extra = {}) => ({ verdict, confidence: 'high', issue: 'none', misconception: '', conceptsMissing: [], missingPrerequisite: 0, ...extra });

const play = (moves, start = createProgress(plan)) => moves.reduce((state, item) => {
  const [kind, assessment] = typeof item === 'string' ? ['reply', grade(item)] : Array.isArray(item) ? ['reply', grade(...item)] : [item.kind, null];
  const decision = planMove(state.progress, { kind, assessment, plan, sourceIds: ['c1'] });
  return { progress: decision.progress, moves: [...state.moves, decision.move], reasons: [...state.reasons, decision.reason] };
}, { progress: start, moves: [], reasons: [] });

const progressWith = (entries, steps = ['done', 'done', 'active']) => ({
  ...createProgress(plan),
  currentStep: steps.indexOf('active'),
  steps: createProgress(plan).steps.map((step, index) => ({ ...step, status: steps[index], outcome: steps[index] === 'done' ? 'mastered' : null })),
  evidence: entries.map((entry, index) => ({ n: index + 1, step: 0, question: 'check', support: 'independent', verdict: 'correct', issue: 'none', misconception: '', sources: [], move: 'advance', reason: 'x', ...entry })),
});

describe('learner states', () => {
  it('starts every step as not assessed', () => {
    expect(learnerModel(plan, createProgress(plan)).map((step) => [step.state, step.confidence])).toEqual([['not_assessed', null], ['not_assessed', null], ['not_assessed', null]]);
  });

  it('counts an independent right answer as demonstrated with medium confidence, and a later independent transfer as high', () => {
    expect(stepState(progressWith([{}]), 0)).toMatchObject({ state: 'demonstrated', confidence: 'medium', basis: 'independent_answer', independent: true });
    expect(stepState(progressWith([{}, { question: 'transfer' }]), 0)).toMatchObject({ state: 'demonstrated', confidence: 'high', transfer: true });
  });

  it('never counts a right answer after a hint, narrowing, a worked solution or a reminder as demonstrated', () => {
    for (const support of ['hinted', 'narrowed', 'worked', 'reminded']) {
      const model = stepState(progressWith([{ verdict: 'incorrect' }, { support }]), 0);
      expect(model.state, support).not.toBe('demonstrated');
      expect(model.assisted).toBe(true);
      expect(model.confidence).not.toBe('high');
    }
    expect(stepState(progressWith([{ support: 'hinted' }]), 0)).toMatchObject({ state: 'developing', basis: 'hinted_answer' });
  });

  it('does not count copied, unsure or unexplained right answers as demonstrated until the student answers in their own words', () => {
    for (const issue of ['copied', 'hedged', 'unjustified']) {
      expect(stepState(progressWith([{ issue }]), 0)).toMatchObject({ state: 'emerging', basis: `${issue}_answer`, independent: false });
    }
    expect(stepState(progressWith([{ issue: 'copied' }, {}]), 0).state).toBe('demonstrated');
  });

  it('separates a named misconception from a partial answer, and a miss after the full explanation', () => {
    expect(stepState(progressWith([{ verdict: 'incorrect', misconception: 'sound is air from the mouth' }]), 0)).toMatchObject({ state: 'developing', basis: 'misconception', misconceptions: ['sound is air from the mouth'] });
    expect(stepState(progressWith([{ verdict: 'partial' }]), 0)).toMatchObject({ state: 'emerging', basis: 'partial_answer', confidence: 'low' });
    expect(stepState(progressWith([{ verdict: 'incorrect', misconception: 'm' }, { verdict: 'incorrect', support: 'worked' }]), 0)).toMatchObject({ state: 'emerging', basis: 'wrong_after_explanation' });
  });

  it('moves a step to needs review when a later step reveals a gap, and a reminded answer does not undo it', () => {
    const gap = progressWith([{}, { gap: true, question: undefined }, { question: 'detour', support: 'reminded' }]);
    expect(stepState(gap, 0)).toMatchObject({ state: 'needs_review', basis: 'later_gap', gap: true });
    const restored = progressWith([{}, { gap: true }, { question: 'detour', support: 'reminded' }, { question: 'transfer' }]);
    expect(stepState(restored, 0)).toMatchObject({ state: 'demonstrated', confidence: 'medium' });
  });

  it('moves a step to needs review when a transfer or practice answer misses it', () => {
    expect(stepState(progressWith([{}, { question: 'transfer', verdict: 'incorrect' }]), 0)).toMatchObject({ state: 'needs_review', basis: 'missed_transfer' });
    expect(stepState(progressWith([{ support: 'hinted' }, { question: 'practice', verdict: 'partial' }]), 0)).toMatchObject({ state: 'needs_review', basis: 'missed_practice' });
  });

  it('keeps the evidence numbers behind each state, and reads older sessions without a log from the step fields', () => {
    expect(stepState(progressWith([{}, { question: 'transfer' }]), 0).evidence).toEqual([1, 2]);
    const old = { ...createProgress(plan), evidence: undefined, status: 'completed', steps: createProgress(plan).steps.map((step, index) => ({ ...step, status: 'done', outcome: ['mastered', 'learned', 'review'][index], revisit: index === 0 ? 'pass' : null })), final: { results: { 1: 'pass', 2: 'fail' }, skipped: false } };
    expect(learnerModel(plan, old).map((step) => step.state)).toEqual(['needs_review', 'demonstrated', 'emerging']);
    expect(stepState(old, 0).evidence).toEqual([]);
  });

  it('reads steps finished before the log started from their outcome', () => {
    const seeded = { ...progressWith([], ['done', 'done', 'active']), steps: progressWith([], ['done', 'done', 'active']).steps.map((step, index) => ({ ...step, outcome: index === 1 ? 'recovered' : step.outcome })) };
    expect(learnerModel(plan, seeded).map((step) => [step.state, step.worked])).toEqual([['demonstrated', false], ['developing', true], ['not_assessed', false]]);
  });

  it('lists the wrong ideas a student showed per step, without repeats', () => {
    const progress = progressWith([{ verdict: 'incorrect', misconception: 'a' }, { verdict: 'incorrect', misconception: 'a' }, { step: 1, verdict: 'partial', misconception: 'b' }]);
    expect(misconceptionsShown(progress)).toEqual({ 0: ['a'], 1: ['b'] });
  });
});

describe('the evidence the policy records', () => {
  it('records each graded answer with its question, support, sources, move and reason', () => {
    const { progress } = play(['incorrect', 'correct']);
    expect(progress.evidence).toEqual([
      { n: 1, step: 0, question: 'check', support: 'independent', verdict: 'incorrect', issue: 'none', misconception: '', sources: ['c1'], move: 'hint', reason: 'first_wrong' },
      { n: 2, step: 0, question: 'check', support: 'hinted', verdict: 'correct', issue: 'none', misconception: '', sources: ['c1'], move: 'advance', reason: 'right_with_help' },
    ]);
    expect(stepState(progress, 0).state).toBe('developing');
  });

  it('marks answers to a narrowed question as narrowed, and the rebuilt whole answer as narrowed help', () => {
    const { progress, moves } = play(['incorrect', ['incorrect', { misconception: 'm' }], 'correct', 'correct']);
    expect(moves).toEqual(['hint', 'hint', 'build_up', 'advance']);
    expect(progress.evidence.map((entry) => [entry.question, entry.support])).toEqual([['check', 'independent'], ['check', 'hinted'], ['narrowed', 'narrowed'], ['check', 'narrowed']]);
    expect(stepState(progress, 0).state).toBe('developing');
  });

  it('records a gap on the earlier step when it goes back to it, and the detour answer as reminded', () => {
    const { progress: atStep2 } = play(['correct']);
    const { progress, moves, reasons } = play([['incorrect', { missingPrerequisite: 1 }], 'correct'], atStep2);
    expect(moves).toEqual(['prerequisite_check', 'resume']);
    expect(reasons).toEqual(['grader', 'earlier_step_right']);
    expect(progress.evidence.slice(1).map((entry) => [entry.step, entry.gap ?? false, entry.question, entry.support])).toEqual([[1, false, 'check', 'independent'], [0, true, undefined, undefined], [0, false, 'detour', 'reminded']]);
    expect(progress.evidence[2]).toMatchObject({ from: 1, move: 'prerequisite_check' });
    expect(learnerModel(plan, progress).map((step) => step.state)).toEqual(['needs_review', 'emerging', 'not_assessed']);
  });

  it('does not record questions, unclear or off-topic messages, or help requests as evidence', () => {
    const { progress } = play(['question', 'unclear', 'off_topic', { kind: 'hint' }, ['partial', { issue: 'misread_question' }]]);
    expect(progress.evidence).toEqual([]);
  });

  it('records final-check answers as transfer and practice answers as practice', () => {
    const { progress: checking } = play(['correct', 'correct', 'correct']);
    const { progress: done } = play(['correct', 'incorrect', 'correct'], checking);
    expect(done.evidence.slice(3).map((entry) => [entry.step, entry.question, entry.support, entry.verdict])).toEqual([[0, 'transfer', 'independent', 'correct'], [1, 'transfer', 'independent', 'incorrect'], [2, 'transfer', 'independent', 'correct']]);
    const { progress: practised } = play([{ kind: 'review' }, 'correct'], done);
    expect(practised.evidence.at(-1)).toMatchObject({ step: 1, question: 'practice', verdict: 'correct' });
  });

  it('keeps at most the last entries the server accepts, numbered in order', () => {
    let progress = createProgress(plan);
    for (let index = 0; index < EVIDENCE_LIMIT + 10; index += 1) progress = { ...progress, steps: progress.steps.map((step, position) => (position === 0 ? { ...step, attempts: 0 } : step)), evidence: planMove(progress, { kind: 'reply', assessment: grade('partial'), plan }).progress.evidence };
    expect(progress.evidence).toHaveLength(EVIDENCE_LIMIT);
    expect(progress.evidence.at(-1).n).toBe(EVIDENCE_LIMIT + 10);
  });

  it('leaves sessions saved before the log as they were', () => {
    const { evidence, ...old } = createProgress(plan);
    expect(evidence).toEqual([]);
    expect(planMove(old, { kind: 'reply', assessment: grade('incorrect'), plan }).progress.evidence).toBeUndefined();
  });
});

describe('going back to a fragile earlier step', () => {
  const atStep2 = (outcome) => ({ ...createProgress(plan), currentStep: 1, steps: createProgress(plan).steps.map((step, index) => ({ ...step, status: ['done', 'active', 'pending'][index], outcome: index === 0 ? outcome : null })) });

  it('goes back after the second wrong answer when the earlier step was only right with help', () => {
    expect(play(['incorrect', 'incorrect'], atStep2('learned')).moves).toEqual(['hint', 'prerequisite_check']);
    expect(play(['incorrect', 'incorrect'], atStep2('mastered')).moves).toEqual(['hint', 'hint']);
  });

  it('goes back after the first wrong answer when the earlier step needed the full explanation or showed a gap', () => {
    expect(play(['incorrect'], atStep2('recovered')).moves).toEqual(['prerequisite_check']);
    const gapped = { ...atStep2('mastered'), evidence: [{ n: 1, step: 0, gap: true, from: 2, move: 'prerequisite_check', reason: 'grader' }] };
    expect(play(['incorrect'], gapped).moves).toEqual(['prerequisite_check']);
    expect(play(['incorrect'], gapped).reasons).toEqual(['weak_prerequisite']);
  });
});

describe('learner model properties', () => {
  const VERDICTS = ['correct', 'partial', 'incorrect', 'question', 'off_topic', 'unclear'];
  const eventArb = fc.oneof(
    { weight: 10, arbitrary: fc.record({ verdict: fc.constantFrom(...VERDICTS), issue: fc.constantFrom('none', 'copied', 'hedged', 'unjustified', 'no_knowledge', 'misread_question'), misconception: fc.constantFrom('', 'm'), missingPrerequisite: fc.integer({ min: 0, max: 3 }) }).map((assessment) => ({ kind: 'reply', assessment: grade(assessment.verdict, assessment) })) },
    { weight: 1, arbitrary: fc.constantFrom({ kind: 'review' }, { kind: 'hint' }, { kind: 'explain' }, { kind: 'skip_final' }) },
  );

  it('gives every move a reason, keeps the log valid, and never claims demonstrated without an independent right answer on the step', () => {
    fc.assert(fc.property(fc.array(eventArb, { maxLength: 80 }), (events) => {
      let progress = createProgress(plan);
      for (const event of events) {
        const decision = planMove(progress, { kind: event.kind, assessment: event.assessment ?? null, plan, sourceIds: ['c2'] });
        expect(decision.reason).toMatch(/^[a-z_]+$/);
        progress = decision.progress;
        for (const entry of progress.evidence) {
          if (!entry.gap) {
            expect(QUESTIONS).toContain(entry.question);
            expect(SUPPORTS).toContain(entry.support);
          }
        }
        for (const step of learnerModel(plan, progress)) {
          const own = progress.evidence.filter((entry) => entry.step === step.index);
          if (step.state === 'demonstrated') expect(own.some((entry) => entry.verdict === 'correct' && entry.support === 'independent' && !['copied', 'hedged', 'unjustified'].includes(entry.issue))).toBe(true);
          if (step.confidence === 'high') expect(step.state).toBe('demonstrated');
        }
      }
      const body = { kind: 'reply', teacherPrompt: 'Teach', plan, progress, history: [], studentMessage: 'answer', sources: {} };
      expect(validateTurnRequest(JSON.parse(JSON.stringify(body))).progress.evidence).toEqual(progress.evidence);
    }), { numRuns: 400 });
  });
});

describe('server checks on the log', () => {
  const body = (evidence) => ({ kind: 'reply', teacherPrompt: 'Teach', plan, progress: { ...createProgress(plan), evidence }, history: [], studentMessage: 'answer', sources: {} });
  const entry = { n: 1, step: 0, question: 'check', support: 'independent', verdict: 'correct', issue: 'none', misconception: '', sources: ['c1'], move: 'advance', reason: 'right_without_help', message: 'student-abc-1' };

  it('accepts a valid log, with the message id the browser adds', () => {
    expect(validateTurnRequest(body([entry])).progress.evidence).toEqual([entry]);
  });

  it('rejects entries with unknown values, wrong steps, bad order or too many entries', () => {
    for (const bad of [{ support: 'magic' }, { step: 3 }, { verdict: 'question' }, { sources: ['../x'] }, { message: 'a b' }, { reason: 'Drop table' }, { misconception: 'x'.repeat(161) }]) {
      expect(() => validateTurnRequest(body([{ ...entry, ...bad }])), JSON.stringify(bad)).toThrow();
    }
    expect(() => validateTurnRequest(body([entry, entry]))).toThrow();
    expect(() => validateTurnRequest(body(Array.from({ length: EVIDENCE_LIMIT + 1 }, (_, index) => ({ ...entry, n: index + 1 }))))).toThrow();
  });
});
