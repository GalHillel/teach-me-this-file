import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assessAnswer } from '../server/lesson/assessor.js';
import { createProgress } from '../server/lesson/progress.js';
import { resolveProvider } from '../server/providers/index.js';

const golden = JSON.parse(readFileSync(new URL('./golden/grading.json', import.meta.url), 'utf8'));
const label = process.env.EVAL_LABEL || 'run';
const pauseMs = Number(process.env.EVAL_PAUSE_MS || 1500);
const only = process.env.EVAL_ONLY ? process.env.EVAL_ONLY.split(',') : null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const lessonFor = (stepKey) => {
  const step = golden.steps[stepKey];
  const plan = {
    title: step.title,
    languageCode: step.languageCode,
    audience: step.audience,
    style: '',
    objectives: [step.goal],
    steps: [{ id: 's1', title: step.title, goal: step.goal, keyConcepts: step.keyConcepts, checkQuestion: step.checkQuestion, successCriteria: step.successCriteria, sourceIds: ['c1'] }],
  };
  return { plan, sources: [{ id: 'c1', label: 'Page 1', text: step.source }] };
};

const summarize = (rows) => {
  const share = (list, test) => (list.length ? list.filter(test).length / list.length : null);
  const graded = rows.filter((row) => !row.error);
  const expectsNotCorrect = graded.filter((row) => !row.accept.includes('correct'));
  const expectsCorrect = graded.filter((row) => row.accept.length === 1 && row.accept[0] === 'correct');
  const expectsPartial = graded.filter((row) => row.accept.includes('partial') && !row.accept.includes('correct'));
  return {
    cases: rows.length,
    errors: rows.length - graded.length,
    accuracy: share(graded, (row) => row.ok),
    falseCorrect: share(expectsNotCorrect, (row) => row.verdict === 'correct'),
    correctRecognised: share(expectsCorrect, (row) => row.verdict === 'correct'),
    partialRecognised: share(expectsPartial, (row) => row.ok),
    medianMs: graded.map((row) => row.ms).sort((a, b) => a - b)[Math.floor(graded.length / 2)] ?? null,
    lowConfidenceOnMiss: share(graded.filter((row) => !row.ok), (row) => row.assessment.confidence === 'low'),
    lowConfidenceOnHit: share(graded.filter((row) => row.ok), (row) => row.assessment.confidence === 'low'),
    issueAccuracy: share(graded.filter((row) => row.expectedIssue), (row) => row.expectedIssue.includes(row.assessment.issue)),
    issues: Object.fromEntries(['misread_question', 'hedged', 'no_knowledge', 'unjustified', 'copied'].map((issue) => {
      const expected = graded.filter((row) => row.expectedIssue?.length === 1 && row.expectedIssue[0] === issue);
      const predicted = graded.filter((row) => row.expectedIssue && row.assessment.issue === issue);
      return [issue, {
        expected: expected.length,
        recall: share(expected, (row) => row.assessment.issue === issue),
        predicted: predicted.length,
        precision: share(predicted, (row) => row.expectedIssue.includes(issue)),
      }];
    })),
    misconceptionNamed: share(graded.filter((row) => row.tags?.includes('misconception')), (row) => Boolean(row.assessment.misconception)),
    correctMarkedWrong: share(expectsCorrect, (row) => row.verdict === 'incorrect'),
    backupAnswers: graded.filter((row) => row.backup).length,
    models: graded.reduce((all, row) => ({ ...all, [row.model]: (all[row.model] ?? 0) + 1 }), {}),
  };
};

const run = async () => {
  const { provider } = resolveProvider({ apiKey: process.env.EVAL_API_KEY || '', provider: process.env.EVAL_PROVIDER || '' });
  const rows = [];
  for (const item of golden.cases) {
    if (only && !only.includes(item.id)) continue;
    const { plan, sources } = lessonFor(item.step);
    const started = Date.now();
    let meta = { model: provider.model, backup: false };
    try {
      const assessment = await assessAnswer({
        provider,
        plan,
        progress: createProgress(plan),
        tutorQuestion: item.tutorQuestion ?? plan.steps[0].checkQuestion,
        studentMessage: item.student,
        sources,
        onMeta: (value) => {
          meta = value;
        },
      });
      const row = { id: item.id, accept: item.accept, expectedIssue: item.issue ?? null, tags: item.tags, verdict: assessment.verdict, ok: item.accept.includes(assessment.verdict), ms: Date.now() - started, model: meta.model, backup: meta.backup, assessment };
      rows.push(row);
      console.log(`${row.ok ? 'ok  ' : 'MISS'} ${item.id.padEnd(36)} ${row.verdict.padEnd(10)} want ${item.accept.join('|')} issue=${assessment.issue}${item.issue ? ` want ${item.issue.join('|')}` : ''} ${row.ms}ms ${row.model}`);
    } catch (error) {
      rows.push({ id: item.id, accept: item.accept, tags: item.tags, error: error.code ?? error.message, ms: Date.now() - started });
      console.log(`ERR  ${item.id.padEnd(36)} ${error.code ?? error.message}`);
    }
    await wait(pauseMs);
  }
  const summary = summarize(rows);
  console.log(JSON.stringify(summary));
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`./results/grading-${label}.json`, import.meta.url), `${JSON.stringify({ label, date: new Date().toISOString(), summary, rows }, null, 2)}\n`);
};

await run();
