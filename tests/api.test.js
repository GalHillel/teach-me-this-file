import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { AppError } from '../server/errors.js';
import { createProgress } from '../server/lesson/progress.js';
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

const mockApp = () => {
  const provider = createMockProvider({ delayMs: 1 });
  return createApp({ providerFor: () => provider });
};

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
    expect(progress.verdict).toBe('incorrect');
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

  it('sends provider errors as an error event', async () => {
    const failing = {
      name: 'failing',
      model: 'x',
      generateJson: async () => ({}),
      async *streamText() {
        throw new AppError('invalid_key');
      },
    };
    const app = createApp({ providerFor: () => failing });
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
    const server = createApp({ providerFor: () => slow }).listen(0);
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
