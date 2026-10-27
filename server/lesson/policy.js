import { stepState } from '../../shared/learner.js';

export const INTERVENTIONS = [
  'nudge',
  'focused_hint',
  'counterexample',
  'decompose',
  'worked_example',
  'analogy',
  'prerequisite',
  'rephrase',
  'guided_solution',
];

const LADDERS = {
  first_wrong: ['nudge', 'focused_hint', 'decompose'],
  second_wrong: ['focused_hint', 'decompose', 'worked_example'],
  misconception: ['counterexample', 'focused_hint', 'decompose'],
  no_knowledge: ['worked_example', 'analogy', 'decompose'],
  hint_request: ['nudge', 'focused_hint', 'decompose', 'worked_example'],
  explain_request: ['analogy', 'worked_example', 'decompose'],
};

export const NARROWING = new Set(['decompose', 'analogy', 'counterexample']);
export const NARROWS_QUESTION = new Set([...NARROWING, 'focused_hint']);

const fragileAfter = (model) => {
  if (model.state === 'needs_review' || (['developing', 'emerging'].includes(model.state) && model.worked)) return 1;
  if (['developing', 'emerging'].includes(model.state)) return 2;
  return Infinity;
};

export const findPrerequisiteGap = ({ plan, progress, stepIndex, assessment }) => {
  const step = plan.steps[stepIndex];
  const state = progress.steps[stepIndex];
  if (!step?.prerequisites?.length || state.used?.includes('prerequisite')) return null;
  const candidates = step.prerequisites
    .map((id) => plan.steps.findIndex((item) => item.id === id))
    .filter((index) => index >= 0 && index < stepIndex && progress.steps[index].status === 'done');
  if (!candidates.length) return null;

  const named = Number.isInteger(assessment?.missingPrerequisite) ? assessment.missingPrerequisite - 1 : -1;
  if (candidates.includes(named)) return { index: named, reason: 'grader' };

  const fragile = candidates.filter((index) => state.attempts >= fragileAfter(stepState(progress, index)));
  if (fragile.length) return { index: fragile[fragile.length - 1], reason: 'weak_prerequisite' };
  return null;
};

export const ladderOf = (situation, assessment, attempts = 0) => {
  if (situation !== 'wrong') return situation;
  if (assessment?.issue === 'no_knowledge') return 'no_knowledge';
  if (assessment?.misconception) return 'misconception';
  return attempts >= 2 ? 'second_wrong' : 'first_wrong';
};

const firstUnused = (ladder, used) => ladder.find((item) => !used.includes(item)) ?? ladder[ladder.length - 1];

export const chooseIntervention = ({ situation, assessment, state }) => {
  const used = state.used ?? [];
  const pick = (ladder) => firstUnused(state.built ? ladder.filter((item) => !NARROWING.has(item)) : ladder, used);
  return LADDERS[ladderOf(situation, assessment, state.attempts)] ? pick(LADDERS[ladderOf(situation, assessment, state.attempts)]) : null;
};

export const remember = (used, intervention) => {
  if (!intervention) return used ?? [];
  const next = [...(used ?? []), intervention];
  const detoured = next.includes('prerequisite');
  const rest = next.filter((item) => item !== 'prerequisite').slice(detoured ? -7 : -8);
  return detoured ? ['prerequisite', ...rest] : rest;
};
