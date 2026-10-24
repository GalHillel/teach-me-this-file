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
    const state = run([{ type: 'notice', notice: { code: 'backup_model', model: 'lite' } }]);
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

  it('builds history from finished messages only', () => {
    const state = chatReducer(run(answerTurn), { type: 'stopped' });
    expect(historyFor(state.messages, null)).toEqual([
      { role: 'student', content: 'They release energy' },
      { role: 'tutor', content: expect.stringContaining('[message interrupted by the student]') },
    ]);
    expect(historyFor(state.messages, 's1')).toHaveLength(1);
  });
});

describe('lesson summary', () => {
  it('counts outcomes and lists steps worth reviewing', () => {
    const finished = {
      status: 'completed',
      currentStep: 1,
      steps: [{ status: 'done', outcome: 'recovered' }, { status: 'done', outcome: 'mastered' }],
    };
    expect(lessonSummary(plan, finished)).toEqual({
      counts: { mastered: 1, learned: 0, recovered: 1, review: 0 },
      review: ['Respiration'],
      total: 2,
    });
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
