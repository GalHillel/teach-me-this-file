import { LEVELS, activeStepIndex, reviewQueue, reviewSchedule, stepEvidence } from '../../shared/lesson.js';
import { findMessageSources } from './sources.js';

const IDLE_TURN = { status: 'idle', tutorId: null, studentId: null, pending: null, relatedIds: [] };

const NOTE_FOR_MOVE = {
  advance: 'step_done',
  review_and_advance: 'step_review',
  reveal_and_recheck: 'recheck',
  finish: 'lesson_done',
  review_and_finish: 'lesson_done_review',
};

const planNotice = (provider) => (provider?.backup ? { code: 'backup_model', model: provider.models.at(-1) } : null);

export const initChat = ({ plan, progress, document, provider, resume }) => ({
  plan,
  progress: resume?.progress ?? progress,
  chunks: document.chunks,
  messages: resume?.messages ?? [],
  turn: IDLE_TURN,
  failed: null,
  notice: resume ? resume.notice ?? null : planNotice(provider),
  restored: Boolean(resume),
});

const updateMessage = (messages, id, change) =>
  messages.map((message) => (message.id === id ? { ...message, ...change } : message));

const transitionNote = (move, previous, next, plan) => {
  if (move === 'review_next') {
    const index = activeStepIndex(previous);
    return { code: 'review_item', step: index + 1, result: next.review.results[index] };
  }
  if (move === 'review_finish') {
    const results = Object.values(next.review.results);
    return { code: 'review_done', passed: results.filter((result) => result === 'pass').length, total: next.review.queue.length };
  }
  if (move === 'final_check_start') return { code: 'final_start', total: next.review.queue.length };
  if (move === 'final_next') {
    const index = activeStepIndex(previous);
    return { code: 'final_item', step: index + 1, result: next.review.results[index] };
  }
  if (move === 'final_finish') {
    const results = Object.values(next.final.results);
    return { code: 'final_done', passed: results.filter((result) => result === 'pass').length, total: results.length };
  }
  if (move === 'finish_skipped') return { code: 'final_skipped' };
  if (move === 'prerequisite_check') {
    const detour = next.steps[next.currentStep].detour;
    return { code: 'detour', step: detour + 1, next: plan.steps[detour]?.title ?? '' };
  }
  if (move === 'resume' || move === 'resume_after_reteach') {
    const detour = previous.steps[previous.currentStep].detour;
    return { code: move === 'resume' ? 'detour_pass' : 'detour_fail', step: detour + 1, next: plan.steps[next.currentStep]?.title ?? '' };
  }
  const code = NOTE_FOR_MOVE[move];
  if (!code) return null;
  return { code, step: previous.currentStep + 1, next: plan.steps[next.currentStep]?.title ?? '' };
};

const citedSources = (citations, chunks) => {
  const ids = new Map(chunks.map((chunk) => [chunk.id.toLowerCase(), chunk.id]));
  return (citations?.cited ?? []).map((id) => ids.get(id)).filter(Boolean).slice(0, 3).map((chunkId) => ({ chunkId, kind: 'cited' }));
};

const sourceIdsOf = (plan, indexes) => [...new Set(indexes.flatMap((index) => plan.steps[index]?.sourceIds ?? []))];

const commitTurn = (state, citations = null) => {
  const { tutorId, studentId, pending } = state.turn;
  const progress = pending?.progress ?? state.progress;
  const tutor = state.messages.find((message) => message.id === tutorId);
  const before = activeStepIndex(state.progress);
  const stepIndex = activeStepIndex(progress);
  const cited = citedSources(citations, state.chunks);
  const sources = cited.length
    ? cited
    : findMessageSources(tutor.content, state.chunks, {
      candidateIds: [...sourceIdsOf(state.plan, [before, before + 1, stepIndex]), ...state.turn.relatedIds],
      stepIds: sourceIdsOf(state.plan, [stepIndex]),
    });

  let messages = updateMessage(state.messages, tutorId, {
    status: 'done',
    sources,
    stepIndex,
    move: pending?.move ?? null,
    intervention: pending?.intervention ?? null,
    citations: citations ? { cited: citations.cited ?? [], quotes: citations.quotes ?? [] } : null,
  });
  if (studentId && pending?.assessment) {
    messages = updateMessage(messages, studentId, { assessment: pending.assessment });
  }
  const note = pending ? transitionNote(pending.move, state.progress, progress, state.plan) : null;
  if (note) {
    const index = messages.findIndex((message) => message.id === tutorId);
    messages = [...messages.slice(0, index), { id: `${tutorId}-note`, role: 'system', note }, ...messages.slice(index)];
  }

  return { ...state, progress, messages, turn: IDLE_TURN };
};

const endInterruptedTurn = (state, failed) => {
  const tutor = state.messages.find((message) => message.id === state.turn.tutorId);
  const keep = tutor?.content && failed?.code !== 'unsafe_output';
  const messages = keep
    ? updateMessage(state.messages, tutor.id, { status: 'stopped' })
    : state.messages.filter((message) => message.id !== state.turn.tutorId);
  return { ...state, messages, turn: IDLE_TURN, failed };
};

const TURN_EVENTS = new Set(['phase', 'progress', 'notice', 'delta', 'done', 'stopped', 'failed']);

const belongsToTurn = (state, action) =>
  state.turn.status !== 'idle' && (!action.tutorId || action.tutorId === state.turn.tutorId);

export const chatReducer = (state, action) => {
  if (TURN_EVENTS.has(action.type) && !belongsToTurn(state, action)) return state;
  switch (action.type) {
    case 'turn_started': {
      if (state.turn.status !== 'idle') return state;
      const messages = [...state.messages];
      if (action.student) messages.push({ id: action.student.id, role: 'student', content: action.student.content, ...(action.student.request ? { request: action.student.request } : {}) });
      messages.push({ id: action.tutorId, role: 'tutor', content: '', status: 'pending', sources: [] });
      return {
        ...state,
        messages,
        failed: null,
        restored: false,
        turn: { status: 'waiting', tutorId: action.tutorId, studentId: action.student?.id ?? action.studentId ?? null, pending: null, relatedIds: action.relatedIds ?? [] },
      };
    }
    case 'phase':
      return { ...state, turn: { ...state.turn, status: action.phase } };
    case 'progress':
      return { ...state, turn: { ...state.turn, pending: { move: action.move, progress: action.progress, assessment: action.assessment ?? null, intervention: action.intervention ?? null } } };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'delta': {
      const tutor = state.messages.find((message) => message.id === state.turn.tutorId);
      return {
        ...state,
        turn: { ...state.turn, status: 'teaching' },
        messages: updateMessage(state.messages, tutor.id, { content: tutor.content + action.text, status: 'streaming' }),
      };
    }
    case 'done':
      return commitTurn(state, action.citations ?? null);
    case 'stopped':
      return endInterruptedTurn(state, null);
    case 'failed':
      return endInterruptedTurn(state, action.failed);
    case 'dismiss_error':
      return { ...state, failed: null };
    case 'dismiss_notice':
      return { ...state, notice: null };
    case 'dismiss_restored':
      return { ...state, restored: false };
    default:
      return state;
  }
};

export const savedChat = (state) => ({ progress: state.progress, messages: state.messages, notice: state.notice });

export const historyFor = (messages, excludeId) =>
  messages
    .filter((message) => message.id !== excludeId && message.content)
    .filter((message) => message.role === 'student' || (message.role === 'tutor' && message.status === 'done'))
    .map((message) => ({ role: message.role, content: message.content }))
    .slice(-20);

export const lessonSummary = (plan, progress) => {
  const steps = plan.steps.map((step, index) => ({ index, title: step.title, ...stepEvidence(progress, index) }));
  const groups = Object.fromEntries(LEVELS.map((level) => [level, steps.filter((step) => step.level === level)]));
  const finalResults = Object.values(progress.final?.results ?? {});
  const practising = progress.review?.kind === 'practice';
  const practice = practising ? progress.review.queue : reviewQueue(progress);
  return {
    steps,
    groups,
    final: progress.final
      ? { skipped: progress.final.skipped, passed: finalResults.filter((result) => result === 'pass').length, total: finalResults.length }
      : null,
    practice: practice.map((index) => ({ index, title: plan.steps[index].title, result: practising ? progress.review.results[index] ?? null : null })),
    practiced: practising && progress.status === 'completed',
    schedule: reviewSchedule(progress).map((item) => ({ ...item, title: plan.steps[item.index].title })),
    total: plan.steps.length,
  };
};
