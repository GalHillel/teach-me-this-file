import { AppError } from '../errors.js';
import { assessAnswer } from './assessor.js';
import { lessonPace, planMove, stepsToReview } from './progress.js';
import { buildTutorSystem } from './prompts.js';

const HISTORY_LIMIT = 12;

export const toProviderMessages = (history, studentMessage) => {
  const recent = history.slice(-HISTORY_LIMIT).map((message) => ({
    role: message.role === 'tutor' ? 'assistant' : 'user',
    content: message.content,
  }));
  const all = [{ role: 'user', content: 'Start the lesson.' }, ...recent];
  if (studentMessage) all.push({ role: 'user', content: studentMessage });

  return all.reduce((merged, message) => {
    const last = merged.at(-1);
    if (last?.role === message.role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      merged.push({ ...message });
    }
    return merged;
  }, []);
};

const lastTutorMessage = (history) => [...history].reverse().find((message) => message.role === 'tutor')?.content ?? '';

export const runTurn = async ({ provider, input, signal, send }) => {
  const { kind, plan, teacherPrompt, history, studentMessage, sources } = input;

  let assessment = null;
  if (kind === 'reply' && input.progress.status === 'active') {
    send('status', { phase: 'assessing' });
    assessment = await assessAnswer({
      provider,
      plan,
      progress: input.progress,
      tutorQuestion: lastTutorMessage(history),
      studentMessage,
      sources: sources.current,
      signal,
    });
  }

  const { move, progress } = planMove(input.progress, { kind, verdict: assessment?.verdict });
  send('progress', { move, progress, verdict: assessment?.verdict ?? null });
  send('status', { phase: 'teaching' });

  const system = buildTutorSystem({
    plan,
    progress,
    teacherPrompt,
    sources: [...sources.current, ...sources.next],
    move,
    assessment,
    pace: lessonPace(progress),
    reviewTitles: stepsToReview(plan, progress),
  });

  let reply = '';
  for await (const text of provider.streamText({ system, messages: toProviderMessages(history, studentMessage), signal })) {
    reply += text;
    send('delta', { text });
  }
  if (!reply.trim()) throw new AppError('bad_response', 'The AI returned an empty answer. Try again.');
  send('done', {});
};
