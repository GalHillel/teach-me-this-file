import { directionForLanguage, rankChunks } from '../../shared/text.js';
import { AppError } from '../errors.js';
import { orderByPrerequisites } from './ordering.js';
import { PLAN_SYSTEM, buildPlanPrompt } from './prompts.js';
import { createProgress } from './progress.js';

const APPROACHES = new Set(['explain', 'worked_example', 'practice']);
const CONTENT_TYPES = new Set(['concept', 'procedure', 'narrative', 'language', 'mixed']);
const MINUTES = /(\d{1,3})\s*(?:-|–)?\s*(?:min\b|mins\b|minutes?\b|minutos?\b|דק(?:ות|ה|')?)/iu;

const text = (value, max, fallback = '') => {
  const clean = typeof value === 'string' ? value.trim() : '';
  return (clean || fallback).slice(0, max);
};

const textList = (value, maxItems, maxLength) =>
  (Array.isArray(value) ? value : [])
    .map((item) => text(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);

export const languageCode = (value, fallback = 'en') => {
  const code = text(value, 20);
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(code) ? code.toLowerCase() : fallback;
};

export const minutesFromPrompt = (teacherPrompt) => {
  const match = String(teacherPrompt || '').match(MINUTES);
  const minutes = match ? Number(match[1]) : null;
  return minutes && minutes >= 3 && minutes <= 180 ? minutes : null;
};

export const maxStepsFor = ({ documentChars, minutes }) => {
  const byLength = documentChars <= 600 ? 2 : documentChars <= 1500 ? 3 : documentChars <= 3000 ? 4 : documentChars <= 6000 ? 6 : 8;
  const byTime = minutes ? Math.max(2, Math.ceil(minutes / 2.5)) : 8;
  return Math.min(byLength, byTime, 8);
};

const stepSources = (rawIds, step, chunks, validIds) => {
  const ids = textList(rawIds, 4, 20).filter((id) => validIds.has(id));
  if (ids.length > 0) return [...new Set(ids)];
  const query = [step.title, step.goal, ...step.keyConcepts].join(' ');
  return rankChunks(query, chunks, { limit: 2, minShared: 2, minScore: 0.2 }).map((match) => match.chunk.id);
};

export const validatePlan = (raw, chunks, { fallbackTitle, lessonLanguage = null, maxSteps = 8 }) => {
  const validIds = new Set(chunks.map((chunk) => chunk.id));
  const seenQuestions = new Set();
  const candidates = (Array.isArray(raw?.steps) ? raw.steps : [])
    .map((item, rawIndex) => ({
      rawIndex,
      rawPrerequisites: (Array.isArray(item?.prerequisites) ? item.prerequisites : []).map(Number).filter((number) => Number.isInteger(number)).map((number) => number - 1),
      rawSourceIds: item?.sourceIds,
      step: {
        title: text(item?.title, 120),
        goal: text(item?.goal, 400),
        keyConcepts: textList(item?.keyConcepts, 6, 80),
        approach: APPROACHES.has(item?.approach) ? item.approach : 'explain',
        checkQuestion: text(item?.checkQuestion, 400),
        successCriteria: text(item?.successCriteria, 400),
        commonMistake: text(item?.commonMistake, 300),
      },
    }))
    .filter(({ step }) => {
      const key = step.checkQuestion.toLowerCase();
      if (!step.title || !step.checkQuestion || seenQuestions.has(key)) return false;
      seenQuestions.add(key);
      return true;
    });

  const position = new Map(candidates.map((candidate, index) => [candidate.rawIndex, index]));
  const { order, brokenEdges } = orderByPrerequisites(candidates.length, (index) =>
    candidates[index].rawPrerequisites.map((rawIndex) => position.get(rawIndex)).filter((other) => other !== undefined));
  const kept = order.slice(0, maxSteps);
  const placeOf = new Map(kept.map((candidateIndex, index) => [candidateIndex, index]));

  const steps = kept.map((candidateIndex, index) => {
    const { step, rawSourceIds, rawPrerequisites } = candidates[candidateIndex];
    const id = `s${index + 1}`;
    return {
      id,
      ...step,
      goal: step.goal || step.title,
      successCriteria: step.successCriteria || step.goal || step.title,
      prerequisites: [...new Set(rawPrerequisites.map((other) => placeOf.get(position.get(other))).filter((place) => place !== undefined && place < index))].map((place) => `s${place + 1}`),
      sourceIds: stepSources(rawSourceIds, step, chunks, validIds),
    };
  });

  if (steps.length === 0) throw new AppError('bad_response', 'The AI did not return a usable lesson plan. Try again.');

  const code = lessonLanguage ?? languageCode(raw.languageCode);
  const minutes = Number(raw.durationMinutes);
  const ungrounded = steps.filter((step) => step.sourceIds.length === 0).length;
  const warnings = [];
  if (ungrounded > 0 && ungrounded >= steps.length / 2) warnings.push('mostly_ungrounded');
  else if (ungrounded > 0) warnings.push('some_ungrounded');
  if (brokenEdges.length) warnings.push('prerequisite_cycle');

  return {
    title: text(raw.title, 120, fallbackTitle),
    languageCode: code,
    direction: directionForLanguage(code),
    audience: text(raw.audience, 200, 'Student'),
    durationMinutes: Number.isFinite(minutes) ? Math.min(Math.max(Math.round(minutes), 3), 90) : 15,
    contentType: CONTENT_TYPES.has(raw.contentType) ? raw.contentType : 'mixed',
    style: text(raw.style, 300),
    objectives: textList(raw.objectives, 5, 200),
    steps,
    notes: text(raw.notes, 500),
    warnings,
  };
};

export const createLessonPlan = async ({ provider, teacherPrompt, document, lessonLanguage, signal, onMeta }) => {
  const documentChars = document.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) * (document.totalChunks / document.chunks.length);
  const maxSteps = maxStepsFor({ documentChars, minutes: minutesFromPrompt(teacherPrompt) });
  const raw = await provider.generateJson({
    task: 'plan',
    system: PLAN_SYSTEM,
    prompt: buildPlanPrompt({ teacherPrompt, document, lessonLanguage, maxSteps }),
    signal,
    onMeta,
  });
  const plan = validatePlan(raw, document.chunks, { fallbackTitle: document.name.replace(/\.[^.]+$/, ''), lessonLanguage, maxSteps });
  return { plan, progress: createProgress(plan) };
};
