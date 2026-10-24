import { AppError } from './errors.js';
import { OUTCOMES as LESSON_OUTCOMES, REVIEW_RESULTS } from './lesson/progress.js';

export const LIMITS = {
  teacherPrompt: 3000,
  studentMessage: 2000,
  chunkText: 2000,
  planChunks: 400,
  planChars: 90000,
  turnSources: 6,
  relatedSources: 3,
  history: 40,
  historyMessage: 6000,
  steps: 10,
};

const APPROACHES = new Set(['explain', 'worked_example', 'practice']);

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
    const clean = {
      id: string(chunk.id, `${name}[${index}].id`, { max: 20 }),
      label: string(chunk.label, `${name}[${index}].label`, { max: 120 }),
      text: string(chunk.text, `${name}[${index}].text`, { max: LIMITS.chunkText }),
    };
    if (chunk.section !== undefined) clean.section = string(chunk.section, `${name}[${index}].section`, { max: 120, required: false });
    return clean;
  });

export const validatePlanRequest = (body) => {
  if (!isObject(body) || !isObject(body.document)) fail('missing document');
  const teacherPrompt = string(body.teacherPrompt, 'teacherPrompt', { max: LIMITS.teacherPrompt });
  const documentChunks = chunks(body.document.chunks, 'document.chunks', LIMITS.planChunks);
  if (documentChunks.length === 0) fail('the document has no text');
  const totalChars = documentChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  if (totalChars > LIMITS.planChars) fail('the document excerpt is too long');
  const totalChunks = Number.isInteger(body.document.totalChunks) ? body.document.totalChunks : documentChunks.length;
  const lessonLanguage = body.lessonLanguage ? string(body.lessonLanguage, 'lessonLanguage', { max: 12 }) : null;
  if (lessonLanguage && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(lessonLanguage)) fail('lessonLanguage is not a language code');

  return {
    teacherPrompt,
    lessonLanguage: lessonLanguage?.toLowerCase() ?? null,
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
      const stepId = typeof step.id === 'string' ? step.id.slice(0, 10) : `s${index + 1}`;
      const field = (key) => string(step[key] ?? '', `plan.steps[${index}].${key}`, { max: 500, required: false });
      return {
        id: stepId,
        title: field('title'),
        goal: field('goal'),
        keyConcepts: stringList(step.keyConcepts, `plan.steps[${index}].keyConcepts`),
        approach: APPROACHES.has(step.approach) ? step.approach : 'explain',
        checkQuestion: field('checkQuestion'),
        successCriteria: field('successCriteria'),
        commonMistake: field('commonMistake'),
        prerequisites: array(step.prerequisites ?? [], `plan.steps[${index}].prerequisites`, LIMITS.steps).map((id) => string(id, `plan.steps[${index}].prerequisites`, { max: 10 })),
      };
    }),
  };
};

const STEP_STATUSES = new Set(['pending', 'active', 'done']);
const PHASES = new Set(['learn', 'recheck']);
const OUTCOMES = new Set([null, ...LESSON_OUTCOMES]);

const count = (value, max, name) => {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0 || value > max) fail(`${name} is out of range`);
  return value;
};

const checkConsistency = ({ status, currentStep, steps }) => {
  steps.forEach((step, index) => {
    if ((step.status === 'done') !== (step.outcome !== null)) fail('progress step outcome does not match its status');
    const expected = status !== 'active' ? 'done' : index < currentStep ? 'done' : index === currentStep ? 'active' : 'pending';
    if (step.status !== expected) fail('progress steps do not match the current step');
  });
};

const review = (value, status, stepCount) => {
  if (status !== 'reviewing' && (value === null || value === undefined)) return null;
  if (!isObject(value)) fail('progress.review is not valid');
  const queue = array(value.queue, 'progress.review.queue', stepCount);
  if (!queue.length || queue.some((index) => !Number.isInteger(index) || index < 0 || index >= stepCount) || new Set(queue).size !== queue.length) {
    fail('progress.review.queue is not valid');
  }
  if (!Number.isInteger(value.position) || value.position < 0 || value.position >= queue.length) fail('progress.review.position is out of range');
  const results = isObject(value.results) ? value.results : {};
  const cleanResults = Object.fromEntries(Object.entries(results).map(([key, result]) => {
    if (!queue.includes(Number(key)) || !REVIEW_RESULTS.includes(result)) fail('progress.review.results is not valid');
    return [Number(key), result];
  }));
  return { queue, position: value.position, results: cleanResults, stalls: count(value.stalls, 10, 'progress.review.stalls') };
};

const progress = (value, stepCount) => {
  if (!isObject(value)) fail('missing progress');
  const steps = array(value.steps, 'progress.steps', LIMITS.steps);
  if (steps.length !== stepCount) fail('progress does not match the plan');
  if (!Number.isInteger(value.currentStep) || value.currentStep < 0 || value.currentStep >= stepCount) {
    fail('progress.currentStep is out of range');
  }
  if (!['active', 'completed', 'reviewing'].includes(value.status)) fail('progress.status is not valid');
  const clean = {
    status: value.status,
    currentStep: value.currentStep,
    review: review(value.review, value.status, stepCount),
    steps: steps.map((step) => {
      if (!isObject(step) || !STEP_STATUSES.has(step.status) || !OUTCOMES.has(step.outcome ?? null) || !PHASES.has(step.phase ?? 'learn')) {
        fail('progress step is not valid');
      }
      return {
        status: step.status,
        phase: step.phase ?? 'learn',
        attempts: count(step.attempts, 10, 'progress step attempts'),
        stalls: count(step.stalls, 10, 'progress step stalls'),
        probed: step.probed === true,
        outcome: step.outcome ?? null,
      };
    }),
  };
  checkConsistency(clean);
  return clean;
};

const history = (value) =>
  array(value ?? [], 'history', LIMITS.history).map((message, index) => {
    if (!isObject(message) || !['tutor', 'student'].includes(message.role)) fail(`history[${index}] is not valid`);
    return { role: message.role, content: string(message.content, `history[${index}].content`, { max: LIMITS.historyMessage, required: false }) };
  });

export const validateTurnRequest = (body) => {
  if (!isObject(body)) fail('missing body');
  if (!['start', 'reply', 'review'].includes(body.kind)) fail('kind must be start, reply or review');
  const lessonPlan = plan(body.plan);
  const lessonProgress = progress(body.progress, lessonPlan.steps.length);
  if (body.kind === 'review' && lessonProgress.status !== 'completed') fail('a review can only start after the lesson is complete');
  const sources = isObject(body.sources) ? body.sources : {};

  return {
    kind: body.kind,
    teacherPrompt: string(body.teacherPrompt, 'teacherPrompt', { max: LIMITS.teacherPrompt }),
    plan: lessonPlan,
    progress: lessonProgress,
    history: history(body.history),
    studentMessage: body.kind === 'reply' ? string(body.studentMessage, 'studentMessage', { max: LIMITS.studentMessage }) : '',
    sources: {
      current: chunks(sources.current ?? [], 'sources.current', LIMITS.turnSources),
      next: chunks(sources.next ?? [], 'sources.next', LIMITS.turnSources),
      related: chunks(sources.related ?? [], 'sources.related', LIMITS.relatedSources),
    },
  };
};
