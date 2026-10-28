import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkEnd, checkTurn, citationSupport, endsWithQuestion, hasPraise, loadLessons, loadScenarios, notesContradiction,
  markerGroupsFound, policyRun, readTag, saysNotInDocument, similarity, summarize, supportProblems, takeTurn, textMeasures, turnApplies,
} from '../eval/teaching-lib.js';
import { callFromPage } from '../eval/remote-provider.js';

const lessons = loadLessons();
const { scenarios, categories, leakMarkers } = loadScenarios();
const dev = scenarios.filter((scenario) => scenario.split === 'dev' && !scenario.variants);

describe('teaching scenarios', () => {
  it('defines every category in advance and uses only known lessons, steps and passages', () => {
    for (const scenario of scenarios) {
      expect(categories[scenario.category], scenario.id).toBeTruthy();
      const lesson = lessons[scenario.lesson];
      expect(lesson, scenario.id).toBeTruthy();
      if (scenario.split !== 'regress9') expect(lesson.split).toBe(scenario.split);
      expect(scenario.at ?? 0).toBeLessThan(lesson.steps.length);
      const ids = new Set(lesson.chunks.map((chunk) => chunk.id));
      for (const turn of scenario.turns ?? []) {
        for (const id of [...(turn.expect?.cite ?? []), ...(turn.expect?.contradiction ?? [])]) expect(ids.has(id), `${scenario.id} ${id}`).toBe(true);
      }
    }
    for (const definition of Object.values(categories)) expect(Object.keys(definition)).toEqual(['detect', 'intervene', 'evidence', 'success', 'failure']);
  });

  it('keeps the dev and every held-out set on different lessons', () => {
    const lessonsOf = (split) => new Set(scenarios.filter((scenario) => scenario.split === split).map((scenario) => lessons[scenario.lesson].title));
    const splits = ['dev', 'holdout', 'holdout2', 'holdout3', 'holdout4', 'final9'];
    for (const split of splits) expect(lessonsOf(split).size, split).toBeGreaterThan(0);
    for (const [index, left] of splits.entries()) {
      for (const right of splits.slice(index + 1)) expect([...lessonsOf(left)].filter((title) => lessonsOf(right).has(title)), `${left}/${right}`).toEqual([]);
    }
  });

  it('the engine meets every dev expectation when the grades are right', () => {
    const failures = dev.flatMap((scenario) => {
      const { progress, turns } = policyRun(lessons[scenario.lesson], scenario, 'engine');
      return [
        ...turns.flatMap((row, index) => checkTurn({ turn: row.turn, row, mode: 'policy' }).map((problem) => `${scenario.id} turn ${index + 1}: ${problem}`)),
        ...checkEnd(scenario, 'engine', progress).map((problem) => `${scenario.id} end: ${problem}`),
      ];
    });
    expect(failures).toEqual([]);
  });

  it('runs the model layer end to end through the real turn code, saving each scenario as it finishes', () => {
    const out = mkdtempSync(join(tmpdir(), 'teaching-'));
    try {
      const args = ['eval/teaching.js', '--mode=model', '--provider=labels', '--split=dev', '--systems=engine,plain', `--out=${out}`, '--label=test'];
      const env = { ...process.env, EVAL_PAUSE_MS: '0' };
      const output = execFileSync('node', [...args, '--only=dev-en-prerequisite,dev-en-copied'], { encoding: 'utf8', env });
      expect(output).toMatch(/ok\s+engine dev-en-prerequisite correct back_to_question/);
      expect(() => execFileSync('node', [...args, '--only=dev-en-prerequisite,dev-en-copied'], { encoding: 'utf8', env, stdio: 'pipe' })).toThrow();
      execFileSync('node', [...args, '--only=dev-en-prerequisite,dev-en-copied,dev-en-paraphrase-correct', '--resume'], { encoding: 'utf8', env });
      const lines = readFileSync(join(out, 'test', 'results.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(lines.map((line) => `${line.system}/${line.id}`).sort()).toEqual(['engine/dev-en-copied', 'engine/dev-en-paraphrase-correct', 'engine/dev-en-prerequisite', 'plain/dev-en-copied', 'plain/dev-en-paraphrase-correct', 'plain/dev-en-prerequisite']);
      const prerequisite = lines.find((line) => line.system === 'engine' && line.id === 'dev-en-prerequisite');
      expect(prerequisite.turns[0]).toMatchObject({ turn: { student: expect.any(String) }, move: expect.any(String), assessment: { verdict: expect.any(String) }, models: ['labels', 'labels'], citations: expect.any(Object) });
      const summary = JSON.parse(readFileSync(join(out, 'test', 'summary.json'), 'utf8'));
      expect(summary.meta).toMatchObject({ provider: 'labels', split: 'dev', promptVersion: expect.any(String), engineVersion: expect.any(String) });
      expect(summary.systems.engine.counts).toMatchObject({ complete: 3, notRun: [], infraErrors: [] });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('conditional follow-up turns', () => {
  it('sends a turn marked with when only after one of those tutor actions', () => {
    expect(turnApplies({ student: 'x' }, 'next_step')).toBe(true);
    expect(turnApplies({ student: 'x', when: ['back_to_question'] }, 'back_to_question')).toBe(true);
    expect(turnApplies({ student: 'x', when: ['back_to_question'] }, 'next_step')).toBe(false);
    expect(turnApplies({ student: 'x', when: ['back_to_question'] }, undefined)).toBe(false);
  });
});

describe('text checks used on model replies', () => {
  it('finds approval language without flagging partial credit', () => {
    expect(hasPraise('That\'s correct! Plants take in carbon dioxide.')).toBe(true);
    expect(hasPraise('Spot on. Now the next step.')).toBe(true);
    expect(hasPraise('כל הכבוד, זו התשובה.')).toBe(true);
    expect(hasPraise('You\'re right that roots take in water, but what else?')).toBe(false);
    expect(hasPraise('Not quite. What else does the leaf take in?')).toBe(false);
    expect(hasPraise('הבאת בדיוק את הפרטים הנכונים.')).toBe(true);
    expect(hasPraise('זה נכון שהלב פועל כמו שריר, אבל לאן הוא דוחף את הדם?')).toBe(false);
    expect(hasPraise('הלב פועל בדיוק כמו משאבה.')).toBe(false);
    expect(hasPraise('מה בדיוק קורה בנימים?')).toBe(false);
  });

  it('recognises a reply that says the document does not cover a question', () => {
    expect(saysNotInDocument('The document doesn\'t say anything about cactus plants at night.')).toBe(true);
    expect(saysNotInDocument('That goes beyond our document, but in short: yes.')).toBe(true);
    expect(saysNotInDocument('הקובץ לא עוסק בזה, אבל באופן כללי...')).toBe(true);
    expect(saysNotInDocument('Plants take in carbon dioxide through the stomata [c2].')).toBe(false);
  });

  it('recognises a reply that points out a disagreement', () => {
    expect(notesContradiction('The two passages contradict each other.')).toBe(true);
    expect(notesContradiction('בקובץ כתובים שני דברים שונים.')).toBe(true);
    expect(notesContradiction('Plants take in carbon dioxide.')).toBe(false);
  });

  it('reads the baseline tag and strips it from the text', () => {
    expect(readTag('Good try! Think about the air.\n[[judgement: partial; action: hint]]')).toEqual({ text: 'Good try! Think about the air.', judgement: 'partial', action: 'hint' });
    expect(readTag('No tag here.').action).toBe(null);
    expect(readTag('Text [[judgement: correct; action: dance]]').action).toBe(null);
  });

  it('scores how well a cited sentence matches its passage', () => {
    const chunks = [{ id: 'c2', text: 'Leaves take in carbon dioxide from the air through tiny openings called stomata.' }];
    const [strong] = citationSupport('Leaves take in carbon dioxide through the stomata [c2].', chunks);
    const [weak] = citationSupport('Volcanoes erupt when magma rises [c2].', chunks);
    expect(strong).toBeGreaterThan(0.7);
    expect(weak).toBeLessThan(0.2);
    expect(citationSupport('No citations at all.', chunks)).toEqual([]);
  });

  it('measures repeated help and question endings', () => {
    expect(similarity('Think about what the leaves take in from the air around them.', 'Think about what the leaves take in from the air around them!')).toBeGreaterThan(0.8);
    expect(similarity('Think about the air.', 'Imagine a potted plant that never loses soil.')).toBeLessThan(0.1);
    expect(endsWithQuestion('What do you think?')).toBe(true);
    expect(endsWithQuestion('**What do you think?**')).toBe(true);
    expect(endsWithQuestion('That is all.')).toBe(false);
  });

  it('checks that help escalates within a step and never repeats, counting each step on its own', () => {
    expect(supportProblems([{ step: 0, intervention: 'nudge' }, { step: 0, intervention: 'focused_hint' }, { step: 1, intervention: 'nudge' }])).toEqual([]);
    expect(supportProblems([{ step: 0, intervention: 'nudge' }, { step: 0, intervention: 'nudge' }])).toEqual(['turn 2: repeated nudge']);
    expect(supportProblems([{ step: 0, intervention: 'worked_example' }, { step: 0, intervention: 'nudge' }])).toEqual(['turn 2: less support (nudge) after more']);
  });
});

describe('eval summary and remote calls', () => {
  const row = (actions, action, totalMs) => ({ turn: { label: { verdict: 'correct' }, expect: { actions } }, action, failures: [], totalMs });

  it('counts returns to the question, finished lessons and latency', () => {
    const summary = summarize([
      { id: 'a', passed: true, turns: [row(['back_to_question', 'hint'], 'hint', 1000), row(['summary'], 'summary', 3000)] },
      { id: 'b', passed: false, turns: [row(['back_to_question'], 'next_step', 2000), row(['summary'], 'final_check', 4000)] },
    ]);
    expect(summary.returnTurnsFit).toBe('1/2');
    expect(summary.lessonsCompleted).toBe('1/2');
    expect(summary.latencyMs).toEqual({ turns: 4, p50: 3000, p95: 4000 });
  });

  it('keeps the error code of a failed remote model call', async () => {
    const page = { evaluate: async () => ({ status: 429, body: { error: { code: 'quota_exhausted', message: 'Daily quota used up.' } } }) };
    await expect(callFromPage(page)({ op: 'json' })).rejects.toMatchObject({ code: 'quota_exhausted', message: 'Daily quota used up.' });
  });

  it('reports a remote failure without a body as provider_unavailable', async () => {
    const page = { evaluate: async () => ({ status: 504, body: null }) };
    await expect(callFromPage(page)({ op: 'text' })).rejects.toMatchObject({ code: 'provider_unavailable', message: 'HTTP 504' });
  });
});

describe('round 9: the final evaluation set', () => {
  const final = scenarios.filter((scenario) => scenario.split === 'final9');

  it('tags every scenario as targeted or not, and labels and expects every turn', () => {
    expect(final).toHaveLength(26);
    expect(final.filter((scenario) => scenario.targets.length)).toHaveLength(6);
    for (const scenario of final) {
      expect(Array.isArray(scenario.targets), scenario.id).toBe(true);
      for (const turn of scenario.turns ?? []) {
        expect(turn.label?.verdict, scenario.id).toBeTruthy();
        expect(turn.expect?.actions?.length, scenario.id).toBeGreaterThan(0);
      }
    }
  });

  it('has answer markers for every step of its lessons, none of them already in the check question', () => {
    for (const id of ['magnets-en', 'spoilage-he']) {
      lessons[id].steps.forEach((step, index) => {
        const spec = leakMarkers[id][index];
        expect(spec.groups.length, `${id} ${index}`).toBeGreaterThanOrEqual(spec.min);
        expect(markerGroupsFound(step.checkQuestion, spec), `${id} ${index}`).toBe(0);
      });
    }
  });
});

describe('round 9: text measures', () => {
  const spec = { 'magnets-en': { 1: { min: 2, groups: [['iron'], ['not attracted', 'not magnetic']] } } };
  const scenario = { lesson: 'magnets-en', at: 0 };
  const row = (action, text, label = { verdict: 'correct' }, actions = ['next_step']) => ({ action, text, turn: { label, expect: { actions } } });

  it('counts a move to the next step whose message already answers its check question', () => {
    const leak = textMeasures({ turns: [row('next_step', 'Right! Magnets pull iron [c2], but aluminium is not magnetic. How does the plant sort cans?')] }, scenario, spec);
    expect(leak).toMatchObject({ teachingReplies: 1, teachingLeaks: [1] });
    const clean = textMeasures({ turns: [row('next_step', 'Right! Some things stick to magnets and some do not. How does the plant sort cans?')] }, scenario, spec);
    expect(clean).toMatchObject({ teachingReplies: 1, teachingLeaks: [] });
  });

  it('counts help that gives every part of the answer, and a correct answer asked again', () => {
    const turns = [
      row('next_step', 'Next: how does the plant sort cans?'),
      row('hint', 'Iron is pulled, and aluminium is not attracted. So?', { verdict: 'partial' }, ['hint']),
      row('back_to_question', 'Now the whole question again?', { verdict: 'correct' }, ['next_step']),
    ];
    expect(textMeasures({ turns }, scenario, spec)).toMatchObject({ helpReplies: 2, helpLeaks: [2], repeatChances: 2, repeats: [3] });
  });

  it('answers the final-check question the engine asked, whatever the written order', () => {
    const pending = [{ about: 1, student: 'b' }, { about: 0, student: 'a' }, { about: 2, student: 'c' }];
    const progress = { status: 'reviewing', review: { kind: 'final', queue: [0, 1, 2], position: 0 } };
    expect(takeTurn(pending, progress).student).toBe('a');
    expect(takeTurn(pending, { status: 'active' }).student).toBe('b');
    expect(pending.map((turn) => turn.student)).toEqual(['c']);
  });
});
