import { mkdirSync, writeFileSync } from 'node:fs';
import { assessAnswer } from '../server/lesson/assessor.js';
import { runTurn, toProviderMessages } from '../server/lesson/tutor.js';
import { resolveProvider } from '../server/providers/index.js';
import { turnSources } from '../src/lesson/turnSources.js';
import {
  ACTION_OF_MOVE, checkEnd, supportProblems, checkTurn, citationSupport, labelGrade, loadLessons, loadScenarios, openingMessage,
  planOf, plainSystem, policyRun, readTag, startProgress, summarize, verifyReply,
} from './teaching-lib.js';

const arg = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const mode = arg('mode', 'policy');
const split = arg('split', 'dev');
const systems = arg('systems', mode === 'policy' ? 'engine,naive' : 'engine').split(',');
const providerName = arg('provider', process.env.EVAL_PROVIDER || '');
const label = arg('label', `${mode}-${split}`);
const only = arg('only', '') ? arg('only', '').split(',') : null;
const pauseMs = Number(process.env.EVAL_PAUSE_MS || (providerName === 'labels' ? 0 : 4500));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lessons = loadLessons();
const { scenarios } = loadScenarios();
const selected = scenarios.filter((item) => (split === 'all' || item.split === split) && (!only || only.includes(item.id)));

let currentLabel = null;
const labelProvider = {
  name: 'labels',
  model: 'labels',
  async generateJson({ onMeta }) {
    onMeta?.({ model: 'labels', backup: false });
    return labelGrade(currentLabel);
  },
  async *streamText({ system, onMeta }) {
    onMeta?.({ model: 'labels', backup: false });
    const id = system.match(/^\[(c\d+) \|/m)?.[1];
    yield `Canned reply${id ? ` [${id}]` : ''}. What do you think?`;
  },
};

const provider = mode === 'policy' ? { name: 'none', model: null } : providerName === 'labels' ? labelProvider : resolveProvider({ apiKey: process.env.EVAL_API_KEY || '', provider: providerName }).provider;

let calls = 0;
let stopped = null;

const withRetry = async (work) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (error.code === 'quota_exhausted') {
        stopped = 'quota_exhausted';
        throw error;
      }
      if (attempt === 2 || !['rate_limited', 'provider_unavailable', 'timeout', 'bad_response'].includes(error.code)) throw error;
      console.log(`retry after ${error.code}`);
      await wait(error.code === 'rate_limited' ? 30000 : 8000);
    }
  }
  return null;
};

const engineTurn = async ({ lesson, plan, progress, history, turn }) => {
  const kind = turn.kind ?? 'reply';
  const sources = turnSources({ plan, chunks: lesson.chunks, progress }, kind, turn.student);
  currentLabel = turn.label;
  const events = [];
  await withRetry(async () => {
    events.length = 0;
    await runTurn({
      provider,
      input: { kind, plan, teacherPrompt: lesson.teacherPrompt, progress, history, studentMessage: kind === 'reply' ? turn.student : '', sources },
      send: (event, data) => events.push({ event, data }),
    });
  });
  calls += kind === 'reply' ? 2 : 1;
  const update = events.find((item) => item.event === 'progress').data;
  const done = events.find((item) => item.event === 'done').data;
  const text = events.filter((item) => item.event === 'delta').map((item) => item.data.text).join('');
  const given = [...new Map([...sources.current, ...sources.next, ...sources.upcoming, ...sources.related].map((chunk) => [chunk.id, chunk])).values()];
  return {
    move: update.move,
    action: ACTION_OF_MOVE[update.move] ?? 'other',
    intervention: update.intervention,
    verdict: update.assessment?.verdict ?? null,
    issue: update.assessment?.issue ?? null,
    misconception: update.assessment?.misconception ?? '',
    progress: update.progress,
    text,
    citations: done.citations,
    support: citationSupport(text, given),
    models: done.models,
  };
};

const plainTurn = async ({ lesson, plan, scenario, history, turn }) => {
  const system = plainSystem({ lesson, plan, scenario });
  let reply = '';
  await withRetry(async () => {
    reply = '';
    for await (const text of provider.streamText({ system, messages: toProviderMessages(history, turn.student) })) reply += text;
  });
  calls += 1;
  const tag = readTag(reply);
  return {
    move: tag.action,
    action: tag.action ?? 'other',
    intervention: null,
    verdict: tag.judgement === 'none' ? null : tag.judgement,
    issue: null,
    misconception: '',
    text: tag.text,
    tagMissing: !tag.action,
    citations: verifyReply(tag.text, lesson.chunks),
    support: citationSupport(tag.text, lesson.chunks),
  };
};

const gradeVariant = async ({ lesson, plan, scenario, student, system }) => {
  const turn = { student, label: scenario.label };
  const history = [{ role: 'tutor', content: openingMessage(plan, scenario.at ?? 0) }];
  if (system === 'plain') return plainTurn({ lesson, plan, scenario, history, turn });
  const progress = startProgress(plan, scenario);
  const sources = turnSources({ plan, chunks: lesson.chunks, progress }, 'reply', student);
  currentLabel = scenario.label;
  const assessment = await withRetry(() => assessAnswer({ provider, plan, progress, tutorQuestion: history[0].content, studentMessage: student, sources: sources.current }));
  calls += 1;
  return { verdict: assessment.verdict, issue: assessment.issue };
};

const modelScenario = async (scenario, system) => {
  const lesson = lessons[scenario.lesson];
  const plan = planOf(lesson);
  if (scenario.variants) {
    const verdicts = [];
    for (const student of scenario.variants) {
      const row = await gradeVariant({ lesson, plan, scenario, student, system });
      verdicts.push(row.verdict);
      await wait(pauseMs);
    }
    const consistent = new Set(verdicts).size === 1 && verdicts[0] === scenario.label.verdict;
    return { id: scenario.id, category: scenario.category, variants: scenario.variants.length, verdicts, consistent, passed: consistent, turns: [] };
  }
  let progress = startProgress(plan, scenario);
  const history = [{ role: 'tutor', content: openingMessage(plan, scenario.at ?? 0) }];
  const rows = [];
  let previousHelp = null;
  for (const turn of scenario.turns) {
    const row = system === 'plain'
      ? await plainTurn({ lesson, plan, scenario, history, turn })
      : await engineTurn({ lesson, plan, progress, history, turn });
    row.step = progress.status === 'active' ? progress.currentStep : null;
    if (row.progress) progress = row.progress;
    row.failures = checkTurn({ turn, row, mode, previousHelp });
    previousHelp = ['hint', 'explain', 'probe'].includes(row.action) ? row.text : null;
    history.push({ role: 'student', content: turn.student }, { role: 'tutor', content: row.text });
    rows.push({ turn, ...row });
    console.log(`${row.failures.length ? 'FAIL' : 'ok  '} ${system} ${scenario.id} ${row.verdict ?? '-'} ${row.action}${row.intervention ? `/${row.intervention}` : ''}${row.failures.length ? ` (${row.failures.join('; ')})` : ''}`);
    await wait(pauseMs);
  }
  const endFailures = system === 'engine' ? checkEnd(scenario, system, progress) : null;
  const support = system === 'engine' ? supportProblems(rows) : null;
  return { id: scenario.id, category: scenario.category, turns: rows, endFailures, supportProblems: support, passed: rows.every((row) => !row.failures.length) && !(endFailures ?? []).length && !(support ?? []).length };
};

const policyScenario = (scenario, system) => {
  if (scenario.variants) return null;
  const lesson = lessons[scenario.lesson];
  const { progress, turns } = policyRun(lesson, scenario, system);
  const rows = turns.map(({ turn, assessment, move, action, intervention, step }) => {
    const row = { turn, move, action, intervention, step, verdict: assessment.verdict, issue: assessment.issue, misconception: assessment.misconception };
    row.failures = checkTurn({ turn, row, mode: 'policy' });
    return row;
  });
  const endFailures = checkEnd(scenario, system, progress);
  const support = system === 'engine' ? supportProblems(rows) : null;
  return { id: scenario.id, category: scenario.category, turns: rows, endFailures, supportProblems: support, passed: rows.every((row) => !row.failures.length) && !endFailures.length && !(support ?? []).length };
};

const results = {};
for (const system of systems) {
  const runs = [];
  for (const scenario of selected) {
    if (stopped) break;
    try {
      const run = mode === 'policy' ? policyScenario(scenario, system) : await modelScenario(scenario, system);
      if (run) runs.push(run);
    } catch (error) {
      console.log(`ERR  ${system} ${scenario.id} ${error.code ?? error.message}`);
      runs.push({ id: scenario.id, category: scenario.category, error: error.code ?? error.message, turns: [], passed: false });
    }
  }
  results[system] = { summary: summarize(runs.filter((run) => !run.error)), errors: runs.filter((run) => run.error).map((run) => ({ id: run.id, error: run.error })), runs };
  console.log(`${system}: ${JSON.stringify({ ...results[system].summary, failures: results[system].summary.failures.length })}`);
}

if (arg('out', '') === 'none') process.exit(Object.values(results).some((value) => value.errors.length) ? 1 : 0);
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/teaching-${label}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify({ label, mode, split, provider: provider.name, model: provider.model ?? null, date: new Date().toISOString(), calls, stopped, systems: Object.fromEntries(Object.entries(results).map(([system, value]) => [system, { summary: value.summary, errors: value.errors, runs: value.runs.map((run) => ({ ...run, turns: run.turns.map(({ turn, ...row }) => ({ student: turn.student, ...row, progress: undefined })) })) }])) }, null, 2)}\n`);
console.log(`saved ${file.pathname}${stopped ? ` (stopped: ${stopped})` : ''}`);
