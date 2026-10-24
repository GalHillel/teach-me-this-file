import { useCallback, useEffect, useReducer, useRef } from 'react';
import { streamTurn } from '../api/client.js';
import { chatReducer, historyFor, initChat, savedChat } from './chatReducer.js';
import { activeStepIndex, reviewQueue } from '../../shared/lesson.js';
import { chunksById, findRelatedPassages } from './sources.js';
import { saveChat, saveLesson } from './storage.js';

let nextId = 0;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(nextId += 1)}`;

const stepSources = (state, index) => {
  const step = index === undefined ? null : state.plan.steps[index];
  return step ? chunksById(state.chunks, step.sourceIds) : [];
};

const REQUESTS = new Set(['hint', 'explain', 'skip_final']);

const stepsForTurn = (progress, kind) => {
  if (kind === 'review') return reviewQueue(progress).slice(0, 2);
  if (progress.status === 'reviewing') {
    const { queue, position } = progress.review;
    return [queue[position], queue[position + 1]];
  }
  const detour = progress.steps[progress.currentStep]?.detour;
  if (Number.isInteger(detour)) return [detour, progress.currentStep];
  return [activeStepIndex(progress), progress.currentStep + 1];
};

export const useTutor = ({ lesson, settings }) => {
  const [state, dispatch] = useReducer(chatReducer, lesson, initChat);
  const stateRef = useRef(state);
  const controllerRef = useRef(null);

  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    saveLesson(lesson);
  }, [lesson]);

  const idle = state.turn.status === 'idle';
  useEffect(() => {
    if (idle && state.messages.length > 0) saveChat(lesson.id, savedChat(state));
  }, [idle, lesson.id, state]);

  const runTurn = useCallback(
    async ({ kind, studentMessage = '', retryStudentId = null }) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;

      const current = stateRef.current;
      const asks = kind === 'reply' || REQUESTS.has(kind);
      const student = asks && !retryStudentId && studentMessage
        ? { id: newId('student'), content: studentMessage, ...(REQUESTS.has(kind) ? { request: kind } : {}) }
        : null;
      const studentId = student?.id ?? retryStudentId;
      const history = historyFor(current.messages, studentId);
      const tutorId = newId('tutor');
      const [currentIndex, nextIndex] = stepsForTurn(current.progress, kind);
      const currentSources = stepSources(current, currentIndex);
      const nextSources = stepSources(current, nextIndex);
      const related = kind === 'reply'
        ? findRelatedPassages(studentMessage, current.chunks, { exclude: [...currentSources, ...nextSources].map((chunk) => chunk.id) })
        : [];
      dispatch({ type: 'turn_started', tutorId, student, studentId, relatedIds: related.map((chunk) => chunk.id) });

      try {
        await streamTurn({
          settings,
          signal: controller.signal,
          body: {
            kind,
            teacherPrompt: lesson.teacherPrompt,
            plan: current.plan,
            progress: current.progress,
            history,
            studentMessage: kind === 'reply' ? studentMessage : '',
            sources: { current: currentSources, next: nextSources, related },
          },
          onEvent: (event, data) => {
            if (event === 'status') dispatch({ type: 'phase', phase: data.phase, tutorId });
            if (event === 'progress') dispatch({ type: 'progress', ...data, tutorId });
            if (event === 'done') dispatch({ type: 'done', citations: data.citations ?? null, tutorId });
            if (event === 'notice') dispatch({ type: 'notice', notice: data, tutorId });
            if (event === 'delta') dispatch({ type: 'delta', text: data.text, tutorId });
          },
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          dispatch({ type: 'stopped', tutorId });
        } else {
          dispatch({ type: 'failed', tutorId, failed: { kind, studentMessage, studentId, code: error.code, message: error.message, retryable: error.retryable !== false } });
        }
      } finally {
        controllerRef.current = null;
      }
    },
    [lesson.teacherPrompt, settings],
  );

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  const send = useCallback((text) => runTurn({ kind: 'reply', studentMessage: text }), [runTurn]);

  const retry = useCallback(() => {
    const { failed } = stateRef.current;
    if (failed) runTurn({ kind: failed.kind, studentMessage: failed.studentMessage, retryStudentId: failed.studentId });
  }, [runTurn]);

  const review = useCallback(() => runTurn({ kind: 'review' }), [runTurn]);
  const ask = useCallback((kind, label) => runTurn({ kind, studentMessage: label }), [runTurn]);
  const dismissError = useCallback(() => dispatch({ type: 'dismiss_error' }), []);
  const dismissNotice = useCallback(() => dispatch({ type: 'dismiss_notice' }), []);
  const dismissRestored = useCallback(() => dispatch({ type: 'dismiss_restored' }), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (stateRef.current.messages.length === 0) runTurn({ kind: 'start' });
    }, 0);
    return () => clearTimeout(timer);
  }, [runTurn]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, busy: state.turn.status !== 'idle', send, stop, retry, review, ask, dismissError, dismissNotice, dismissRestored };
};
