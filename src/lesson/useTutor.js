import { useCallback, useEffect, useReducer, useRef } from 'react';
import { streamTurn } from '../api/client.js';
import { chatReducer, historyFor, initChat } from './chatReducer.js';
import { chunksById } from './sources.js';

let nextId = 0;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(nextId += 1)}`;

const stepSources = (state, index) => {
  const step = state.plan.steps[index];
  return step ? chunksById(state.chunks, step.sourceIds) : [];
};

export const useTutor = ({ lesson, settings }) => {
  const [state, dispatch] = useReducer(chatReducer, lesson, initChat);
  const stateRef = useRef(state);
  const controllerRef = useRef(null);

  useEffect(() => {
    stateRef.current = state;
  });

  const runTurn = useCallback(
    async ({ kind, studentMessage = '', retryStudentId = null }) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;

      const current = stateRef.current;
      const student = kind === 'reply' && !retryStudentId ? { id: newId('student'), content: studentMessage } : null;
      const studentId = student?.id ?? retryStudentId;
      const history = historyFor(current.messages, studentId);
      dispatch({ type: 'turn_started', tutorId: newId('tutor'), student, studentId });

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
            studentMessage,
            sources: {
              current: stepSources(current, current.progress.currentStep),
              next: stepSources(current, current.progress.currentStep + 1),
            },
          },
          onEvent: (event, data) => {
            if (event === 'status') dispatch({ type: 'phase', phase: data.phase });
            if (event === 'progress') dispatch({ type: 'progress', ...data });
            if (event === 'delta') dispatch({ type: 'delta', text: data.text });
            if (event === 'done') dispatch({ type: 'done' });
          },
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          dispatch({ type: 'stopped' });
        } else {
          dispatch({ type: 'failed', failed: { kind, studentMessage, studentId, code: error.code, message: error.message, retryable: error.retryable } });
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

  const dismissError = useCallback(() => dispatch({ type: 'dismiss_error' }), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (stateRef.current.messages.length === 0) runTurn({ kind: 'start' });
    }, 0);
    return () => clearTimeout(timer);
  }, [runTurn]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, busy: state.turn.status !== 'idle', send, stop, retry, dismissError };
};
