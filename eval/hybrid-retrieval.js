import { readFileSync, writeFileSync } from 'node:fs';
import { buildNgramIndex, fuseRanks, scoreNgrams } from '../shared/ngrams.js';
import { buildIndex, scoreChunks } from '../shared/text.js';
import { findRelatedPassages } from '../src/lesson/sources.js';

const golden = JSON.parse(readFileSync(new URL('./golden/retrieval.json', import.meta.url), 'utf8'));
const DEV = new Set(['solar-en', 'revolution-en']);
const round = (value) => Math.round(value * 1000) / 1000;

const rankers = {
  bm25: (text, chunks) => scoreChunks(text, buildIndex(chunks)).filter((match) => match.score > 0).sort((a, b) => b.score - a.score).map((match) => match.chunk.id),
  ngram: (text, chunks) => scoreNgrams(text, buildNgramIndex(chunks)).filter((match) => match.score > 0).sort((a, b) => b.score - a.score).map((match) => match.chunk.id),
};
rankers.hybrid = (text, chunks) => fuseRanks([rankers.bm25(text, chunks), rankers.ngram(text, chunks)]);

const hybridShown = ({ threshold, ratio }) => (text, chunks) => {
  const bm25 = findRelatedPassages(text, chunks).map((chunk) => chunk.id);
  if (bm25.length) return bm25;
  const scored = scoreNgrams(text, buildNgramIndex(chunks)).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < threshold) return [];
  return scored.filter((match, position) => position === 0 || (position < 2 && match.score >= best.score * ratio)).map((match) => match.chunk.id);
};

const evaluate = (queries, rank, show) => {
  let reciprocal = 0;
  let recallAt1 = 0;
  let answerable = 0;
  let shown = 0;
  let correct = 0;
  let relevant = 0;
  let nothingShown = 0;
  let falseOnNone = 0;
  let none = 0;
  for (const query of queries) {
    const chunks = golden.documents[query.doc];
    const ids = show(query.text, chunks);
    shown += ids.length;
    correct += ids.filter((id) => query.relevant.includes(id)).length;
    relevant += query.relevant.length;
    if (query.relevant.length) {
      answerable += 1;
      const ranked = rank(query.text, chunks);
      const hit = ranked.findIndex((id) => query.relevant.includes(id));
      reciprocal += hit === -1 ? 0 : 1 / (hit + 1);
      recallAt1 += ranked.slice(0, 1).filter((id) => query.relevant.includes(id)).length / query.relevant.length;
      if (!ids.length) nothingShown += 1;
    } else {
      none += 1;
      if (ids.length) falseOnNone += 1;
    }
  }
  return {
    queries: queries.length,
    mrr: round(reciprocal / answerable),
    recallAt1: round(recallAt1 / answerable),
    shownPrecision: shown ? round(correct / shown) : null,
    shownRecall: round(correct / relevant),
    answerableWithNothingShown: nothingShown,
    unanswerableWithSourceShown: `${falseOnNone}/${none}`,
  };
};

const questions = golden.queries.filter((query) => query.type === 'question');
const splits = {
  dev: questions.filter((query) => DEV.has(query.doc)),
  holdout: questions.filter((query) => !DEV.has(query.doc)),
};

const grid = [];
for (const threshold of [0.15, 0.2, 0.25, 0.3, 0.35, 0.4]) {
  for (const ratio of [0.8, 0.9, 1]) {
    const result = evaluate(splits.dev, rankers.hybrid, hybridShown({ threshold, ratio }));
    grid.push({ threshold, ratio, ...result });
  }
}
const noFalse = grid.filter((row) => row.unanswerableWithSourceShown.startsWith('0/'));
const tuned = (noFalse.length ? noFalse : grid).sort((a, b) => b.shownRecall - a.shownRecall || (b.shownPrecision ?? 0) - (a.shownPrecision ?? 0) || b.threshold - a.threshold)[0];

const report = {
  date: new Date().toISOString(),
  note: 'Question queries only. Thresholds for the hybrid fallback were tuned on the English documents (dev) and applied unchanged to Hebrew and French (holdout).',
  tuned: { threshold: tuned.threshold, ratio: tuned.ratio },
  ranking: Object.fromEntries(Object.entries(splits).map(([name, queries]) => [name, Object.fromEntries(Object.entries(rankers).map(([ranker, rank]) => [ranker, evaluate(queries, rank, () => [])]).map(([ranker, result]) => [ranker, { mrr: result.mrr, recallAt1: result.recallAt1 }]))])),
  shown: Object.fromEntries(Object.entries(splits).map(([name, queries]) => [name, {
    current: evaluate(queries, rankers.bm25, (text, chunks) => findRelatedPassages(text, chunks).map((chunk) => chunk.id)),
    hybridFallback: evaluate(queries, rankers.hybrid, hybridShown(tuned)),
  }])),
};

console.log(JSON.stringify(report, null, 2));
const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
