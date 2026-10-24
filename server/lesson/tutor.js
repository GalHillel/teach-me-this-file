import { randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';
import { count } from '../metrics.js';
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

export const publicAssessment = (assessment) =>
  assessment ? { verdict: assessment.verdict, confidence: assessment.confidence, issue: assessment.issue, checks: assessment.checks } : null;

export const newCanary = () => `tmtf-${randomBytes(6).toString('hex')}`;

const CANARY_PROBE = 9;

export const guardStream = (canary, send) => {
  let reply = '';
  let sent = 0;
  const probe = canary.slice(0, CANARY_PROBE);
  const holdBack = probe.length - 1;
  return {
    push(text) {
      reply += text;
      if (reply.includes(probe)) throw new AppError('unsafe_output');
      const safeEnd = Math.max(sent, reply.length - holdBack);
      if (safeEnd > sent) {
        send(reply.slice(sent, safeEnd));
        sent = safeEnd;
      }
    },
    flush() {
      if (reply.length > sent) send(reply.slice(sent));
      sent = reply.length;
      return reply;
    },
  };
};

export const runTurn = async ({ provider, input, signal, send }) => {
  const { kind, plan, teacherPrompt, history, studentMessage, sources } = input;
  const started = Date.now();
  const models = [];
  let warnedBackup = false;
  const onMeta = (meta) => {
    models.push(meta.model);
    if (meta.backup && !warnedBackup) {
      warnedBackup = true;
      send('notice', { code: 'backup_model', model: meta.model });
    }
  };

  let assessment = null;
  if (kind === 'reply' && input.progress.status !== 'completed') {
    send('status', { phase: 'assessing' });
    assessment = await assessAnswer({
      provider,
      plan,
      progress: input.progress,
      tutorQuestion: lastTutorMessage(history),
      studentMessage,
      sources: sources.current,
      signal,
      onMeta,
    });
  }

  const { move, progress } = planMove(input.progress, { kind, assessment });
  send('progress', { move, progress, assessment: publicAssessment(assessment) });
  send('status', { phase: 'teaching' });

  const canary = newCanary();
  const system = buildTutorSystem({
    plan,
    progress,
    teacherPrompt,
    sources: [...sources.current, ...sources.next],
    relatedSources: sources.related,
    canary,
    move,
    assessment,
    pace: lessonPace(progress),
    reviewTitles: stepsToReview(plan, progress),
  });

  let firstTokenMs = null;
  const guard = guardStream(canary, (text) => {
    if (firstTokenMs === null) firstTokenMs = Date.now() - started;
    send('delta', { text });
  });
  for await (const text of provider.streamText({ system, messages: toProviderMessages(history, studentMessage), signal, onMeta })) {
    guard.push(text);
  }
  const reply = guard.flush();
  if (!reply.trim()) throw new AppError('bad_response', 'The AI returned an empty answer. Try again.');

  const totalMs = Date.now() - started;
  count('turns');
  if (firstTokenMs !== null) {
    count('firstTokenMs', firstTokenMs);
    count('firstTokenCount');
  }
  console.log(`turn ${kind} move=${move} verdict=${assessment?.verdict ?? '-'} first=${firstTokenMs}ms total=${totalMs}ms models=${models.join(',')}`);
  send('done', { move, models, backup: warnedBackup, firstTokenMs, totalMs });
};
