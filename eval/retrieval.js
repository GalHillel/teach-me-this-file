import { readFileSync, writeFileSync } from 'node:fs';
import { buildIndex, rankChunks, scoreChunks } from '../shared/text.js';
import { findMessageSources, findRelatedPassages } from '../src/lesson/sources.js';

const golden = JSON.parse(readFileSync(new URL('./golden/retrieval.json', import.meta.url), 'utf8'));

const strategies = {
  tutor: (query, chunks) => findMessageSources(query.text, chunks).filter((source) => source.kind === 'based').map((source) => source.chunkId),
  question: (query, chunks) => findRelatedPassages(query.text, chunks).map((chunk) => chunk.id),
};

export const baselineStrategies = {
  ...strategies,
  question: (query, chunks) => rankChunks(query.text, chunks, { limit: 2, minShared: 2, minScore: 0.2 }).map((match) => match.chunk.id),
};

const ratio = (part, whole) => (whole ? part / whole : null);
const round = (value) => (value === null ? null : Math.round(value * 1000) / 1000);

export const evaluateRetrieval = ({ rank = (text, chunks) => scoreChunks(text, buildIndex(chunks)).sort((a, b) => b.score - a.score).map((match) => match.chunk.id), show = strategies } = {}) => {
  const rows = golden.queries.map((query) => {
    const chunks = golden.documents[query.doc];
    const ranked = rank(query.text, chunks);
    const firstHit = ranked.findIndex((id) => query.relevant.includes(id));
    const shown = show[query.type](query, chunks);
    return {
      id: query.id,
      type: query.type,
      relevant: query.relevant,
      shown,
      reciprocalRank: query.relevant.length ? (firstHit === -1 ? 0 : 1 / (firstHit + 1)) : null,
      recallAt1: query.relevant.length ? ranked.slice(0, 1).filter((id) => query.relevant.includes(id)).length / query.relevant.length : null,
      recallAt3: query.relevant.length ? ranked.slice(0, 3).filter((id) => query.relevant.includes(id)).length / query.relevant.length : null,
      correctShown: shown.filter((id) => query.relevant.includes(id)).length,
    };
  });

  const summarise = (subset) => {
    const answerable = subset.filter((row) => row.relevant.length);
    const unanswerable = subset.filter((row) => !row.relevant.length);
    const shownTotal = subset.reduce((sum, row) => sum + row.shown.length, 0);
    const correctTotal = subset.reduce((sum, row) => sum + row.correctShown, 0);
    const relevantTotal = answerable.reduce((sum, row) => sum + row.relevant.length, 0);
    return {
      queries: subset.length,
      mrr: round(ratio(answerable.reduce((sum, row) => sum + row.reciprocalRank, 0), answerable.length)),
      recallAt1: round(ratio(answerable.reduce((sum, row) => sum + row.recallAt1, 0), answerable.length)),
      recallAt3: round(ratio(answerable.reduce((sum, row) => sum + row.recallAt3, 0), answerable.length)),
      shownPrecision: round(ratio(correctTotal, shownTotal)),
      shownRecall: round(ratio(correctTotal, relevantTotal)),
      answerableWithNothingShown: answerable.filter((row) => !row.shown.length).length,
      unanswerableWithSourceShown: unanswerable.filter((row) => row.shown.length).length,
      unanswerable: unanswerable.length,
    };
  };

  return {
    all: summarise(rows),
    tutor: summarise(rows.filter((row) => row.type === 'tutor')),
    question: summarise(rows.filter((row) => row.type === 'question')),
    rows,
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = evaluateRetrieval();
  for (const row of result.rows) {
    const ok = row.relevant.length ? row.correctShown === row.relevant.length && row.shown.length === row.relevant.length : !row.shown.length;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${row.id.padEnd(12)} relevant=${row.relevant.join('+') || '-'} shown=${row.shown.join('+') || '-'} rr=${row.reciprocalRank ?? '-'}`);
  }
  for (const key of ['tutor', 'question', 'all']) console.log(key, JSON.stringify(result[key]));
  const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
  if (out) writeFileSync(out, `${JSON.stringify({ date: new Date().toISOString(), tutor: result.tutor, question: result.question, all: result.all }, null, 2)}\n`);
}
