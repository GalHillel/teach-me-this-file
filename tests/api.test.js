import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { createServerKeyBudget } from '../server/serverKey.js';
import { AppError } from '../server/errors.js';
import { createProgress } from '../server/lesson/progress.js';
import { guardStream, toProviderMessages } from '../server/lesson/tutor.js';
import { createMockProvider } from '../server/providers/mock.js';

const document = {
  name: 'cells.txt',
  totalChunks: 2,
  chunks: [
    { id: 'c1', label: 'Lines 1–40', text: 'A cell is the smallest unit of life. Every living thing is made of cells.' },
    { id: 'c2', label: 'Lines 41–60', text: 'The nucleus holds the genetic material and controls the activity of the cell.' },
  ],
};

const plan = {
  title: 'Cells',
  languageCode: 'en',
  audience: '7th grade',
  style: 'Socratic',
  objectives: ['Know what a cell is'],
  steps: [
    { title: 'What is a cell', goal: 'Cells are units of life', keyConcepts: ['cell'], checkQuestion: 'What is a cell?', successCriteria: 'smallest unit of life' },
    { title: 'Nucleus', goal: 'The nucleus controls the cell', keyConcepts: ['nucleus'], checkQuestion: 'What does the nucleus do?', successCriteria: 'controls the cell' },
  ],
};

const turn = (overrides = {}) => ({
  kind: 'start',
  teacherPrompt: 'Teach 7th graders. Be Socratic.',
  plan,
  progress: createProgress(plan),
  history: [],
  sources: { current: [document.chunks[0]], next: [document.chunks[1]] },
  ...overrides,
});

const parseEvents = (text) =>
  text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return { event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) };
    });

const withProvider = (provider, usesServerKey = false) => () => ({ provider, usesServerKey });

const mockApp = () => createApp({ providerFor: withProvider(createMockProvider({ delayMs: 1 })) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/lessons', () => {
  it('builds a validated lesson plan with initial progress', async () => {
    const response = await request(mockApp()).post('/api/lessons').send({ teacherPrompt: 'Teach 7th graders', document });
    expect(response.status).toBe(200);
    expect(response.body.plan.steps.length).toBeGreaterThan(0);
    expect(response.body.plan.steps[0].sourceIds).toEqual(['c1']);
    expect(response.body.progress).toMatchObject({ status: 'active', currentStep: 0 });
  });

  it('rejects a request without a document', async () => {
    const response = await request(mockApp()).post('/api/lessons').send({ teacherPrompt: 'x' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('asks for a key when none is configured', async () => {
    const response = await request(createApp()).post('/api/lessons').send({ teacherPrompt: 'x', document });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('missing_key');
  });

  it('rejects keys from unknown providers', async () => {
    const response = await request(createApp()).post('/api/lessons').set('X-AI-Key', 'abc123').send({ teacherPrompt: 'x', document });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('unknown_provider');
  });

  it('rejects oversized bodies', async () => {
    const huge = { teacherPrompt: 'x', document: { ...document, chunks: [{ id: 'c1', label: 'p', text: 'a'.repeat(1_200_000) }] } };
    const response = await request(mockApp()).post('/api/lessons').send(huge);
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/too large/);
  });
});

describe('POST /api/turns', () => {
  it('streams a lesson opening as server-sent events', async () => {
    const response = await request(mockApp()).post('/api/turns').send(turn());
    expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseEvents(response.text);
    expect(events[0]).toMatchObject({ event: 'progress', data: { move: 'introduce' } });
    expect(events.filter((item) => item.event === 'delta').length).toBeGreaterThan(5);
    expect(events.at(-1).event).toBe('done');
  });

  it('grades a wrong answer and asks for a hint instead of advancing', async () => {
    const response = await request(mockApp())
      .post('/api/turns')
      .send(turn({ kind: 'reply', studentMessage: 'I think it is wrong', history: [{ role: 'tutor', content: 'What is a cell?' }] }));
    const events = parseEvents(response.text);
    expect(events.map((item) => item.event)).toContain('status');
    const progress = events.find((item) => item.event === 'progress').data;
    expect(progress.move).toBe('hint');
    expect(progress.assessment).toMatchObject({ verdict: 'incorrect', confidence: 'high' });
    expect(progress.progress.currentStep).toBe(0);
    expect(progress.progress.steps[0].attempts).toBe(1);
  });

  it('moves to the next step after a correct answer', async () => {
    const response = await request(mockApp())
      .post('/api/turns')
      .send(turn({ kind: 'reply', studentMessage: 'The smallest unit of life', history: [{ role: 'tutor', content: 'What is a cell?' }] }));
    const progress = parseEvents(response.text).find((item) => item.event === 'progress').data;
    expect(progress.move).toBe('advance');
    expect(progress.progress.currentStep).toBe(1);
  });

  it('validates the lesson state sent by the client', async () => {
    const response = await request(mockApp()).post('/api/turns').send(turn({ progress: { ...createProgress(plan), currentStep: 9 } }));
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/currentStep/);
  });

  it('rejects edited lesson states that skip steps, fake a finished lesson or carry impossible counts', async () => {
    const fresh = createProgress(plan);
    const forged = [
      { ...fresh, currentStep: 1 },
      { ...fresh, status: 'completed', steps: fresh.steps.map((step) => ({ ...step, attempts: 2 })) },
      { ...fresh, steps: [{ ...fresh.steps[0], attempts: 99 }, fresh.steps[1]] },
      { ...fresh, steps: [{ ...fresh.steps[0], phase: 'bogus' }, fresh.steps[1]] },
      { ...fresh, steps: [{ ...fresh.steps[0], outcome: 'mastered' }, fresh.steps[1]] },
    ];
    for (const progress of forged) {
      const response = await request(mockApp()).post('/api/turns').send(turn({ kind: 'reply', studentMessage: 'x', progress }));
      expect(response.status).toBe(400);
    }
  });

  it('sends provider errors as an error event', async () => {
    const failing = {
      name: 'failing',
      model: 'x',
      generateJson: async () => ({}),
      streamText: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new AppError('invalid_key')) }),
      }),
    };
    const app = createApp({ providerFor: withProvider(failing) });
    const events = parseEvents((await request(app).post('/api/turns').send(turn())).text);
    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { code: 'invalid_key', message: expect.stringMatching(/rejected this API key/), retryable: false },
    });
  });

  it('cancels the provider request when the client disconnects', async () => {
    let providerSignal;
    const slow = {
      name: 'slow',
      model: 'x',
      generateJson: async () => ({}),
      async *streamText({ signal }) {
        providerSignal = signal;
        for (let i = 0; i < 200; i += 1) {
          if (signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield `word${i} `;
        }
      },
    };
    const server = createApp({ providerFor: withProvider(slow) }).listen(0);
    const controller = new AbortController();
    const response = await fetch(`http://localhost:${server.address().port}/api/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(turn()),
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(providerSignal.aborted).toBe(true);
    server.close();
  });
});

describe('review round over the API', () => {
  const finished = () => {
    const progress = createProgress(plan);
    return {
      ...progress,
      status: 'completed',
      currentStep: 1,
      steps: [
        { ...progress.steps[0], status: 'done', attempts: 3, outcome: 'review' },
        { ...progress.steps[1], status: 'done', outcome: 'mastered' },
      ],
    };
  };

  it('starts a review of the weak steps after the lesson', async () => {
    const response = await request(mockApp()).post('/api/turns').send(turn({ kind: 'review', progress: finished() }));
    const progress = parseEvents(response.text).find((item) => item.event === 'progress').data;
    expect(progress.move).toBe('review_question');
    expect(progress.progress).toMatchObject({ status: 'reviewing', review: { queue: [0], position: 0 } });
  });

  it('refuses a review before the lesson is complete', async () => {
    const response = await request(mockApp()).post('/api/turns').send(turn({ kind: 'review' }));
    expect(response.status).toBe(400);
  });

  it('grades the reviewed step and finishes the review', async () => {
    const reviewing = { ...finished(), status: 'reviewing', review: { queue: [0], position: 0, results: {}, stalls: 0 } };
    const response = await request(mockApp())
      .post('/api/turns')
      .send(turn({ kind: 'reply', progress: reviewing, studentMessage: 'The smallest unit of life', history: [{ role: 'tutor', content: 'Quick review: what is a cell?' }] }));
    const progress = parseEvents(response.text).find((item) => item.event === 'progress').data;
    expect(progress.move).toBe('review_finish');
    expect(progress.progress).toMatchObject({ status: 'completed', review: { results: { 0: 'pass' } } });
  });
});

describe('tutor prompt contents', () => {
  const capture = () => {
    const base = createMockProvider({ delayMs: 1 });
    const seen = { system: '' };
    return {
      seen,
      provider: { ...base, streamText: (options) => { seen.system = options.system; seen.messages = options.messages; return base.streamText(options); } },
    };
  };

  it('gives the tutor passages from elsewhere in the file for the student\'s question', async () => {
    const { seen, provider } = capture();
    const related = [{ id: 'c9', label: 'Page 9', text: 'Ribosomes build proteins from amino acids.' }];
    await request(createApp({ providerFor: withProvider(provider) }))
      .post('/api/turns')
      .send(turn({ kind: 'reply', studentMessage: 'What do ribosomes do?', history: [{ role: 'tutor', content: 'What is a cell?' }], sources: { current: [document.chunks[0]], next: [], related } }));
    expect(seen.system).toContain('Ribosomes build proteins');
    expect(seen.system).toContain('Use them only to answer a question the student asked');
  });

  it('answers a question about another part of the file even when the grader calls it off topic', async () => {
    const { seen, provider } = capture();
    let gradePrompt = '';
    const offTopicGrader = { ...provider, generateJson: async (options) => { gradePrompt = options.prompt; return { verdict: 'off_topic', completeness: 0, confidence: 'medium' }; } };
    const related = [{ id: 'c9', label: 'Page 9', text: 'Never push anything into a wall socket.' }];
    const response = await request(createApp({ providerFor: withProvider(offTopicGrader) }))
      .post('/api/turns')
      .send(turn({ kind: 'reply', studentMessage: 'Is it dangerous to put things into a wall socket?', history: [{ role: 'tutor', content: 'What is a cell?' }], sources: { current: [document.chunks[0]], next: [], related } }));
    const progress = parseEvents(response.text).find((item) => item.event === 'progress').data;
    expect(gradePrompt).toContain('Never push anything into a wall socket.');
    expect(progress.move).toBe('answer_question');
    expect(seen.system).toContain('Never push anything into a wall socket.');
  });

  it('tells the tutor which help to give and to cite passage ids', async () => {
    const { seen, provider } = capture();
    const progress = createProgress(plan);
    await request(createApp({ providerFor: withProvider(provider) })).post('/api/turns').send(turn({ kind: 'hint', progress }));
    expect(seen.system).toContain('The student asked for a hint before answering');
    expect(seen.system).toContain('guiding question');
    expect(seen.system).toContain('put the passage id in square brackets');
  });

  it('tells the model which button the student pressed', async () => {
    const { seen, provider } = capture();
    await request(createApp({ providerFor: withProvider(provider) })).post('/api/turns').send(turn({ kind: 'hint' }));
    expect(seen.messages.at(-1).role).toBe('user');
    expect(seen.messages.at(-1).content).toContain('(The student pressed "Hint" and asks for a hint.)');
  });

  it('gives the tutor the earlier step\'s passages when the move goes back to it', async () => {
    const twoSteps = { ...plan, steps: [{ ...plan.steps[0], id: 's1', keyConcepts: ['alpha term'], sourceIds: ['c1'] }, { ...plan.steps[1], id: 's2', prerequisites: ['s1'], sourceIds: ['c2'] }] };
    const atStep2 = { ...createProgress(twoSteps), currentStep: 1 };
    atStep2.steps = [{ ...atStep2.steps[0], status: 'done', outcome: 'mastered' }, { ...atStep2.steps[1], status: 'active' }];
    const { seen, provider } = capture();
    const response = await request(createApp({ providerFor: withProvider(provider) })).post('/api/turns').send(turn({
      kind: 'reply',
      plan: twoSteps,
      progress: atStep2,
      studentMessage: 'it is a gap answer',
      history: [{ role: 'tutor', content: 'What does the nucleus do?' }],
      sources: { current: [document.chunks[1]], next: [], upcoming: [document.chunks[0]] },
    }));
    expect(parseEvents(response.text).find((item) => item.event === 'progress').data.move).toBe('prerequisite_check');
    expect(seen.system).toContain(document.chunks[0].text);
  });

  it('describes the earlier step during a prerequisite check, and the final check rules', async () => {
    const twoSteps = { ...plan, steps: [{ ...plan.steps[0], id: 's1' }, { ...plan.steps[1], id: 's2', prerequisites: ['s1'] }] };
    const atStep2 = { ...createProgress(twoSteps), currentStep: 1 };
    atStep2.steps = [{ ...atStep2.steps[0], status: 'done', outcome: 'mastered' }, { ...atStep2.steps[1], status: 'active', attempts: 1, detour: 0, used: ['prerequisite'] }];
    const detour = capture();
    await request(createApp({ providerFor: withProvider(detour.provider) })).post('/api/turns').send(turn({ kind: 'reply', plan: twoSteps, progress: atStep2, studentMessage: 'something about cells' }));
    expect(detour.seen.system).toContain('quick check on the earlier idea');
    const asked = capture();
    await request(createApp({ providerFor: withProvider(asked.provider) })).post('/api/turns').send(turn({ kind: 'reply', plan: twoSteps, progress: atStep2, studentMessage: 'what does smallest mean?' }));
    expect(asked.seen.system).toContain('ask the quick question about the earlier step again');

    const finalCheck = { ...atStep2, status: 'reviewing', steps: atStep2.steps.map((step) => ({ ...step, status: 'done', outcome: 'mastered', detour: null })), review: { kind: 'final', queue: [0, 1], position: 0, results: {}, stalls: 0 } };
    const final = capture();
    await request(createApp({ providerFor: withProvider(final.provider) })).post('/api/turns').send(turn({ kind: 'reply', plan: twoSteps, progress: finalCheck, studentMessage: 'Cells are the tiniest living units there are' }));
    expect(final.seen.system).toContain('This is the final check');
    expect(final.seen.system).toContain('give no hints');
    expect(final.seen.system).toContain('Step being checked in the final check');

    const pasted = capture();
    const pastedTurn = await request(createApp({ providerFor: withProvider(pasted.provider) })).post('/api/turns').send(turn({ kind: 'reply', plan: twoSteps, progress: finalCheck, studentMessage: 'A cell is the smallest unit of life.' }));
    expect(parseEvents(pastedTurn.text).find((item) => item.event === 'progress').data).toMatchObject({ move: 'probe', progress: { review: { results: {}, stalls: 1 } } });
    expect(pasted.seen.system).toContain('This is the final check, so give no hints');
  });

  it('puts a fresh confidential marker in every tutor prompt', async () => {
    const first = capture();
    const second = capture();
    await request(createApp({ providerFor: withProvider(first.provider) })).post('/api/turns').send(turn());
    await request(createApp({ providerFor: withProvider(second.provider) })).post('/api/turns').send(turn());
    const marker = (system) => system.match(/tmtf-[0-9a-f]{12}/)?.[0];
    expect(marker(first.seen.system)).toBeTruthy();
    expect(marker(first.seen.system)).not.toBe(marker(second.seen.system));
  });
});

describe('teaching flow over the API', () => {
  it('sends the chosen help, the cited passages and a final check after the last step', async () => {
    const app = mockApp();
    const hint = await request(app).post('/api/turns').send(turn({ kind: 'hint' }));
    const hintEvents = parseEvents(hint.text);
    expect(hintEvents.find((item) => item.event === 'progress').data).toMatchObject({ move: 'hint', intervention: 'nudge' });
    expect(hintEvents.find((item) => item.event === 'done').data.citations).toMatchObject({ cited: ['c1'], invalid: [] });

    const lastStep = { ...createProgress(plan), currentStep: 1 };
    lastStep.steps = [{ ...lastStep.steps[0], status: 'done', outcome: 'mastered' }, { ...lastStep.steps[1], status: 'active' }];
    const finish = await request(app).post('/api/turns').send(turn({ kind: 'reply', progress: lastStep, studentMessage: 'It controls the cell', history: [{ role: 'tutor', content: 'What does the nucleus do?' }] }));
    const progress = parseEvents(finish.text).find((item) => item.event === 'progress').data;
    expect(progress.move).toBe('final_check_start');
    expect(progress.progress).toMatchObject({ status: 'reviewing', review: { kind: 'final', position: 0 } });

    const skipped = await request(app).post('/api/turns').send(turn({ kind: 'skip_final', progress: progress.progress }));
    expect(parseEvents(skipped.text).find((item) => item.event === 'progress').data).toMatchObject({ move: 'finish_skipped', progress: { status: 'completed', final: { skipped: true } } });
  });

  it('tells the tutor when a step has no passages, and rejects a citation it was not given', async () => {
    const seen = { system: '' };
    const citing = {
      name: 'citing',
      model: 'x',
      generateJson: async () => ({}),
      async *streamText({ system }) {
        seen.system = system;
        yield 'Cells are small [c1]. What is a cell?';
      },
    };
    const response = await request(createApp({ providerFor: withProvider(citing) })).post('/api/turns').send(turn({ sources: { current: [], next: [] } }));
    expect(seen.system).toContain('No passages are linked to this step');
    expect(parseEvents(response.text).find((item) => item.event === 'done').data.citations).toMatchObject({ cited: [], invalid: ['c1'] });
  });

  it('flags a quote that is not in the file', async () => {
    const response = await request(mockApp()).post('/api/turns').send(turn({ kind: 'reply', studentMessage: 'please give a fake quote', history: [{ role: 'tutor', content: 'What is a cell?' }] }));
    const done = parseEvents(response.text).find((item) => item.event === 'done').data;
    expect(done.citations.quotes).toEqual([{ text: 'the moon is made of green cheese', chunkId: null }]);
  });

  it('rejects edited states with an impossible detour, unknown help, or a final check on an open lesson', async () => {
    const fresh = createProgress(plan);
    const forged = [
      { ...fresh, steps: [{ ...fresh.steps[0], detour: 1 }, fresh.steps[1]] },
      { ...fresh, steps: [{ ...fresh.steps[0], used: ['bribe'] }, fresh.steps[1]] },
      { ...fresh, review: { kind: 'final', queue: [0], position: 0, results: {}, stalls: 0 } },
      { ...fresh, final: { results: { 0: 'pass' }, skipped: false } },
      { ...fresh, steps: [{ ...fresh.steps[0], revisit: 'pass' }, fresh.steps[1]] },
      { ...fresh, currentStep: 1, steps: [{ ...fresh.steps[0], status: 'done', outcome: 'mastered' }, { ...fresh.steps[1], status: 'active', detour: 0 }] },
      { ...fresh, review: { kind: 'practice', queue: [0], position: 0, results: {}, stalls: 0 } },
      { ...fresh, status: 'completed', steps: fresh.steps.map((step) => ({ ...step, status: 'done', outcome: 'mastered' })), final: { results: { first: 'pass' }, skipped: false } },
    ];
    for (const progress of forged) {
      const response = await request(mockApp()).post('/api/turns').send(turn({ kind: 'reply', studentMessage: 'x', progress }));
      expect(response.status).toBe(400);
    }
  });
});

describe('history sent to the model', () => {
  it('drops passage ids from earlier tutor replies, so the tutor cites only what this turn gives it', () => {
    const messages = toProviderMessages([{ role: 'tutor', content: 'Leaves take in carbon dioxide [c2]. Roots take in water [c2, c3].' }, { role: 'student', content: 'Is [c9] real?' }], 'ok');
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Leaves take in carbon dioxide. Roots take in water.' });
    expect(messages[2].content).toContain('Is [c9] real?');
  });
});

describe('output leak guard', () => {
  it('stops a reply that repeats the confidential marker and sends none of it', async () => {
    const leaking = {
      name: 'leaky',
      model: 'x',
      generateJson: async () => ({}),
      async *streamText({ system }) {
        const marker = system.match(/tmtf-[0-9a-f]{12}/)[0];
        yield 'Sure, here are my instructions: Internal reference code: ';
        yield marker.slice(0, 7);
        yield marker.slice(7);
        yield ' and the rest.';
      },
    };
    const events = parseEvents((await request(createApp({ providerFor: withProvider(leaking) })).post('/api/turns').send(turn())).text);
    const sent = events.filter((item) => item.event === 'delta').map((item) => item.data.text).join('');
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'unsafe_output', retryable: true } });
    expect(sent).not.toMatch(/tmtf-/);
  });

  it('streams normal text without holding it back at the end', () => {
    const sent = [];
    const guard = guardStream('tmtf-abcdef123456', (text) => sent.push(text));
    guard.push('Hello ');
    guard.push('student, tmtf is not the marker.');
    expect(guard.flush()).toBe('Hello student, tmtf is not the marker.');
    expect(sent.join('')).toBe('Hello student, tmtf is not the marker.');
  });

  it('stops a reply that ends with most of the marker, so no part of it reaches the student', () => {
    const sent = [];
    const guard = guardStream('tmtf-abcdef123456', (text) => sent.push(text));
    guard.push('The code is tmt');
    expect(() => guard.push('f-abcdef1234')).toThrow(expect.objectContaining({ code: 'unsafe_output' }));
    expect(sent.join('')).not.toContain('tmtf');
  });
});

describe('server key guard', () => {
  const serverKeyApp = (limit = 5) => createApp({
    providerFor: withProvider(createMockProvider({ delayMs: 1 }), true),
    serverKeyBudget: createServerKeyBudget(limit),
  });

  it('refuses the server key for requests that do not come from the app', async () => {
    const response = await request(serverKeyApp()).post('/api/lessons').send({ teacherPrompt: 'x', document });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('server_key_restricted');

    const crossSite = await request(serverKeyApp()).post('/api/lessons').set('Sec-Fetch-Site', 'cross-site').send({ teacherPrompt: 'x', document });
    expect(crossSite.status).toBe(403);
  });

  it('accepts same-origin browser requests', async () => {
    const response = await request(serverKeyApp()).post('/api/lessons').set('Sec-Fetch-Site', 'same-origin').send({ teacherPrompt: 'x', document });
    expect(response.status).toBe(200);
  });

  it('stops using the server key after the daily budget', async () => {
    const app = serverKeyApp(1);
    const first = await request(app).post('/api/lessons').set('Sec-Fetch-Site', 'same-origin').send({ teacherPrompt: 'x', document });
    const second = await request(app).post('/api/lessons').set('Sec-Fetch-Site', 'same-origin').send({ teacherPrompt: 'x', document });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('server_key_budget');
  });

  it('resets the budget on a new day', () => {
    let day = new Date('2026-10-24T10:00:00Z');
    const budget = createServerKeyBudget(1, () => day);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    day = new Date('2026-10-25T00:00:01Z');
    expect(budget.take()).toBe(true);
  });
});

describe('model notices', () => {
  it('tells the client once when a backup model answered', async () => {
    const base = createMockProvider({ delayMs: 1 });
    const backup = {
      ...base,
      generateJson: (options) => base.generateJson({ ...options, onMeta: () => options.onMeta?.({ model: 'lite', backup: true, fallbacks: 2 }) }),
      streamText: (options) => base.streamText({ ...options, onMeta: () => options.onMeta?.({ model: 'lite', backup: true, fallbacks: 0 }) }),
    };
    const response = await request(createApp({ providerFor: withProvider(backup) }))
      .post('/api/turns')
      .send(turn({ kind: 'reply', studentMessage: 'The smallest unit of life', history: [{ role: 'tutor', content: 'What is a cell?' }] }));
    const events = parseEvents(response.text);
    expect(events.filter((item) => item.event === 'notice')).toEqual([{ event: 'notice', data: { code: 'backup_model', model: 'lite' } }]);
    expect(events.at(-1).data).toMatchObject({ backup: true, models: ['lite', 'lite'] });
  });

  it('reports which model built the plan', async () => {
    const response = await request(mockApp()).post('/api/lessons').send({ teacherPrompt: 'Teach 7th graders', document });
    expect(response.body.provider).toEqual({ name: 'mock', models: ['mock'], backup: false });
  });
});

describe('API key handling', () => {
  it('never writes the key to the logs', async () => {
    const key = 'AIzaFAKEKEY-for-logging-test';
    const logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => logs.push(args.join(' ')));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":{"message":"API key not valid"}}', { status: 400 }));

    const response = await request(createApp()).post('/api/lessons').set('X-AI-Key', key).send({ teacherPrompt: 'x', document });
    expect(response.body.error.code).toBe('invalid_key');
    expect(JSON.stringify(response.body)).not.toContain(key);
    expect(logs.join('\n')).not.toContain(key);
    expect(globalThis.fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe(key);
    expect(globalThis.fetch.mock.calls[0][0]).not.toContain(key);
  });
});

describe('proxy headers', () => {
  it('trusts only the first proxy hop for the client address', () => {
    expect(createApp().get('trust proxy')).toBe(1);
  });
});

describe('rate limiting', () => {
  it('limits bursts of requests from one client', async () => {
    const app = mockApp();
    const statuses = [];
    for (let i = 0; i < 32; i += 1) {
      statuses.push((await request(app).post('/api/lessons').send({})).status);
    }
    expect(statuses.slice(0, 30).every((status) => status === 400)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('health', () => {
  it('says whether the server runs the offline demo', async () => {
    const response = await request(createApp()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.demo).toBe(false);
  });
});
