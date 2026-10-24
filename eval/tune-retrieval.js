import { readFileSync } from 'node:fs';
import { buildIndex, scoreChunks, termGroups } from '../shared/text.js';
import { scoreSourceMatching } from './sources.js';
import { findMessageSources } from '../src/lesson/sources.js';

const golden = JSON.parse(readFileSync(new URL('./golden/retrieval.json', import.meta.url), 'utf8'));
const TRAIN = new Set(['solar-en', 'revolution-en']);

const questionRetriever = (params, termOptions) => (text, chunks) => {
  const index = buildIndex(chunks, termOptions);
  const terms = termGroups(text, termOptions).length;
  const needShared = Math.min(params.minShared, Math.max(terms, 1));
  const ranked = scoreChunks(text, index).filter((match) => match.score > 0).sort((a, b) => b.score - a.score);
  const eligible = ranked.filter((match) => match[params.measure] >= params.minCoverage && match.shared >= needShared);
  const best = eligible[0];
  if (!best) return [];
  return eligible.filter((match, position) => position === 0 || (position < params.limit && match.score >= best.score * params.secondRatio)).map((match) => match.chunk.id);
};

const evaluate = (retrieve, termOptions, docFilter) => {
  const queries = golden.queries.filter((query) => query.type === 'question' && docFilter(query.doc));
  let shown = 0;
  let correct = 0;
  let relevant = 0;
  let reciprocal = 0;
  let answerable = 0;
  let falseOnNone = 0;
  let none = 0;
  for (const query of queries) {
    const chunks = golden.documents[query.doc];
    const ids = retrieve(query.text, chunks);
    shown += ids.length;
    correct += ids.filter((id) => query.relevant.includes(id)).length;
    relevant += query.relevant.length;
    if (query.relevant.length) {
      answerable += 1;
      const ranked = scoreChunks(query.text, buildIndex(chunks, termOptions)).sort((a, b) => b.score - a.score).map((match) => match.chunk.id);
      const hit = ranked.findIndex((id) => query.relevant.includes(id));
      reciprocal += hit === -1 ? 0 : 1 / (hit + 1);
    } else {
      none += 1;
      if (ids.length) falseOnNone += 1;
    }
  }
  const precision = shown ? correct / shown : 0;
  const recall = relevant ? correct / relevant : 0;
  return {
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: precision + recall ? Math.round((2 * precision * recall / (precision + recall)) * 1000) / 1000 : 0,
    mrr: Math.round((reciprocal / answerable) * 1000) / 1000,
    falseOnNone: `${falseOnNone}/${none}`,
  };
};

const TERM_VARIANTS = {
  'plain': { hebrew: false, latin: false, sectionWeight: 0 },
  'hebrew': { hebrew: true, latin: false, sectionWeight: 0 },
  'hebrew+latin': { hebrew: true, latin: true, sectionWeight: 0 },
  'hebrew+section': { hebrew: true, latin: false, sectionWeight: 1 },
  'hebrew+latin+section': { hebrew: true, latin: true, sectionWeight: 1 },
};

const grid = [];
for (const measure of ['coverage', 'queryCoverage']) {
  for (const minCoverage of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
    for (const minShared of [1, 2]) {
      for (const secondRatio of [0.6, 0.75, 0.9]) grid.push({ measure, minCoverage, minShared, secondRatio, limit: 2 });
    }
  }
}

const rows = [];
for (const [name, termOptions] of Object.entries(TERM_VARIANTS)) {
  for (const params of grid) {
    const retrieve = questionRetriever(params, termOptions);
    rows.push({
      terms: name,
      ...params,
      train: evaluate(retrieve, termOptions, (doc) => TRAIN.has(doc)),
      heldOut: evaluate(retrieve, termOptions, (doc) => !TRAIN.has(doc)),
    });
  }
}

const noFalse = (row) => row.train.falseOnNone.startsWith('0/');
const ordered = [...rows].sort((a, b) => noFalse(b) - noFalse(a) || b.train.recall - a.train.recall || b.train.precision - a.train.precision);
console.log('Top settings on the training documents (English): no source for unanswerable questions first, then recall, then precision. Held-out = Hebrew and French:');
for (const row of ordered.slice(0, 12)) {
  console.log(`${row.terms.padEnd(22)} ${row.measure}>=${row.minCoverage} shared>=${row.minShared} second>=${row.secondRatio}  train ${JSON.stringify(row.train)}  heldOut ${JSON.stringify(row.heldOut)}`);
}

console.log('\nTerm options at queryCoverage>=0.4 shared>=1 second>=0.75:');
for (const name of Object.keys(TERM_VARIANTS)) {
  const row = rows.find((item) => item.terms === name && item.measure === 'queryCoverage' && item.minCoverage === 0.4 && item.minShared === 1 && item.secondRatio === 0.75);
  console.log(`${name.padEnd(22)} train ${JSON.stringify(row.train)}  heldOut ${JSON.stringify(row.heldOut)}`);
}

console.log('\nTutor-message attribution on the first golden set (39 cases), current settings:');
const old = scoreSourceMatching((message, chunks) => findMessageSources(message, chunks));
console.log(JSON.stringify({ top1: old.top1, shown: old.shown, falseMatches: old.falseMatches, extraSources: old.extraSources }));
