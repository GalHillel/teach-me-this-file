import { describe, expect, it } from 'vitest';
import { readEvents } from '../src/api/sse.js';
import { chatReducer, historyFor, initChat } from '../src/lesson/chatReducer.js';
import { findMessageSources, highlightPassage, selectPlanChunks } from '../src/lesson/sources.js';

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
  { type: 'progress', move: 'advance', progress: advanced, verdict: 'correct' },
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
    expect(state.messages[0].verdict).toBe('correct');
    expect(state.messages[1].content).toMatch(/Step 1 done/);
    expect(state.messages[2]).toMatchObject({ status: 'done', stepIndex: 1, sources: [{ chunkId: 'c2', kind: 'match' }] });
  });

  it('keeps the old progress and the partial text when stopped', () => {
    const state = chatReducer(run(answerTurn), { type: 'stopped' });
    expect(state.progress).toBe(progress);
    expect(state.turn.status).toBe('idle');
    expect(state.messages[1]).toMatchObject({ role: 'tutor', status: 'stopped' });
    expect(state.messages[0].verdict).toBeUndefined();
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

describe('sources', () => {
  it('falls back to the step passage when wording does not match', () => {
    expect(findMessageSources('Les mitochondries libèrent de l\'énergie.', chunks, ['c1'])).toEqual([{ chunkId: 'c1', kind: 'step' }]);
    expect(findMessageSources('Unrelated text here.', chunks, [])).toEqual([]);
  });

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
