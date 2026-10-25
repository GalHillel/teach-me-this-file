import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { summarize } from './teaching-lib.js';

const root = new URL('../', import.meta.url);

const hashFiles = (paths) => {
  const hash = createHash('sha256');
  for (const path of paths) {
    const file = new URL(path, root);
    if (existsSync(file)) hash.update(`${path}\n`).update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 12);
};

const filesIn = (directory) => readdirSync(new URL(directory, root)).filter((name) => name.endsWith('.js')).sort().map((name) => `${directory}${name}`);

const git = (command) => {
  try {
    return execSync(`git ${command}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
};

export const versionInfo = (provider) => ({
  date: new Date().toISOString(),
  provider: provider.name,
  models: { main: process.env.GEMINI_MODELS || provider.model || null, backup: process.env.GEMINI_BACKUP_MODELS || null },
  commit: git('rev-parse HEAD') ?? process.env.EVAL_COMMIT ?? null,
  uncommittedChanges: git('status --porcelain -- server shared src eval') ? true : false,
  engineVersion: hashFiles([...filesIn('server/lesson/'), ...filesIn('shared/'), 'src/lesson/turnSources.js', 'src/lesson/sources.js']),
  promptVersion: hashFiles(['server/lesson/prompts.js']),
  node: process.version,
});

export const runMeta = ({ label, mode, split, systems, provider, pauseMs, scenarios }) => ({
  label,
  mode,
  split,
  systems,
  ...versionInfo(provider),
  scenariosVersion: hashFiles(['eval/golden/teaching.json', 'eval/golden/teaching-lessons.json']),
  scenarioIds: scenarios.map((scenario) => scenario.id),
  pauseMs,
});

const VERSION_FIELDS = ['mode', 'split', 'provider', 'engineVersion', 'promptVersion', 'scenariosVersion'];

export const sameVersion = (saved, current) => {
  const field = VERSION_FIELDS.find((key) => saved[key] !== current[key]);
  if (field) return field;
  if (JSON.stringify(saved.models) !== JSON.stringify(current.models)) return 'models';
  if (saved.systems.join() !== current.systems.join()) return 'systems';
  return null;
};

export const readRun = (file) => (existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);

export const latestRuns = (lines) => [...new Map(lines.map((line) => [`${line.system}/${line.id}`, line])).values()];

export const turnRecord = ({ progress, ...row }) => ({
  ...row,
  ...(progress ? { progressAfter: { status: progress.status, currentStep: progress.currentStep, review: progress.review ? { kind: progress.review.kind, position: progress.review.position, results: progress.review.results } : null, final: progress.final ?? null } } : {}),
});

const modelCounts = (lines) => {
  const counts = {};
  for (const line of lines) {
    for (const row of [...(line.turns ?? []), ...(Array.isArray(line.variants) ? line.variants : [])]) {
      for (const model of row.models ?? []) counts[model] = (counts[model] ?? 0) + 1;
    }
  }
  return counts;
};

export const summarizeRun = ({ meta, lines, scenarios, systems }) => {
  const latest = latestRuns(lines);
  return {
    meta,
    systems: Object.fromEntries(systems.map((system) => {
      const mine = latest.filter((line) => line.system === system);
      const complete = mine.filter((line) => line.status === 'complete');
      const seen = new Set(mine.map((line) => line.id));
      return [system, {
        counts: {
          planned: scenarios.length,
          complete: complete.length,
          infraErrors: mine.filter((line) => line.status === 'infra_error').map((line) => ({ id: line.id, error: line.error })),
          stoppedOnQuota: mine.filter((line) => line.status === 'stopped_quota').map((line) => line.id),
          notRun: scenarios.filter((scenario) => !seen.has(scenario.id)).map((scenario) => scenario.id),
        },
        modelCalls: modelCounts(complete),
        summary: summarize(complete),
      }];
    })),
  };
};
