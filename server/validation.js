import { AppError } from './errors.js';

export const LIMITS = {
  teacherPrompt: 3000,
  studentMessage: 2000,
  chunkText: 2000,
  planChunks: 400,
  planChars: 90000,
  turnSources: 6,
  history: 40,
  historyMessage: 6000,
  steps: 10,
};

const fail = (detail) => {
  throw new AppError('invalid_request', `The request was not valid: ${detail}.`);
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const string = (value, name, { max, required = true }) => {
  if (typeof value !== 'string') fail(`${name} must be text`);
  if (required && !value.trim()) fail(`${name} is required`);
  if (value.length > max) fail(`${name} is longer than ${max} characters`);
  return value;
};

const array = (value, name, max) => {
  if (!Array.isArray(value)) fail(`${name} must be a list`);
  if (value.length > max) fail(`${name} has more than ${max} items`);
  return value;
};

const chunks = (value, name, max) =>
  array(value, name, max).map((chunk, index) => {
    if (!isObject(chunk)) fail(`${name}[${index}] is not valid`);
    return {
      id: string(chunk.id, `${name}[${index}].id`, { max: 20 }),
      label: string(chunk.label, `${name}[${index}].label`, { max: 120 }),
      text: string(chunk.text, `${name}[${index}].text`, { max: LIMITS.chunkText }),
    };
  });

export const validatePlanRequest = (body) => {
  if (!isObject(body) || !isObject(body.document)) fail('missing document');
  const teacherPrompt = string(body.teacherPrompt, 'teacherPrompt', { max: LIMITS.teacherPrompt });
  const documentChunks = chunks(body.document.chunks, 'document.chunks', LIMITS.planChunks);
  if (documentChunks.length === 0) fail('the document has no text');
  const totalChars = documentChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  if (totalChars > LIMITS.planChars) fail('the document excerpt is too long');
  const totalChunks = Number.isInteger(body.document.totalChunks) ? body.document.totalChunks : documentChunks.length;

  return {
    teacherPrompt,
    document: {
      name: string(body.document.name, 'document.name', { max: 200 }),
      chunks: documentChunks,
      totalChunks: Math.max(totalChunks, documentChunks.length),
    },
  };
};

const stringList = (value, name) => array(value ?? [], name, 10).map((item) => string(item, name, { max: 400, required: false }));

const plan = (value) => {
  if (!isObject(value)) fail('missing plan');
  const steps = array(value.steps, 'plan.steps', LIMITS.steps);
  if (steps.length === 0) fail('the plan has no steps');
  return {
    title: string(value.title, 'plan.title', { max: 200 }),
    languageCode: string(value.languageCode, 'plan.languageCode', { max: 20 }),
    audience: string(value.audience ?? '', 'plan.audience', { max: 300, required: false }),
    style: string(value.style ?? '', 'plan.style', { max: 400, required: false }),
    objectives: stringList(value.objectives, 'plan.objectives'),
    steps: steps.map((step, index) => {
      if (!isObject(step)) fail(`plan.steps[${index}] is not valid`);
      const field = (key) => string(step[key] ?? '', `plan.steps[${index}].${key}`, { max: 500, required: false });
      return {
        title: field('title'),
        goal: field('goal'),
        keyConcepts: stringList(step.keyConcepts, `plan.steps[${index}].keyConcepts`),
        checkQuestion: field('checkQuestion'),
        successCriteria: field('successCriteria'),
      };
    }),
  };
};

const STEP_STATUSES = new Set(['pending', 'active', 'done']);
const OUTCOMES = new Set([null, 'mastered', 'learned', 'revealed']);

const progress = (value, stepCount) => {
  if (!isObject(value)) fail('missing progress');
  const steps = array(value.steps, 'progress.steps', LIMITS.steps);
  if (steps.length !== stepCount) fail('progress does not match the plan');
  if (!Number.isInteger(value.currentStep) || value.currentStep < 0 || value.currentStep >= stepCount) {
    fail('progress.currentStep is out of range');
  }
  if (!['active', 'completed'].includes(value.status)) fail('progress.status is not valid');
  return {
    status: value.status,
    currentStep: value.currentStep,
    steps: steps.map((step) => {
      if (!isObject(step) || !STEP_STATUSES.has(step.status) || !OUTCOMES.has(step.outcome ?? null)) {
        fail('progress step is not valid');
      }
      const attempts = Number.isInteger(step.attempts) && step.attempts >= 0 ? Math.min(step.attempts, 10) : 0;
      return { status: step.status, attempts, outcome: step.outcome ?? null };
    }),
  };
};

const history = (value) =>
  array(value ?? [], 'history', LIMITS.history).map((message, index) => {
    if (!isObject(message) || !['tutor', 'student'].includes(message.role)) fail(`history[${index}] is not valid`);
    return { role: message.role, content: string(message.content, `history[${index}].content`, { max: LIMITS.historyMessage, required: false }) };
  });

export const validateTurnRequest = (body) => {
  if (!isObject(body)) fail('missing body');
  if (!['start', 'reply'].includes(body.kind)) fail('kind must be start or reply');
  const lessonPlan = plan(body.plan);
  const sources = isObject(body.sources) ? body.sources : {};

  return {
    kind: body.kind,
    teacherPrompt: string(body.teacherPrompt, 'teacherPrompt', { max: LIMITS.teacherPrompt }),
    plan: lessonPlan,
    progress: progress(body.progress, lessonPlan.steps.length),
    history: history(body.history),
    studentMessage: body.kind === 'reply' ? string(body.studentMessage, 'studentMessage', { max: LIMITS.studentMessage }) : '',
    sources: {
      current: chunks(sources.current ?? [], 'sources.current', LIMITS.turnSources),
      next: chunks(sources.next ?? [], 'sources.next', LIMITS.turnSources),
    },
  };
};
