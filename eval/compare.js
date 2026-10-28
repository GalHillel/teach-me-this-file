import { readFileSync, writeFileSync } from 'node:fs';
import { loadScenarios, summarize, textMeasures } from './teaching-lib.js';
import { latestRuns, readRun } from './teaching-store.js';

const args = process.argv.slice(2);
const runs = args.filter((item) => item.startsWith('--run=')).map((item) => {
  const [system, repeat, directory] = item.slice(6).split(':');
  return { system, repeat: Number(repeat), directory };
});
const split = (args.find((item) => item.startsWith('--split=')) ?? '--split=final9').slice(8);
const out = (args.find((item) => item.startsWith('--out=')) ?? '').slice(6);

const { scenarios, leakMarkers } = loadScenarios();
const planned = scenarios.filter((scenario) => scenario.split === split);
const byId = new Map(planned.map((scenario) => [scenario.id, scenario]));
const GROUPS = {
  all: () => true,
  targeted: (scenario) => scenario.targets?.length > 0,
  not_targeted: (scenario) => !scenario.targets?.length,
};

const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
const fraction = (part, whole) => `${part}/${whole}`;

const measure = (lines) => {
  const conversations = lines.filter((line) => !line.variants);
  const summary = summarize(lines);
  const text = conversations.map((line) => ({ id: line.id, ...textMeasures(line, byId.get(line.id), leakMarkers) }));
  const usage = lines.reduce((total, line) => ({ charsIn: total.charsIn + (line.usage?.charsIn ?? 0), charsOut: total.charsOut + (line.usage?.charsOut ?? 0) }), { charsIn: 0, charsOut: 0 });
  return {
    conversations: fraction(conversations.filter((line) => line.passed).length, conversations.length),
    passedIds: conversations.filter((line) => line.passed).map((line) => line.id),
    paraphraseConsistency: summary.paraphraseConsistency,
    falseAcceptance: summary.grading?.falsePositives ?? null,
    falseRejection: summary.grading?.falseNegatives ?? null,
    overclaims: summary.overclaims,
    unsupportedAdvancement: summary.unearnedMoves,
    prerequisiteRecovery: summary.prerequisiteRecovery,
    teachingLeakage: fraction(sum(text, (item) => item.teachingLeaks.length), sum(text, (item) => item.teachingReplies)),
    helpLeakage: fraction(sum(text, (item) => item.helpLeaks.length), sum(text, (item) => item.helpReplies)),
    unnecessaryRepetition: fraction(sum(text, (item) => item.repeats.length), sum(text, (item) => item.repeatChances)),
    leaksAt: text.filter((item) => item.teachingLeaks.length || item.helpLeaks.length).map((item) => ({ id: item.id, teaching: item.teachingLeaks, help: item.helpLeaks })),
    repeatsAt: text.filter((item) => item.repeats.length).map((item) => ({ id: item.id, turns: item.repeats })),
    approvalOnNotCorrect: summary.text?.approvalOnNotCorrect ?? null,
    notInDocumentMissed: sum(conversations, (line) => line.turns.filter((row) => (row.failures ?? []).includes('did not say the document does not cover it')).length),
    invalidCitationIds: summary.text?.invalidCitationIds ?? null,
    weaklySupportedCitations: summary.text?.weaklySupportedCitations ?? null,
    latencyMs: summary.latencyMs,
    modelCalls: sum(lines, (line) => line.calls ?? 0),
    ...usage,
    failures: summary.failures,
  };
};

const report = { split, planned: planned.length, runs: [] };
for (const run of runs) {
  const lines = latestRuns(readRun(`${run.directory}/results.jsonl`)).filter((line) => line.system === (run.system === 'plain' ? 'plain' : 'engine') && byId.has(line.id));
  const complete = lines.filter((line) => line.status === 'complete');
  const meta = JSON.parse(readFileSync(`${run.directory}/meta.json`, 'utf8'));
  const models = [...new Set(complete.flatMap((line) => [...(line.turns ?? []), ...(Array.isArray(line.variants) ? line.variants : [])].flatMap((row) => row.models ?? [])))];
  report.runs.push({
    system: run.system,
    repeat: run.repeat,
    commit: meta.commit,
    engineVersion: meta.engineVersion,
    promptVersion: meta.promptVersion,
    scenariosVersion: meta.scenariosVersion,
    models,
    complete: complete.length,
    notComplete: lines.filter((line) => line.status !== 'complete').map((line) => ({ id: line.id, status: line.status, error: line.error })),
    notRun: planned.filter((scenario) => !lines.some((line) => line.id === scenario.id)).map((scenario) => scenario.id),
    groups: Object.fromEntries(Object.entries(GROUPS).map(([name, test]) => [name, measure(complete.filter((line) => test(byId.get(line.id))))])),
  });
}

const flips = {};
for (const system of [...new Set(runs.map((run) => run.system))]) {
  const mine = report.runs.filter((run) => run.system === system);
  if (mine.length < 2) continue;
  const passSets = mine.map((run) => new Set(run.groups.all.passedIds));
  const common = planned.filter((scenario) => !scenario.variants && mine.every((run) => !run.notRun.includes(scenario.id) && !run.notComplete.some((item) => item.id === scenario.id)));
  flips[system] = common.filter((scenario) => new Set(passSets.map((set) => set.has(scenario.id))).size > 1).map((scenario) => scenario.id);
}
report.flipsBetweenRepeats = flips;

const json = `${JSON.stringify(report, null, 2)}\n`;
if (out) writeFileSync(out, json);
for (const run of report.runs) {
  for (const [name, group] of Object.entries(run.groups)) {
    console.log(`${run.system} rep${run.repeat} ${name}: pass ${group.conversations}, falseAccept ${group.falseAcceptance}, falseReject ${group.falseRejection}, overclaims ${group.overclaims}, unsupported ${group.unsupportedAdvancement}, prereq ${group.prerequisiteRecovery}, leakTeach ${group.teachingLeakage}, leakHelp ${group.helpLeakage}, repeat ${group.unnecessaryRepetition}, calls ${group.modelCalls}`);
  }
}
console.log(`flips ${JSON.stringify(flips)}`);
