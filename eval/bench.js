import { writeFileSync } from 'node:fs';
import { buildIndex, scoreChunks } from '../shared/text.js';
import { buildChunks } from '../src/document/chunk.js';
import { findMessageSources } from '../src/lesson/sources.js';

const WORDS = 'cell energy light water plant root leaf carbon oxygen sugar glucose membrane nucleus protein enzyme reaction molecule atom heat pressure volume density mass force motion planet orbit gravity moon star river ocean climate rain cloud rock soil mineral history king war revolution trade city law right vote'.split(' ');

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const makeDocument = (pages, random) =>
  Array.from({ length: pages }, (_, page) => ({
    label: `Page ${page + 1}`,
    text: Array.from({ length: 6 }, () =>
      `${Array.from({ length: 22 }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ')}.`,
    ).join('\n\n'),
  }));

const time = (action, repeat = 1) => {
  const started = process.hrtime.bigint();
  let result;
  for (let i = 0; i < repeat; i += 1) result = action();
  return { ms: Number(process.hrtime.bigint() - started) / 1e6 / repeat, result };
};

const run = () => {
  const random = seeded(42);
  const sizes = { small: 3, medium: 40, large: 400 };
  const queries = Array.from({ length: 50 }, () => Array.from({ length: 30 }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' '));
  const report = {};
  for (const [name, pages] of Object.entries(sizes)) {
    const sections = makeDocument(pages, random);
    const characters = sections.reduce((sum, section) => sum + section.text.length, 0);
    const chunking = time(() => buildChunks(sections));
    const chunks = chunking.result;
    const indexing = time(() => buildIndex(chunks), 5);
    const index = indexing.result;
    const scoring = time(() => queries.forEach((query) => scoreChunks(query, index)), 3);
    const sources = time(() => queries.forEach((query) => findMessageSources(query, chunks)), 3);
    report[name] = {
      characters,
      chunks: chunks.length,
      chunkMs: Math.round(chunking.ms * 100) / 100,
      indexMs: Math.round(indexing.ms * 100) / 100,
      scorePerQueryMs: Math.round((scoring.ms / queries.length) * 1000) / 1000,
      sourcesPerMessageMs: Math.round((sources.ms / queries.length) * 1000) / 1000,
    };
  }
  return report;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = { node: process.version, date: new Date().toISOString(), ...run() };
  console.log(JSON.stringify(report, null, 2));
  const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
}
