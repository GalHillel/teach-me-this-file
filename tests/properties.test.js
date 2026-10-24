import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ISSUES } from '../server/lesson/assessor.js';
import { MAX_ATTEMPTS, STALL_LIMIT, activeStepIndex, createProgress, planMove } from '../server/lesson/progress.js';
import { validateTurnRequest } from '../server/validation.js';
import { chatReducer, initChat } from '../src/lesson/chatReducer.js';

const VERDICTS = ['correct', 'partial', 'incorrect', 'question', 'off_topic', 'unclear'];
const MAX_REPLIES_PER_STEP = (MAX_ATTEMPTS + 2) * (STALL_LIMIT + 1);
const MAX_REPLIES_WITH_DETOUR = MAX_REPLIES_PER_STEP + STALL_LIMIT + 1;
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];

const planOf = (length) => ({
  title: 'Lesson',
  languageCode: 'en',
  audience: 'Students',
  style: '',
  objectives: [],
  steps: Array.from({ length }, (_, index) => ({
    id: `s${index + 1}`,
    title: `Step ${index + 1}`,
    goal: 'g',
    keyConcepts: [`${WORDS[index]} idea`],
    checkQuestion: `Q${index}?`,
    successCriteria: 's',
    commonMistake: '',
    prerequisites: index ? [`s${index}`] : [],
    sourceIds: [],
  })),
});

const assessmentArb = fc.record({
  verdict: fc.constantFrom(...VERDICTS),
  confidence: fc.constantFrom('low', 'medium', 'high'),
  issue: fc.constantFrom(...ISSUES),
  conceptsMissing: fc.constantFrom([], ['alpha idea'], ['bravo idea'], ['something else']),
  misconception: fc.constantFrom('', 'a wrong idea'),
});

const eventArb = fc.oneof(
  { weight: 12, arbitrary: assessmentArb.map((assessment) => ({ kind: 'reply', assessment })) },
  { weight: 1, arbitrary: fc.constantFrom({ kind: 'review' }, { kind: 'hint' }, { kind: 'explain' }, { kind: 'skip_final' }) },
);

const apply = (plan, progress, event) => planMove(progress, { kind: event.kind, assessment: event.assessment ?? null, plan });

describe('lesson state machine properties', () => {
  it('keeps its invariants for any plan and any sequence of graded messages and requests', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.array(eventArb, { maxLength: 120 }), (length, events) => {
      const plan = planOf(length);
      let progress = createProgress(plan);
      const outcomesSet = new Map();
      for (const event of events) {
        const before = progress;
        const result = apply(plan, progress, event);
        progress = result.progress;

        expect(progress.currentStep).toBeGreaterThanOrEqual(before.currentStep);
        expect(progress.currentStep).toBeLessThan(length);
        progress.steps.forEach((step, index) => {
          expect(step.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
          expect(step.stalls).toBeLessThanOrEqual(STALL_LIMIT);
          expect(step.used.length).toBeLessThanOrEqual(8);
          if (step.detour !== null) {
            expect(step.status).toBe('active');
            expect(step.detour).toBeLessThan(index);
            expect(progress.steps[step.detour].status).toBe('done');
          }
          if (index < progress.currentStep) expect(step).toMatchObject({ status: 'done' });
          if (index > progress.currentStep) expect(step).toMatchObject({ status: 'pending', outcome: null });
          if (step.outcome) {
            if (outcomesSet.has(index)) expect(step.outcome).toBe(outcomesSet.get(index));
            outcomesSet.set(index, step.outcome);
          }
        });
        if (progress.status !== 'active') expect(progress.steps.every((step) => step.status === 'done' && step.outcome)).toBe(true);
        if (progress.status === 'reviewing') {
          expect(progress.review.queue).toContain(activeStepIndex(progress));
          expect(progress.review.stalls).toBeLessThanOrEqual(STALL_LIMIT);
        }
        if (before.status === 'reviewing' && before.review.kind === 'final' && progress.status === 'completed') {
          expect(progress.final).not.toBe(null);
        }
        if (result.intervention) expect(progress.steps[activeStepIndex(before)].used.at(-1)).toBe(result.intervention);
        if (before.status === 'active' && progress.status === 'active') {
          expect(['advance', 'review_and_advance'].includes(result.move)).toBe(progress.currentStep === before.currentStep + 1);
        }
      }
    }), { numRuns: 400 });
  });

  const replyArb = assessmentArb.filter((assessment) => assessment.verdict !== 'question');
  const questionArb = fc.constant({ verdict: 'question', confidence: 'high', issue: 'none', conceptsMissing: [], misconception: '' });

  it('always ends a step without prerequisites within 15 non-question replies', () => {
    fc.assert(fc.property(fc.array(fc.oneof(replyArb, questionArb), { minLength: 200, maxLength: 200 }), (events) => {
      const plan = planOf(1);
      let progress = createProgress(plan);
      let countedReplies = 0;
      for (const assessment of events) {
        progress = apply(plan, progress, { kind: 'reply', assessment }).progress;
        if (assessment.verdict !== 'question') countedReplies += 1;
        if (progress.steps[0].status === 'done') break;
        expect(countedReplies).toBeLessThan(MAX_REPLIES_PER_STEP);
      }
      if (events.filter((event) => event.verdict !== 'question').length >= MAX_REPLIES_PER_STEP) expect(progress.steps[0].status).toBe('done');
    }), { numRuns: 400 });
  });

  it('ends a step that can go back to a prerequisite within 18 non-question replies', () => {
    fc.assert(fc.property(fc.array(fc.oneof(replyArb, questionArb), { minLength: 200, maxLength: 200 }), (events) => {
      const plan = planOf(2);
      let progress = apply(plan, createProgress(plan), { kind: 'reply', assessment: { verdict: 'correct', confidence: 'high', issue: 'none', conceptsMissing: [], misconception: '' } }).progress;
      let countedReplies = 0;
      for (const assessment of events) {
        progress = apply(plan, progress, { kind: 'reply', assessment }).progress;
        if (assessment.verdict !== 'question') countedReplies += 1;
        if (progress.steps[1].status === 'done') break;
        expect(countedReplies).toBeLessThan(MAX_REPLIES_WITH_DETOUR);
      }
      if (events.filter((event) => event.verdict !== 'question').length >= MAX_REPLIES_WITH_DETOUR) expect(progress.steps[1].status).toBe('done');
    }), { numRuns: 400 });
  });

  it('only produces states that the server accepts back from the client', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.array(eventArb, { maxLength: 60 }), (length, events) => {
      const plan = planOf(length);
      let progress = createProgress(plan);
      for (const event of events) {
        progress = apply(plan, progress, event).progress;
        const body = { kind: 'reply', teacherPrompt: 'Teach', plan, progress, history: [], studentMessage: 'answer', sources: {} };
        expect(validateTurnRequest(JSON.parse(JSON.stringify(body))).progress).toEqual(JSON.parse(JSON.stringify(progress)));
      }
    }), { numRuns: 200 });
  });
});

describe('chat reducer properties', () => {
  const plan = { steps: [{ title: 'A', sourceIds: ['c1'] }, { title: 'B', sourceIds: ['c2'] }] };
  const chunks = [
    { id: 'c1', label: 'Page 1', text: 'Mitochondria release energy from glucose.' },
    { id: 'c2', label: 'Page 2', text: 'Chloroplasts capture sunlight and make glucose.' },
  ];
  const progressAt = (step) => ({
    status: 'active',
    currentStep: step,
    steps: [{ status: step ? 'done' : 'active', outcome: step ? 'mastered' : null, attempts: 0 }, { status: step ? 'active' : 'pending', outcome: null, attempts: 0 }],
    review: null,
  });

  const turnArb = fc.record({
    student: fc.boolean(),
    phases: fc.array(fc.constantFrom('assessing', 'teaching'), { maxLength: 2 }),
    progress: fc.boolean(),
    deltas: fc.array(fc.constantFrom('Chloroplasts ', 'capture ', 'sunlight. ', 'What next? '), { maxLength: 5 }),
    end: fc.constantFrom('done', 'stopped', 'failed'),
    late: fc.array(fc.constantFrom('delta', 'done', 'progress', 'stopped', 'phase', 'notice'), { maxLength: 3 }),
    foreign: fc.array(fc.constantFrom('delta', 'done', 'progress'), { maxLength: 2 }),
  });

  it('never throws, commits progress only on done, and ignores late or foreign events', () => {
    fc.assert(fc.property(fc.array(turnArb, { maxLength: 8 }), (turns) => {
      let state = initChat({ plan, progress: progressAt(0), document: { chunks } });
      turns.forEach((turn, index) => {
        const tutorId = `t${index}`;
        const committed = state.progress;
        const next = progressAt(1);
        state = chatReducer(state, { type: 'turn_started', tutorId, student: turn.student ? { id: `s${index}`, content: 'answer' } : null });
        for (const phase of turn.phases) state = chatReducer(state, { type: 'phase', phase, tutorId });
        if (turn.progress) state = chatReducer(state, { type: 'progress', move: 'advance', progress: next, assessment: { verdict: 'correct', confidence: 'high', issue: 'none', checks: [] }, tutorId });
        for (const foreign of turn.foreign) state = chatReducer(state, { type: foreign, text: 'x', progress: progressAt(0), tutorId: 'other' });
        for (const text of turn.deltas) state = chatReducer(state, { type: 'delta', text, tutorId });
        expect(state.progress).toBe(committed);

        state = chatReducer(state, turn.end === 'failed'
          ? { type: 'failed', tutorId, failed: { kind: 'reply', code: 'timeout', message: 'x', retryable: true } }
          : { type: turn.end, tutorId });
        expect(state.turn.status).toBe('idle');
        expect(state.progress).toBe(turn.end === 'done' && turn.progress ? next : committed);

        const settled = state;
        for (const late of turn.late) state = chatReducer(state, { type: late, text: 'late', phase: 'teaching', progress: progressAt(0), notice: { code: 'backup_model' }, tutorId });
        expect(state).toBe(settled);

        const tutor = state.messages.find((message) => message.id === tutorId);
        if (turn.end === 'done') expect(tutor.status).toBe('done');
        else if (turn.deltas.length) expect(tutor.status).toBe('stopped');
        else expect(tutor).toBeUndefined();
      });
    }), { numRuns: 300 });
  });

  it('ignores a second turn while one is open', () => {
    let state = initChat({ plan, progress: progressAt(0), document: { chunks } });
    state = chatReducer(state, { type: 'turn_started', tutorId: 't1', student: null });
    const open = state;
    expect(chatReducer(state, { type: 'turn_started', tutorId: 't2', student: { id: 's2', content: 'again' } })).toBe(open);
  });
});
