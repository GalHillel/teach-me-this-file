import { findMessageSources } from './sources.js';

const IDLE_TURN = { status: 'idle', tutorId: null, studentId: null, pending: null };

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
  const code = NOTE_FOR_MOVE[move];
  if (!code) return null;
  return { code, step: previous.currentStep + 1, next: plan.steps[next.currentStep]?.title ?? '' };
};

const sourceIdsOf = (plan, indexes) => [...new Set(indexes.flatMap((index) => plan.steps[index]?.sourceIds ?? []))];

const commitTurn = (state) => {
  const { tutorId, studentId, pending } = state.turn;
  const progress = pending?.progress ?? state.progress;
  const tutor = state.messages.find((message) => message.id === tutorId);
  const before = state.progress.currentStep;
  const stepIndex = progress.currentStep;
  const sources = findMessageSources(tutor.content, state.chunks, {
    candidateIds: sourceIdsOf(state.plan, [before, before + 1]),
    stepIds: sourceIdsOf(state.plan, [stepIndex]),
  });

  let messages = updateMessage(state.messages, tutorId, { status: 'done', sources, stepIndex, move: pending?.move ?? null });
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
  const messages = tutor?.content
    ? updateMessage(state.messages, tutor.id, { status: 'stopped' })
    : state.messages.filter((message) => message.id !== state.turn.tutorId);
  return { ...state, messages, turn: IDLE_TURN, failed };
};

export const chatReducer = (state, action) => {
  switch (action.type) {
    case 'turn_started': {
      const messages = [...state.messages];
      if (action.student) messages.push({ id: action.student.id, role: 'student', content: action.student.content });
      messages.push({ id: action.tutorId, role: 'tutor', content: '', status: 'pending', sources: [] });
      return {
        ...state,
        messages,
        failed: null,
        restored: false,
        turn: { status: 'waiting', tutorId: action.tutorId, studentId: action.student?.id ?? action.studentId ?? null, pending: null },
      };
    }
    case 'phase':
      return { ...state, turn: { ...state.turn, status: action.phase } };
    case 'progress':
      return { ...state, turn: { ...state.turn, pending: { move: action.move, progress: action.progress, assessment: action.assessment ?? null } } };
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
      return commitTurn(state);
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
    .filter((message) => message.id !== excludeId && (message.role === 'tutor' || message.role === 'student') && message.content)
    .filter((message) => message.role === 'student' || message.status === 'done' || message.status === 'stopped')
    .map((message) => ({
      role: message.role,
      content: message.status === 'stopped' ? `${message.content} [message interrupted by the student]` : message.content,
    }))
    .slice(-20);

export const lessonSummary = (plan, progress) => {
  const counts = { mastered: 0, learned: 0, recovered: 0, review: 0 };
  const review = [];
  progress.steps.forEach((step, index) => {
    if (step.outcome) counts[step.outcome] += 1;
    if (step.outcome === 'recovered' || step.outcome === 'review') review.push(plan.steps[index].title);
  });
  return { counts, review, total: plan.steps.length };
};
