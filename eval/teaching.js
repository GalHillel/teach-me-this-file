import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessAnswer } from '../server/lesson/assessor.js';
import { runTurn, toProviderMessages } from '../server/lesson/tutor.js';
import { turnSources } from '../src/lesson/turnSources.js';
import {
  ACTION_OF_MOVE, checkEnd, endStates, supportProblems, checkTurn, citationSupport, labelGrade, wholeLabel, takeTurn, loadLessons, loadScenarios, openingMessage,
  planOf, plainSystem, policyRun, readTag, startProgress, summarize, turnApplies, verifyReply,
} from './teaching-lib.js';
import { evalProvider } from './remote-provider.js';
import { latestRuns, readRun, runMeta, sameVersion, summarizeRun, turnRecord } from './teaching-store.js';

const arg = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = (name) => process.argv.includes(`--${name}`);
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
  async generateJson({ task, onMeta }) {
    onMeta?.({ model: 'labels', backup: false });
    return labelGrade(task === 'assessment_whole' ? wholeLabel(currentLabel) : currentLabel);
  },
  async *streamText({ system, onMeta }) {
    onMeta?.({ model: 'labels', backup: false });
    const id = system.match(/^\[(c\d+) \|/m)?.[1];
    yield `Canned reply${id ? ` [${id}]` : ''}. What do you think?`;
  },
};

const provider = mode === 'policy' ? { name: 'none', model: null } : providerName === 'labels' ? labelProvider : await evalProvider({ name: providerName, apiKey: process.env.EVAL_API_KEY || '' });

let calls = 0;

const usageSince = (before) => Object.fromEntries(Object.entries(provider.usage ?? {}).map(([key, value]) => [key, value - (before[key] ?? 0)]));
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
  const update = events.find((item) => item.event === 'progress').data;
  const done = events.find((item) => item.event === 'done').data;
  calls += done.models.length;
  const text = events.filter((item) => item.event === 'delta').map((item) => item.data.text).join('');
  const given = [...new Map([...sources.current, ...sources.next, ...sources.upcoming, ...sources.related].map((chunk) => [chunk.id, chunk])).values()];
  return {
    move: update.move,
    action: ACTION_OF_MOVE[update.move] ?? 'other',
    intervention: update.intervention,
    verdict: update.assessment?.verdict ?? null,
    issue: update.assessment?.issue ?? null,
    misconception: update.assessment?.misconception ?? '',
    assessment: update.assessment,
    progress: update.progress,
    sourcesGiven: { current: sources.current.map((chunk) => chunk.id), related: sources.related.map((chunk) => chunk.id) },
    text,
    citations: done.citations,
    support: citationSupport(text, given),
    models: done.models,
    firstTokenMs: done.firstTokenMs,
    totalMs: done.totalMs,
  };
};

const plainTurn = async ({ lesson, plan, scenario, history, turn }) => {
  const system = plainSystem({ lesson, plan, scenario });
  let reply = '';
  const models = [];
  const started = Date.now();
  await withRetry(async () => {
    reply = '';
    for await (const text of provider.streamText({ system, messages: toProviderMessages(history, turn.student), onMeta: (meta) => models.push(meta.model) })) reply += text;
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
    models,
    totalMs: Date.now() - started,
  };
};

const gradeVariant = async ({ lesson, plan, scenario, student, system }) => {
  const turn = { student, label: scenario.label };
  const history = [{ role: 'tutor', content: openingMessage(plan, scenario.at ?? 0) }];
  if (system === 'plain') return plainTurn({ lesson, plan, scenario, history, turn });
  const progress = startProgress(plan, scenario);
  const sources = turnSources({ plan, chunks: lesson.chunks, progress }, 'reply', student);
  currentLabel = scenario.label;
  const models = [];
  const assessment = await withRetry(() => assessAnswer({ provider, plan, progress, tutorQuestion: history[0].content, studentMessage: student, sources: sources.current, related: sources.related, onMeta: (meta) => models.push(meta.model) }));
  calls += 1;
  return { verdict: assessment.verdict, issue: assessment.issue, checks: assessment.checks, models };
};

const modelScenario = async (scenario, system, partial) => {
  const lesson = lessons[scenario.lesson];
  const plan = planOf(lesson);
  if (scenario.variants) {
    const rows = [];
    for (const student of scenario.variants) {
      const row = await gradeVariant({ lesson, plan, scenario, student, system });
      rows.push({ student, ...row });
      partial.push(rows.at(-1));
      await wait(pauseMs);
    }
    const verdicts = rows.map((row) => row.verdict);
    const consistent = new Set(verdicts).size === 1 && verdicts[0] === scenario.label.verdict;
    return { id: scenario.id, category: scenario.category, variants: rows, verdicts, consistent, passed: consistent, turns: [] };
  }
  let progress = startProgress(plan, scenario);
  const history = [{ role: 'tutor', content: openingMessage(plan, scenario.at ?? 0) }];
  const rows = [];
  let previousHelp = null;
  const pending = [...scenario.turns];
  while (pending.length) {
    const turn = takeTurn(pending, progress);
    if (!turnApplies(turn, rows.at(-1)?.action)) continue;
    const at = new Date().toISOString();
    const row = system === 'plain'
      ? await plainTurn({ lesson, plan, scenario, history, turn })
      : await engineTurn({ lesson, plan, progress, history, turn });
    row.at = at;
    row.step = progress.status === 'active' ? progress.currentStep : null;
    if (row.progress) progress = row.progress;
    row.failures = checkTurn({ turn, row, mode, previousHelp });
    previousHelp = ['hint', 'explain', 'probe'].includes(row.action) ? row.text : null;
    history.push({ role: 'student', content: turn.student }, { role: 'tutor', content: row.text });
    rows.push({ turn, ...row });
    partial.push(turnRecord({ turn, ...row }));
    console.log(`${row.failures.length ? 'FAIL' : 'ok  '} ${system} ${scenario.id} ${row.verdict ?? '-'} ${row.action}${row.intervention ? `/${row.intervention}` : ''}${row.failures.length ? ` (${row.failures.join('; ')})` : ''}`);
    await wait(pauseMs);
  }
  const endFailures = system === 'plain' ? null : checkEnd(scenario, system, progress);
  const support = system === 'plain' ? null : supportProblems(rows);
  return {
    id: scenario.id,
    category: scenario.category,
    turns: rows,
    endFailures,
    states: system === 'plain' ? null : endStates(scenario, system, progress),
    supportProblems: support,
    endState: { status: progress.status, currentStep: progress.currentStep, final: progress.final ?? null },
    passed: rows.every((row) => !row.failures.length) && !(endFailures ?? []).length && !(support ?? []).length,
  };
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
  return { id: scenario.id, category: scenario.category, turns: rows, endFailures, states: endStates(scenario, system, progress), supportProblems: support, passed: rows.every((row) => !row.failures.length) && !endFailures.length && !(support ?? []).length };
};

const runPolicy = () => {
  const results = {};
  for (const system of systems) {
    const runs = selected.map((scenario) => policyScenario(scenario, system)).filter(Boolean);
    results[system] = { summary: summarize(runs), runs };
    console.log(`${system}: ${JSON.stringify({ ...results[system].summary, failures: results[system].summary.failures.length })}`);
  }
  if (arg('out', '') === 'none') return;
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  const file = new URL(`./results/teaching-${label}.json`, import.meta.url);
  writeFileSync(file, `${JSON.stringify({ label, mode, split, date: new Date().toISOString(), systems: Object.fromEntries(Object.entries(results).map(([system, value]) => [system, { summary: value.summary, runs: value.runs.map((run) => ({ ...run, turns: run.turns.map(({ turn, ...row }) => ({ student: turn.student, ...row })) })) }])) }, null, 2)}\n`);
  console.log(`saved ${file.pathname}`);
};

const runModel = async () => {
  const directory = arg('out', '') ? pathToFileURL(`${resolve(arg('out', ''), label)}/`) : new URL(`./results/runs/${label}/`, import.meta.url);
  const metaFile = new URL('meta.json', directory);
  const linesFile = new URL('results.jsonl', directory);
  const meta = runMeta({ label, mode, split, systems, provider, pauseMs, scenarios: selected });
  if (existsSync(metaFile)) {
    if (!flag('resume')) throw new Error(`${directory.pathname} already exists; pass --resume to continue it or use another --label`);
    const saved = JSON.parse(readFileSync(metaFile, 'utf8'));
    const mismatch = sameVersion(saved, meta);
    if (mismatch) throw new Error(`cannot resume: ${mismatch} changed since the run started`);
  } else {
    mkdirSync(directory, { recursive: true });
    writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  }
  const done = new Set(latestRuns(readRun(linesFile)).filter((line) => line.status === 'complete').map((line) => `${line.system}/${line.id}`));
  for (const scenario of selected) {
    for (const system of systems) {
      if (stopped) break;
      if (done.has(`${system}/${scenario.id}`)) continue;
      const startedAt = new Date().toISOString();
      const before = calls;
      const usageBefore = { ...(provider.usage ?? {}) };
      const partial = [];
      let line;
      try {
        const run = await modelScenario(scenario, system, partial);
        line = { system, split: scenario.split, status: 'complete', startedAt, finishedAt: new Date().toISOString(), calls: calls - before, usage: usageSince(usageBefore), ...run, turns: run.turns.map(turnRecord) };
      } catch (error) {
        console.log(`ERR  ${system} ${scenario.id} ${error.code ?? error.message}`);
        line = { system, id: scenario.id, category: scenario.category, split: scenario.split, status: error.code === 'quota_exhausted' ? 'stopped_quota' : 'infra_error', error: error.code ?? error.message, startedAt, finishedAt: new Date().toISOString(), calls: calls - before, usage: usageSince(usageBefore), partialTurns: partial };
      }
      appendFileSync(linesFile, `${JSON.stringify(line)}\n`);
    }
  }
  const summary = summarizeRun({ meta: JSON.parse(readFileSync(metaFile, 'utf8')), lines: readRun(linesFile), scenarios: selected, systems });
  writeFileSync(new URL('summary.json', directory), `${JSON.stringify(summary, null, 2)}\n`);
  for (const system of systems) console.log(`${system}: ${JSON.stringify({ ...summary.systems[system].counts, scenarioPass: summary.systems[system].summary.scenarioPass })}`);
  console.log(`saved ${directory.pathname}${stopped ? ` (stopped: ${stopped})` : ''}`);
};

if (mode === 'policy') {
  runPolicy();
} else {
  try {
    await runModel();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await provider.close?.();
  }
}
