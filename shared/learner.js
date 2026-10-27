export const STATES = ['not_assessed', 'emerging', 'developing', 'demonstrated', 'needs_review'];
export const QUESTIONS = ['check', 'narrowed', 'detour', 'transfer', 'practice'];
export const SUPPORTS = ['independent', 'hinted', 'narrowed', 'worked', 'reminded'];
export const EVIDENCE_LIMIT = 60;

const QUALIFIED = new Set(['copied', 'hedged', 'unjustified']);
const LATER = new Set(['transfer', 'practice', 'detour']);
const MOVED_PAST = new Set(['developing', 'demonstrated', 'needs_review']);
const OWN_QUESTION = new Set(['check', 'narrowed']);

const OUTCOME_ENTRY = {
  mastered: { support: 'independent', verdict: 'correct' },
  learned: { support: 'hinted', verdict: 'correct' },
  recovered: { support: 'worked', verdict: 'correct' },
  review: { support: 'worked', verdict: 'incorrect' },
};

const checkResult = (progress, index, kind) => {
  if (kind === 'final' && progress.final?.results?.[index]) return progress.final.results[index];
  return progress.review?.kind === kind ? progress.review.results?.[index] ?? null : null;
};

const fromOutcome = (step) => (OUTCOME_ENTRY[step.outcome] ? [{ question: 'check', ...OUTCOME_ENTRY[step.outcome], derived: true }] : []);

const fromStepFields = (progress, index) => {
  const step = progress.steps[index];
  const entries = fromOutcome(step);
  if (step.revisit) entries.push({ gap: true, derived: true }, { question: 'detour', support: 'reminded', verdict: step.revisit === 'pass' ? 'correct' : 'incorrect', derived: true });
  for (const kind of ['final', 'practice']) {
    const outcome = checkResult(progress, index, kind);
    if (outcome) entries.push({ question: kind === 'final' ? 'transfer' : 'practice', support: 'independent', verdict: outcome === 'pass' ? 'correct' : 'incorrect', derived: true });
  }
  return entries;
};

export const entriesFor = (progress, index) => {
  if (!Array.isArray(progress.evidence)) return fromStepFields(progress, index);
  const logged = progress.evidence.filter((entry) => entry.step === index);
  const seeded = Boolean(progress.steps[index].outcome) && !logged.some((entry) => OWN_QUESTION.has(entry.question));
  return seeded ? [...fromOutcome(progress.steps[index]), ...logged] : logged;
};

const qualified = (entry) => QUALIFIED.has(entry.issue);
const independentRight = (entry) => entry.verdict === 'correct' && entry.support === 'independent' && !qualified(entry);
const assistedRight = (entry) => entry.verdict === 'correct' && entry.support !== 'independent' && !qualified(entry);

const transition = (state, entry) => {
  if (entry.gap) return state === 'not_assessed' ? state : ['needs_review', 'later_gap'];
  if (entry.verdict === 'correct') {
    if (qualified(entry)) return state === 'not_assessed' ? ['emerging', `${entry.issue}_answer`] : state;
    if (entry.support === 'independent') return ['demonstrated', LATER.has(entry.question) ? `independent_${entry.question}` : 'independent_answer'];
    return ['demonstrated', 'needs_review'].includes(state) ? state : ['developing', `${entry.support}_answer`];
  }
  if (LATER.has(entry.question) && MOVED_PAST.has(state)) return ['needs_review', `missed_${entry.question}`];
  if (entry.support === 'worked' && OWN_QUESTION.has(entry.question)) return ['emerging', 'wrong_after_explanation'];
  if (entry.misconception) return state === 'needs_review' ? state : ['developing', 'misconception'];
  return ['developing', 'needs_review'].includes(state) ? state : ['emerging', entry.verdict === 'partial' ? 'partial_answer' : 'wrong_answer'];
};

const confidenceOf = (state, entries) => {
  if (state === 'not_assessed') return null;
  const independent = entries.filter(independentRight);
  if (state === 'demonstrated') {
    const missed = entries.some((entry) => entry.gap || (LATER.has(entry.question) && entry.verdict !== 'correct'));
    return !missed && (independent.some((entry) => LATER.has(entry.question)) || independent.length >= 2) ? 'high' : 'medium';
  }
  return entries.filter((entry) => !entry.gap).length >= 2 ? 'medium' : 'low';
};

export const stepState = (progress, index) => {
  const entries = entriesFor(progress, index);
  let state = 'not_assessed';
  let basis = 'no_answers';
  for (const entry of entries) {
    const next = transition(state, entry);
    if (Array.isArray(next)) [state, basis] = next;
  }
  return {
    state,
    basis,
    confidence: confidenceOf(state, entries),
    independent: entries.some(independentRight),
    assisted: entries.some(assistedRight),
    worked: entries.some((entry) => entry.support === 'worked'),
    gap: entries.some((entry) => entry.gap),
    transfer: entries.some((entry) => independentRight(entry) && ['transfer', 'practice'].includes(entry.question)),
    misconceptions: [...new Set(entries.map((entry) => entry.misconception).filter(Boolean))],
    evidence: entries.filter((entry) => !entry.derived).map((entry) => entry.n),
  };
};

export const learnerModel = (plan, progress) => plan.steps.map((step, index) => ({
  index,
  title: step.title,
  prerequisites: (step.prerequisites ?? []).map((id) => plan.steps.findIndex((item) => item.id === id)).filter((position) => position >= 0),
  ...stepState(progress, index),
}));

export const misconceptionsShown = (progress) => {
  const seen = {};
  for (const entry of progress.evidence ?? []) {
    if (!entry.misconception) continue;
    const list = seen[entry.step] ?? [];
    if (!list.includes(entry.misconception) && list.length < 3) seen[entry.step] = [...list, entry.misconception];
  }
  return seen;
};
