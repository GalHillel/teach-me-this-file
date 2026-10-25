import { randomBytes } from 'node:crypto';
import { stripCitations, verifyCitations } from '../../shared/citations.js';
import { AppError } from '../errors.js';
import { count, recordFirstToken } from '../metrics.js';
import { assessAnswer } from './assessor.js';
import { activeStepIndex, lessonPace, planMove } from './progress.js';
import { buildTutorSystem } from './prompts.js';

const HISTORY_LIMIT = 12;

export const toProviderMessages = (history, studentMessage) => {
  const recent = history.slice(-HISTORY_LIMIT).map((message) => ({
    role: message.role === 'tutor' ? 'assistant' : 'user',
    content: message.role === 'tutor' ? stripCitations(message.content, () => false).replace(/ +([.,;:!?])/g, '$1') : message.content,
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

const REQUEST_NOTES = {
  hint: '(The student pressed "Hint" and asks for a hint.)',
  explain: '(The student pressed "Explain differently" and asks for another explanation.)',
  skip_final: '(The student chose to skip the final check.)',
  review: '(The student chose to practise the steps that were hard.)',
};

const FINISHING_MOVES = new Set(['final_finish', 'review_finish', 'finish_skipped']);

export const pickSources = ({ plan, before, after, move, sources }) => {
  const pool = new Map([...sources.current, ...sources.next, ...sources.upcoming].map((chunk) => [chunk.id, chunk]));
  const focus = FINISHING_MOVES.has(move) ? activeStepIndex(before) : activeStepIndex(after);
  const detour = after.steps[activeStepIndex(after)]?.detour;
  const wanted = [focus, Number.isInteger(detour) ? detour : null, FINISHING_MOVES.has(move) ? null : focus + 1]
    .filter((index) => index !== null && plan.steps[index])
    .flatMap((index) => plan.steps[index].sourceIds ?? []);
  const picked = [...new Set(wanted)].map((id) => pool.get(id)).filter(Boolean);
  return picked.length ? picked : [...sources.current, ...sources.next];
};

const lastTutorMessage = (history) => [...history].reverse().find((message) => message.role === 'tutor')?.content ?? '';

export const publicAssessment = (assessment) =>
  assessment
    ? {
      verdict: assessment.verdict,
      confidence: assessment.confidence,
      issue: assessment.issue,
      checks: assessment.checks,
      conceptsShown: assessment.conceptsShown,
      conceptsMissing: assessment.conceptsMissing,
      misconception: assessment.misconception,
    }
    : null;

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
      related: sources.related,
      signal,
      onMeta,
    });
  }

  const { move, progress, intervention, prerequisite, requested } = planMove(input.progress, { kind, assessment, plan });
  const promptSources = pickSources({ plan, before: input.progress, after: progress, move, sources });
  send('progress', { move, progress, assessment: publicAssessment(assessment), intervention });
  send('status', { phase: 'teaching' });

  const canary = newCanary();
  const system = buildTutorSystem({
    plan,
    progress,
    teacherPrompt,
    sources: promptSources,
    stepIndex: FINISHING_MOVES.has(move) ? activeStepIndex(input.progress) : null,
    relatedSources: sources.related,
    canary,
    move,
    assessment,
    pace: lessonPace(progress),
    intervention,
    requested: Boolean(requested),
    prerequisite,
  });

  let firstTokenMs = null;
  const guard = guardStream(canary, (text) => {
    if (firstTokenMs === null) firstTokenMs = Date.now() - started;
    send('delta', { text });
  });
  const messages = toProviderMessages(history, studentMessage || REQUEST_NOTES[kind] || '');
  for await (const text of provider.streamText({ system, messages, signal, onMeta })) {
    guard.push(text);
  }
  const reply = guard.flush();
  if (!reply.trim()) throw new AppError('bad_response', 'The AI returned an empty answer. Try again.');

  const citations = verifyCitations(reply, [...promptSources, ...sources.related]);
  const totalMs = Date.now() - started;
  count('turns');
  if (firstTokenMs !== null) recordFirstToken(firstTokenMs);
  if (citations.cited.length) count('citedTurns');
  if (citations.invalid.length) count('invalidCitations', citations.invalid.length);
  console.log(`turn ${kind} move=${move}${intervention ? `/${intervention}` : ''} verdict=${assessment?.verdict ?? '-'} cited=${citations.cited.length} invalid=${citations.invalid.length} first=${firstTokenMs}ms total=${totalMs}ms models=${models.join(',')}`);
  send('done', { move, models, backup: warnedBackup, firstTokenMs, totalMs, citations });
};
