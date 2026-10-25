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

const WEAK_OUTCOMES = new Set(['recovered', 'review']);

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

  const weak = candidates.filter((index) => WEAK_OUTCOMES.has(progress.steps[index].outcome));
  if (weak.length && state.attempts >= 1) return { index: weak[weak.length - 1], reason: 'weak_prerequisite' };
  return null;
};

const firstUnused = (ladder, used) => ladder.find((item) => !used.includes(item)) ?? ladder[ladder.length - 1];

export const chooseIntervention = ({ situation, assessment, state }) => {
  const used = state.used ?? [];
  if (situation === 'wrong') {
    if (assessment?.issue === 'no_knowledge') return firstUnused(LADDERS.no_knowledge, used);
    if (assessment?.misconception) return firstUnused(LADDERS.misconception, used);
    return firstUnused(state.attempts >= 2 ? LADDERS.second_wrong : LADDERS.first_wrong, used);
  }
  if (situation === 'hint_request') return firstUnused(LADDERS.hint_request, used);
  if (situation === 'explain_request') return firstUnused(LADDERS.explain_request, used);
  return null;
};

export const remember = (used, intervention) => {
  if (!intervention) return used ?? [];
  const next = [...(used ?? []), intervention];
  const detoured = next.includes('prerequisite');
  const rest = next.filter((item) => item !== 'prerequisite').slice(detoured ? -7 : -8);
  return detoured ? ['prerequisite', ...rest] : rest;
};
