import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { normalizeAssessment } from '../server/lesson/assessor.js';
import { createProgress, isTeaching, needsGrade, planMove, tutorMessagesOnStep } from '../server/lesson/progress.js';
import { buildAssessPrompt, buildTutorSystem } from '../server/lesson/prompts.js';
import { createMockProvider } from '../server/providers/mock.js';
import { stepState } from '../shared/learner.js';
import { asked } from './asked.js';

const plan = {
  title: 'Magnets',
  languageCode: 'en',
  audience: 'Students',
  style: '',
  objectives: ['Know how magnets act'],
  steps: [
    { id: 's1', title: 'Poles', goal: 'Like poles repel', keyConcepts: ['pole'], checkQuestion: 'What happens when two north poles meet?', successCriteria: 'They push apart because like poles repel', commonMistake: 'Magnets always attract', prerequisites: [], sourceIds: ['c1'] },
    { id: 's2', title: 'Compass', goal: 'A compass needle is a magnet', keyConcepts: ['compass'], checkQuestion: 'Why does a compass needle point north?', successCriteria: 'The needle is a magnet pulled by the Earth, which acts like a giant magnet', commonMistake: 'The needle is pulled by the North Pole ice', prerequisites: ['s1'], sourceIds: ['c2'] },
  ],
};

const grade = (verdict, extra = {}) => ({ verdict, confidence: 'high', issue: 'none', misconception: '', conceptsMissing: [], missingPrerequisite: 0, ...extra });
const reply = (progress, assessment) => planMove(progress, { kind: 'reply', assessment, plan, sourceIds: ['c1'] });

describe('teach first, check after: the policy', () => {
  it('teaches a new step without a check question and asks it only after the student replies', () => {
    const start = createProgress(plan);
    expect(isTeaching(start)).toBe(true);
    expect(planMove(start, { kind: 'start', plan }).move).toBe('introduce');
    expect(needsGrade(start, 'reply')).toBe(false);
    const next = reply(start, null);
    expect(next.move).toBe('ask_check');
    expect(next.reason).toBe('explanation_given');
    expect(isTeaching(next.progress)).toBe(false);
    expect(needsGrade(next.progress, 'reply')).toBe(true);
    expect(next.progress.evidence).toEqual([]);
  });

  it('asks the question when the student presses Hint before it, and explains again on Explain without leaving the teach phase', () => {
    const start = createProgress(plan);
    const hinted = planMove(start, { kind: 'hint', plan });
    expect([hinted.move, hinted.reason, hinted.progress.steps[0].hints]).toEqual(['ask_check', 'hint_before_question', 0]);
    const explained = planMove(start, { kind: 'explain', plan });
    expect(explained.move).toBe('explain_again');
    expect(isTeaching(explained.progress)).toBe(true);
    expect(explained.progress.steps[0].used).toEqual([]);
  });

  it('starts the next step in the teach phase after a right answer', () => {
    const done = reply(asked(createProgress(plan)), grade('correct'));
    expect(done.move).toBe('advance');
    expect(done.progress.currentStep).toBe(1);
    expect(done.progress.steps[1]).toMatchObject({ status: 'active', phase: 'teach', turns: 1 });
  });

  it('does not count a right answer as shown on your own when the tutor had already given it', () => {
    const done = reply(asked(createProgress(plan)), grade('correct', { answerGiven: true }));
    expect(done.move).toBe('advance');
    expect(done.reason).toBe('answer_was_shown');
    expect(done.progress.steps[0].outcome).toBe('learned');
    expect(done.progress.evidence[0]).toMatchObject({ question: 'check', support: 'revealed', verdict: 'correct' });
    expect(stepState(done.progress, 0)).toMatchObject({ state: 'developing', basis: 'revealed_answer', independent: false });
  });

  it('marks an answer after a hint that gave the answer away as revealed, not hinted', () => {
    const hinted = planMove(asked(createProgress(plan)), { kind: 'hint', plan });
    const done = reply(hinted.progress, grade('correct', { answerGiven: true }));
    expect(done.progress.evidence.at(-1).support).toBe('revealed');
    expect(stepState(done.progress, 0).state).toBe('developing');
  });

  it('still counts an independent right answer as shown on your own', () => {
    const done = reply(asked(createProgress(plan)), grade('correct'));
    expect(done.progress.steps[0].outcome).toBe('mastered');
    expect(stepState(done.progress, 0)).toMatchObject({ state: 'demonstrated', independent: true });
  });

  it('does not move on when a right answer comes with a wrong reason, which the grader calls partial', () => {
    const next = reply(asked(createProgress(plan)), grade('partial', { misconception: 'thinks the poles are both south' }));
    expect(next.move).toBe('hint');
    expect(next.progress.currentStep).toBe(0);
  });

  it('counts the tutor messages of the current step and hands only those to the grader', () => {
    let progress = planMove(createProgress(plan), { kind: 'start', plan }).progress;
    progress = reply(progress, null).progress;
    expect(progress.steps[0].turns).toBe(2);
    const history = [
      { role: 'tutor', content: 'old message from another lesson part' },
      { role: 'tutor', content: 'Two magnets: like poles push apart.' },
      { role: 'student', content: 'OK' },
      { role: 'tutor', content: 'What happens when two north poles meet?' },
    ];
    expect(tutorMessagesOnStep(progress, history)).toEqual(['Two magnets: like poles push apart.', 'What happens when two north poles meet?']);
  });
});

describe('teach first, check after: what the model sees', () => {
  const teachingProgress = planMove(createProgress(plan), { kind: 'start', plan }).progress;

  it('keeps the check question and its success criteria out of the teaching prompt', () => {
    const system = buildTutorSystem({ plan, progress: teachingProgress, teacherPrompt: 'x', sources: [], move: 'introduce', pace: 'normal' });
    expect(system).not.toContain(plan.steps[0].checkQuestion);
    expect(system).not.toContain(plan.steps[0].successCriteria);
    expect(system).toContain('the check question comes in your next message');
  });

  it('keeps the next step\'s check question out of the message that confirms an answer and teaches the next step', () => {
    const advanced = reply(asked(createProgress(plan)), grade('correct')).progress;
    const system = buildTutorSystem({ plan, progress: advanced, teacherPrompt: 'x', sources: [], move: 'advance', assessment: { ...grade('correct'), conceptsShown: [], conceptsMissing: [] }, pace: 'normal' });
    expect(system).not.toContain(plan.steps[1].checkQuestion);
    expect(system).not.toContain(plan.steps[1].successCriteria);
  });

  it('gives the check question only to the separate message that asks it', () => {
    const askedProgress = reply(teachingProgress, null).progress;
    const system = buildTutorSystem({ plan, progress: askedProgress, teacherPrompt: 'x', sources: [], move: 'ask_check', pace: 'normal' });
    expect(system).toContain(plan.steps[0].checkQuestion);
    expect(system).toContain('give no hint toward the answer');
  });

  it('shows the grader the tutor\'s earlier messages on the step and asks whether they gave the answer', () => {
    const prompt = buildAssessPrompt({ plan, step: plan.steps[0], tutorQuestion: 'What happens?', studentMessage: 'They push apart', sources: [], taught: ['Like poles push apart.'] });
    expect(prompt).toContain('<tutor_messages>\nLike poles push apart.\n</tutor_messages>');
  });
});

describe('teach first, check after: adversarial answers', () => {
  const sources = [{ text: 'Like poles repel each other and unlike poles attract each other.' }];
  const teaching = 'When you bring two north poles of bar magnets together they push each other away, because like poles repel.';

  it('treats an answer copied from the tutor\'s explanation as copied, and as an answer that was given', () => {
    const graded = normalizeAssessment({ verdict: 'correct', completeness: 1, confidence: 'high', issue: 'none' }, 'two north poles of bar magnets together they push each other away, because like poles repel', sources, [], [teaching]);
    expect(graded.issue).toBe('copied');
    expect(graded.answerGiven).toBe(true);
    expect(graded.checks).toEqual(expect.arrayContaining(['copied_from_tutor', 'answer_in_tutor_messages']));
  });

  it('treats an answer copied from the document as copied, which the policy probes instead of accepting', () => {
    const graded = normalizeAssessment({ verdict: 'correct', completeness: 1, confidence: 'high', issue: 'none' }, 'Like poles repel each other and unlike poles attract each other.', sources);
    expect(graded.issue).toBe('copied');
    expect(reply(asked(createProgress(plan)), graded).move).toBe('probe');
  });

  it('takes the grader\'s word that the answer was in an example or implied too directly, but only for a right answer', () => {
    const shown = normalizeAssessment({ verdict: 'correct', completeness: 1, confidence: 'high', issue: 'none', answerGiven: true }, 'They push apart since both are north', sources, [], [teaching]);
    expect(shown.answerGiven).toBe(true);
    const wrong = normalizeAssessment({ verdict: 'incorrect', completeness: 0, confidence: 'high', issue: 'none', answerGiven: true }, 'They stick together', sources, [], [teaching]);
    expect(wrong.answerGiven).toBe(false);
  });

  it('ignores an answer-given flag when no tutor messages were shown to the grader', () => {
    const graded = normalizeAssessment({ verdict: 'correct', completeness: 1, confidence: 'high', issue: 'none', answerGiven: true }, 'They push apart', sources);
    expect(graded.answerGiven).toBe(false);
  });
});

const document = [
  { id: 'c1', label: 'Lines 1–10', text: 'Like poles repel each other and unlike poles attract each other, so two north poles push apart.' },
  { id: 'c2', label: 'Lines 11–20', text: 'A compass needle is a small magnet, and the Earth acts like a giant magnet that pulls on it.' },
];

const calls = () => {
  const mock = createMockProvider({ delayMs: 1 });
  const seen = { json: [], text: [] };
  return {
    seen,
    provider: {
      ...mock,
      async generateJson(args) {
        seen.json.push(args);
        return mock.generateJson(args);
      },
      async *streamText(args) {
        seen.text.push(args);
        yield* mock.streamText(args);
      },
    },
  };
};

const parse = (text) => text.split('\n\n').filter((block) => block.startsWith('event:')).map((block) => {
  const [eventLine, dataLine] = block.split('\n');
  return { event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) };
});

describe('teach first, check after: a lesson over the API', () => {
  it('teaches, asks, grades and records the support of each answer through a whole lesson', async () => {
    const { provider, seen } = calls();
    const app = createApp({ providerFor: () => ({ provider, usesServerKey: false }) });
    let progress = createProgress(plan);
    const history = [];
    const send = async (kind, studentMessage = '') => {
      const response = await request(app).post('/api/turns').send({ kind, teacherPrompt: 'Teach', plan, progress, history, studentMessage, sources: { current: [document[progress.currentStep] ?? document[0]], next: [] } });
      expect(response.status).toBe(200);
      const events = parse(response.text);
      const update = events.find((item) => item.event === 'progress').data;
      const text = events.filter((item) => item.event === 'delta').map((item) => item.data.text).join('');
      if (studentMessage) history.push({ role: 'student', content: studentMessage });
      history.push({ role: 'tutor', content: text });
      progress = update.progress;
      return update;
    };

    expect((await send('start')).move).toBe('introduce');
    expect(seen.json).toHaveLength(0);
    expect(seen.text[0].system).not.toContain(plan.steps[0].checkQuestion);

    expect((await send('reply', 'OK, that makes sense.')).move).toBe('ask_check');
    expect(seen.json).toHaveLength(0);
    expect(seen.text[1].system).toContain(plan.steps[0].checkQuestion);

    const first = await send('reply', 'They push apart because like poles repel.');
    expect(first.move).toBe('advance');
    expect(seen.json).toHaveLength(1);
    expect(seen.json[0].prompt).toContain('<tutor_messages>');
    expect(seen.text[2].system).not.toContain(plan.steps[1].checkQuestion);

    expect((await send('reply', 'Got it.')).move).toBe('ask_check');
    expect(seen.json).toHaveLength(1);

    const second = await send('reply', 'As you said, the Earth is a giant magnet that pulls the needle.');
    expect(second.move).toBe('final_check_start');
    expect(second.assessment.answerGiven).toBe(true);
    expect(progress.evidence.map((entry) => [entry.step, entry.support])).toEqual([[0, 'independent'], [1, 'revealed']]);
    expect(stepState(progress, 0).state).toBe('demonstrated');
    expect(stepState(progress, 1).state).toBe('developing');
    expect(progress.review.queue).toContain(1);
  });
});
