import { findMessageSources } from './sources.js';

const IDLE_TURN = { status: 'idle', tutorId: null, studentId: null, pending: null };

export const VERDICT_LABELS = {
  correct: 'Correct',
  partial: 'Partly right',
  incorrect: 'Not yet',
  question: 'Question',
  off_topic: 'Off topic',
};

export const initChat = ({ plan, progress, document }) => ({
  plan,
  progress,
  chunks: document.chunks,
  messages: [],
  turn: IDLE_TURN,
  failed: null,
});

const updateMessage = (messages, id, change) =>
  messages.map((message) => (message.id === id ? { ...message, ...change } : message));

const transitionNote = (move, previous, next, plan) => {
  const done = previous.currentStep + 1;
  if (move === 'advance') return `Step ${done} done. Next: ${plan.steps[next.currentStep].title}`;
  if (move === 'reveal_and_advance') return `Step ${done}: the tutor showed the answer. Next: ${plan.steps[next.currentStep].title}`;
  if (move === 'finish' || move === 'reveal_and_finish') return 'All steps done. The lesson is complete.';
  return null;
};

const commitTurn = (state) => {
  const { tutorId, studentId, pending } = state.turn;
  const progress = pending?.progress ?? state.progress;
  const tutor = state.messages.find((message) => message.id === tutorId);
  const stepIndex = progress.currentStep;
  const sources = findMessageSources(tutor.content, state.chunks, state.plan.steps[stepIndex].sourceIds);

  let messages = updateMessage(state.messages, tutorId, { status: 'done', sources, stepIndex });
  if (studentId && pending?.verdict) {
    messages = updateMessage(messages, studentId, { verdict: pending.verdict });
  }
  const note = pending ? transitionNote(pending.move, state.progress, progress, state.plan) : null;
  if (note) {
    const index = messages.findIndex((message) => message.id === tutorId);
    messages = [...messages.slice(0, index), { id: `${tutorId}-note`, role: 'system', content: note }, ...messages.slice(index)];
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
        turn: { status: 'waiting', tutorId: action.tutorId, studentId: action.student?.id ?? action.studentId ?? null, pending: null },
      };
    }
    case 'phase':
      return { ...state, turn: { ...state.turn, status: action.phase } };
    case 'progress':
      return { ...state, turn: { ...state.turn, pending: { move: action.move, progress: action.progress, verdict: action.verdict } } };
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
    default:
      return state;
  }
};

export const historyFor = (messages, excludeId) =>
  messages
    .filter((message) => message.id !== excludeId && (message.role === 'tutor' || message.role === 'student') && message.content)
    .filter((message) => message.role === 'student' || message.status === 'done' || message.status === 'stopped')
    .map((message) => ({
      role: message.role,
      content: message.status === 'stopped' ? `${message.content} [message interrupted by the student]` : message.content,
    }))
    .slice(-20);
