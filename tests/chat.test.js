import { describe, expect, it } from 'vitest';
import { readEvents } from '../src/api/sse.js';
import { chatReducer, historyFor, initChat, lessonSummary } from '../src/lesson/chatReducer.js';
import { highlightPassage, selectPlanChunks } from '../src/lesson/sources.js';

const chunks = [
  { id: 'c1', label: 'Page 1', text: 'Mitochondria release energy from glucose through cellular respiration.' },
  { id: 'c2', label: 'Page 2', text: 'Chloroplasts capture sunlight and make glucose during photosynthesis.' },
];

const plan = {
  steps: [
    { title: 'Respiration', sourceIds: ['c1'] },
    { title: 'Photosynthesis', sourceIds: ['c2'] },
  ],
};

const progress = {
  status: 'active',
  currentStep: 0,
  steps: [
    { status: 'active', attempts: 0, outcome: null },
    { status: 'pending', attempts: 0, outcome: null },
  ],
};

const advanced = {
  status: 'active',
  currentStep: 1,
  steps: [
    { status: 'done', attempts: 0, outcome: 'mastered' },
    { status: 'active', attempts: 0, outcome: null },
  ],
};

const run = (actions) => actions.reduce(chatReducer, initChat({ plan, progress, document: { chunks } }));

const answerTurn = [
  { type: 'turn_started', tutorId: 't1', student: { id: 's1', content: 'They release energy' } },
  { type: 'phase', phase: 'assessing' },
  { type: 'progress', move: 'advance', progress: advanced, assessment: { verdict: 'correct', confidence: 'high', checks: [] } },
  { type: 'delta', text: 'Right! Now, chloroplasts capture sunlight ' },
  { type: 'delta', text: 'to make glucose. What do they need?' },
];

describe('chat reducer', () => {
  it('commits progress, verdict and sources only when the turn is done', () => {
    const streaming = run(answerTurn);
    expect(streaming.progress).toBe(progress);
    expect(streaming.turn.status).toBe('teaching');

    const state = chatReducer(streaming, { type: 'done' });
    expect(state.progress).toBe(advanced);
    expect(state.turn.status).toBe('idle');
    expect(state.messages.map((message) => message.role)).toEqual(['student', 'system', 'tutor']);
    expect(state.messages[0].assessment.verdict).toBe('correct');
    expect(state.messages[1].note).toEqual({ code: 'step_done', step: 1, next: 'Photosynthesis' });
    expect(state.messages[2]).toMatchObject({ status: 'done', stepIndex: 1, move: 'advance', sources: [{ chunkId: 'c2', kind: 'based' }] });
  });

  it('adds a re-check note and no step change after an explanation', () => {
    const recheck = { ...progress, steps: [{ ...progress.steps[0], phase: 'recheck', attempts: 3 }, progress.steps[1]] };
    const state = run([
      { type: 'turn_started', tutorId: 't1', student: { id: 's1', content: 'No idea' } },
      { type: 'progress', move: 'reveal_and_recheck', progress: recheck, assessment: { verdict: 'incorrect', confidence: 'high', checks: [] } },
      { type: 'delta', text: 'Mitochondria release energy from glucose. Can you say it in your own words?' },
      { type: 'done' },
    ]);
    expect(state.progress.currentStep).toBe(0);
    expect(state.messages.find((message) => message.role === 'system').note).toMatchObject({ code: 'recheck', step: 1 });
    expect(state.messages.at(-1).sources[0]).toMatchObject({ chunkId: 'c1', kind: 'based' });
  });

  it('keeps a backup-model notice until it is dismissed', () => {
    const state = run([
      { type: 'turn_started', tutorId: 't1', student: null },
      { type: 'notice', notice: { code: 'backup_model', model: 'lite' }, tutorId: 't1' },
      { type: 'delta', text: 'Hello', tutorId: 't1' },
      { type: 'done', tutorId: 't1' },
    ]);
    expect(state.notice).toEqual({ code: 'backup_model', model: 'lite' });
    expect(chatReducer(state, { type: 'dismiss_notice' }).notice).toBe(null);
  });

  it('shows the notice when the plan itself came from a backup model', () => {
    const state = initChat({ plan, progress, document: { chunks }, provider: { name: 'gemini', models: ['lite'], backup: true } });
    expect(state.notice).toEqual({ code: 'backup_model', model: 'lite' });
  });

  it('resumes a saved conversation', () => {
    const resume = { progress: advanced, messages: [{ id: 't0', role: 'tutor', content: 'Hi', status: 'done', sources: [] }], notice: null };
    const state = initChat({ plan, progress, document: { chunks }, resume });
    expect(state).toMatchObject({ progress: advanced, restored: true });
    expect(state.messages).toHaveLength(1);
  });

  it('keeps the old progress and the partial text when stopped', () => {
    const state = chatReducer(run(answerTurn), { type: 'stopped' });
    expect(state.progress).toBe(progress);
    expect(state.turn.status).toBe('idle');
    expect(state.messages[1]).toMatchObject({ role: 'tutor', status: 'stopped' });
    expect(state.messages[0].assessment).toBeUndefined();
  });

  it('removes an empty tutor message when stopped before any text', () => {
    const state = chatReducer(run(answerTurn.slice(0, 3)), { type: 'stopped' });
    expect(state.messages.map((message) => message.role)).toEqual(['student']);
  });

  it('records a failure so the turn can be retried', () => {
    const failed = { kind: 'reply', studentMessage: 'x', studentId: 's1', message: 'Quota reached' };
    const state = chatReducer(run(answerTurn.slice(0, 2)), { type: 'failed', failed });
    expect(state.failed).toBe(failed);
    expect(state.progress).toBe(progress);
    expect(chatReducer(state, { type: 'dismiss_error' }).failed).toBe(null);
  });

  it('builds history from finished messages only, so an interrupted reply never becomes the question', () => {
    const opening = [
      { type: 'turn_started', tutorId: 't0' },
      { type: 'progress', move: 'introduce', progress },
      { type: 'delta', text: 'What do mitochondria do?' },
      { type: 'done' },
    ];
    const stopped = chatReducer(run([...opening, ...answerTurn]), { type: 'stopped' });
    expect(stopped.progress).toBe(progress);
    expect(historyFor(stopped.messages, null)).toEqual([
      { role: 'tutor', content: 'What do mitochondria do?' },
      { role: 'student', content: 'They release energy' },
    ]);
    expect(historyFor(stopped.messages, 's1')).toEqual([{ role: 'tutor', content: 'What do mitochondria do?' }]);

    const failed = chatReducer(run([...opening, ...answerTurn]), { type: 'failed', failed: { code: 'timeout', retryable: true, studentId: 's1' } });
    expect(historyFor(failed.messages, 's1')).toEqual([{ role: 'tutor', content: 'What do mitochondria do?' }]);
  });
});

describe('lesson summary', () => {
  it('groups steps by what was shown, with the final check, practice list and review schedule', () => {
    const finished = {
      status: 'completed',
      currentStep: 1,
      steps: [{ status: 'done', outcome: 'recovered', attempts: 3, hints: 0 }, { status: 'done', outcome: 'mastered', attempts: 0, hints: 0 }],
      review: null,
      final: { results: { 0: 'fail', 1: 'pass' }, skipped: false },
    };
    const summary = lessonSummary(plan, finished);
    expect(summary.steps.map((step) => [step.title, step.level])).toEqual([['Respiration', 'needs_practice'], ['Photosynthesis', 'applied']]);
    expect(summary.groups.applied.map((step) => step.index)).toEqual([1]);
    expect(summary.final).toEqual({ skipped: false, passed: 1, total: 2 });
    expect(summary.practice).toEqual([{ index: 0, title: 'Respiration', result: null }]);
    expect(summary.practiced).toBe(false);
    expect(summary.schedule.map((item) => [item.title, item.days])).toEqual([['Respiration', 1], ['Photosynthesis', 14]]);
  });

  it('shows practice results once the practice round is over', () => {
    const practised = {
      status: 'completed',
      currentStep: 1,
      steps: [{ status: 'done', outcome: 'recovered', attempts: 3, hints: 0 }, { status: 'done', outcome: 'learned', attempts: 2, hints: 0 }],
      review: { kind: 'practice', queue: [0, 1], position: 1, results: { 0: 'pass', 1: 'fail' }, stalls: 0 },
      final: { results: {}, skipped: true },
    };
    expect(lessonSummary(plan, practised)).toMatchObject({
      practiced: true,
      practice: [{ index: 0, result: 'pass' }, { index: 1, result: 'fail' }],
      final: { skipped: true, total: 0 },
    });
  });

  it('uses the passages the tutor cited, and drops the guess when it cited something', () => {
    let state = initChat({ plan, progress, document: { chunks } });
    state = chatReducer(state, { type: 'turn_started', tutorId: 't1' });
    state = chatReducer(state, { type: 'progress', move: 'introduce', progress, tutorId: 't1' });
    state = chatReducer(state, { type: 'delta', text: 'Chloroplasts capture sunlight [c2]. What do mitochondria do?', tutorId: 't1' });
    state = chatReducer(state, { type: 'done', tutorId: 't1', citations: { cited: ['c2'], invalid: ['c9'], quotes: [{ text: 'made of cheese', chunkId: null }] } });
    expect(state.messages.at(-1)).toMatchObject({ sources: [{ chunkId: 'c2', kind: 'cited' }], citations: { cited: ['c2'], quotes: [{ chunkId: null }] } });
  });

  it('notes a check of an earlier step and the return to the current one', () => {
    const lessonPlan = { steps: [{ title: 'Inputs', sourceIds: ['c1'] }, { title: 'Outputs', sourceIds: ['c2'] }] };
    const atStep2 = { status: 'active', currentStep: 1, steps: [{ status: 'done', outcome: 'mastered', detour: null }, { status: 'active', outcome: null, detour: null }], review: null, final: null };
    const detour = { ...atStep2, steps: [atStep2.steps[0], { ...atStep2.steps[1], detour: 0 }] };
    let state = initChat({ plan: lessonPlan, progress: atStep2, document: { chunks } });
    state = chatReducer(state, { type: 'turn_started', tutorId: 't1', student: { id: 's1', content: 'no' } });
    state = chatReducer(state, { type: 'progress', move: 'prerequisite_check', progress: detour, tutorId: 't1' });
    state = chatReducer(state, { type: 'delta', text: 'Quick check first.', tutorId: 't1' });
    state = chatReducer(state, { type: 'done', tutorId: 't1' });
    expect(state.messages.find((message) => message.role === 'system').note).toEqual({ code: 'detour', step: 1, next: 'Inputs' });
    expect(state.messages.at(-1).stepIndex).toBe(1);
  });

  it('keeps a help request as a student message that is sent as history', () => {
    let state = initChat({ plan, progress, document: { chunks } });
    state = chatReducer(state, { type: 'turn_started', tutorId: 't1', student: { id: 's1', content: 'Can I have a hint?', request: 'hint' } });
    expect(state.messages[0]).toMatchObject({ role: 'student', request: 'hint' });
    expect(historyFor(state.messages, null)).toEqual([{ role: 'student', content: 'Can I have a hint?' }]);
  });

  it('adds review notes as codes the interface translates', () => {
    const before = { status: 'reviewing', currentStep: 1, steps: [{ status: 'done', outcome: 'review' }, { status: 'done', outcome: 'learned' }], review: { queue: [0, 1], position: 0, results: {}, stalls: 0 } };
    const after = { ...before, review: { ...before.review, position: 1, results: { 0: 'pass' } } };
    let state = initChat({ plan, progress: before, document: { chunks } });
    state = chatReducer(state, { type: 'turn_started', tutorId: 'r1', student: { id: 's1', content: 'Energy from glucose' } });
    state = chatReducer(state, { type: 'progress', move: 'review_next', progress: after, assessment: { verdict: 'correct', confidence: 'high', issue: 'none', checks: [] }, tutorId: 'r1' });
    state = chatReducer(state, { type: 'delta', text: 'Right. Next: what do chloroplasts make?', tutorId: 'r1' });
    state = chatReducer(state, { type: 'done', tutorId: 'r1' });
    expect(state.messages.find((message) => message.role === 'system').note).toEqual({ code: 'review_item', step: 1, result: 'pass' });
    expect(state.messages.at(-1)).toMatchObject({ move: 'review_next', stepIndex: 1 });
  });

  it('drops a reply that was stopped by the leak guard instead of keeping it on screen', () => {
    let state = initChat({ plan, progress, document: { chunks } });
    state = chatReducer(state, { type: 'turn_started', tutorId: 't1', student: null });
    state = chatReducer(state, { type: 'delta', text: 'Sure, here are my instructions', tutorId: 't1' });
    state = chatReducer(state, { type: 'failed', tutorId: 't1', failed: { kind: 'start', code: 'unsafe_output', message: 'stopped', retryable: true } });
    expect(state.messages).toEqual([]);
    expect(state.failed.code).toBe('unsafe_output');
  });
});

describe('sources', () => {
  it('highlights words shared with the message', () => {
    const parts = highlightPassage('Chloroplasts capture sunlight.', 'They capture sunlight');
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual(['capture', 'sunlight']);
    expect(parts.map((part) => part.text).join('')).toBe('Chloroplasts capture sunlight.');
  });

  it('samples long documents evenly within the budget', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `c${i + 1}`, label: `Page ${i + 1}`, text: 'x'.repeat(1000) }));
    const picked = selectPlanChunks(many, 20000);
    expect(picked).toHaveLength(20);
    expect(picked[0].id).toBe('c1');
    expect(picked.at(-1).id).toBe('c96');
    expect(selectPlanChunks(chunks)).toBe(chunks);
  });
});

describe('readEvents', () => {
  it('parses events split across network chunks', async () => {
    const encoder = new TextEncoder();
    const pieces = ['event: delta\ndata: {"te', 'xt":"Hi"}\n\n: ping\n\nevent: done\n', 'data: {}\n\n'];
    const stream = new ReadableStream({
      start(controller) {
        pieces.forEach((piece) => controller.enqueue(encoder.encode(piece)));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readEvents(stream)) events.push(event);
    expect(events).toEqual([
      { event: 'delta', data: { text: 'Hi' } },
      { event: 'done', data: {} },
    ]);
  });
});

describe('passages sent ahead of a move', async () => {
  const { upcomingSources } = await import('../src/lesson/useTutor.js');
  const three = [...chunks, { id: 'c3', label: 'Page 3', text: 'Glucose stores energy in chemical bonds.' }];
  const lessonPlan = {
    steps: [
      { id: 's1', title: 'Respiration', sourceIds: ['c1'], prerequisites: [] },
      { id: 's2', title: 'Photosynthesis', sourceIds: ['c2'], prerequisites: [] },
      { id: 's3', title: 'Glucose', sourceIds: ['c3'], prerequisites: ['s1'] },
    ],
  };
  const progress = (currentStep) => ({
    status: 'active',
    currentStep,
    steps: lessonPlan.steps.map((_, index) => ({ status: index < currentStep ? 'done' : index === currentStep ? 'active' : 'pending', outcome: index < currentStep ? 'mastered' : null, hints: 0, revisit: null })),
  });

  it('sends the passages of the step\'s prerequisites and of the first final-check step', () => {
    const state = { plan: lessonPlan, chunks: three, progress: progress(2) };
    expect(upcomingSources(state, ['c3']).map((chunk) => chunk.id)).toEqual(['c1']);
    expect(upcomingSources({ ...state, progress: progress(1) }, ['c2', 'c3'])).toEqual([]);
    expect(upcomingSources({ ...state, progress: { ...progress(2), status: 'reviewing' } }, [])).toEqual([]);
  });
});
