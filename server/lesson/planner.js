import { directionForLanguage, rankChunks } from '../../shared/text.js';
import { AppError } from '../errors.js';
import { PLAN_SYSTEM, buildPlanPrompt } from './prompts.js';
import { createProgress } from './progress.js';

const MAX_STEPS = 10;

const text = (value, max, fallback = '') => {
  const clean = typeof value === 'string' ? value.trim() : '';
  return (clean || fallback).slice(0, max);
};

const textList = (value, maxItems, maxLength) =>
  (Array.isArray(value) ? value : [])
    .map((item) => text(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);

const languageCode = (value) => {
  const code = text(value, 20);
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(code) ? code.toLowerCase() : 'en';
};

const stepSources = (rawIds, step, chunks, validIds) => {
  const ids = textList(rawIds, 4, 20).filter((id) => validIds.has(id));
  if (ids.length > 0) return [...new Set(ids)];
  const query = [step.title, step.goal, ...step.keyConcepts].join(' ');
  return rankChunks(query, chunks, { limit: 2, minShared: 2, minScore: 0.1 }).map((match) => match.chunk.id);
};

export const validatePlan = (raw, chunks, fallbackTitle) => {
  const validIds = new Set(chunks.map((chunk) => chunk.id));
  const steps = (Array.isArray(raw?.steps) ? raw.steps : [])
    .map((item) => ({
      title: text(item?.title, 120),
      goal: text(item?.goal, 400),
      keyConcepts: textList(item?.keyConcepts, 6, 80),
      checkQuestion: text(item?.checkQuestion, 400),
      successCriteria: text(item?.successCriteria, 400),
      rawSourceIds: item?.sourceIds,
    }))
    .filter((step) => step.title && step.checkQuestion)
    .slice(0, MAX_STEPS)
    .map(({ rawSourceIds, ...step }, index) => ({
      id: `s${index + 1}`,
      ...step,
      goal: step.goal || step.title,
      successCriteria: step.successCriteria || step.goal || step.title,
      sourceIds: stepSources(rawSourceIds, step, chunks, validIds),
    }));

  if (steps.length === 0) throw new AppError('bad_response', 'The AI did not return a usable lesson plan. Try again.');

  const code = languageCode(raw.languageCode);
  const minutes = Number(raw.durationMinutes);
  return {
    title: text(raw.title, 120, fallbackTitle),
    languageCode: code,
    direction: directionForLanguage(code),
    audience: text(raw.audience, 200, 'Student'),
    durationMinutes: Number.isFinite(minutes) ? Math.min(Math.max(Math.round(minutes), 5), 90) : 15,
    style: text(raw.style, 300),
    objectives: textList(raw.objectives, 5, 200),
    steps,
    notes: text(raw.notes, 500),
  };
};

export const createLessonPlan = async ({ provider, teacherPrompt, document, signal }) => {
  const raw = await provider.generateJson({
    task: 'plan',
    system: PLAN_SYSTEM,
    prompt: buildPlanPrompt({ teacherPrompt, document }),
    signal,
  });
  const plan = validatePlan(raw, document.chunks, document.name.replace(/\.[^.]+$/, ''));
  return { plan, progress: createProgress(plan) };
};
