import { readFileSync } from 'node:fs';
import { findMessageSources } from '../src/lesson/sources.js';

const golden = JSON.parse(readFileSync(new URL('./golden/sources.json', import.meta.url), 'utf8'));

export const scoreSourceMatching = (match = (message, chunks) => findMessageSources(message, chunks, [])) => {
  const rows = golden.cases.map((item) => {
    const chunks = golden.documents[item.doc];
    const matches = match(item.message, chunks).filter((source) => source.kind === 'based' || source.kind === 'match');
    const found = matches[0]?.chunkId ?? null;
    const extra = matches.slice(1).filter((source) => source.chunkId !== item.expected).length;
    const anywhere = matches.some((source) => source.chunkId === item.expected);
    return { id: item.id, expected: item.expected, found, extra, anywhere, ok: found === item.expected };
  });
  const withSource = rows.filter((row) => row.expected);
  const withoutSource = rows.filter((row) => !row.expected);
  return {
    rows,
    accuracy: rows.filter((row) => row.ok).length / rows.length,
    top1: withSource.filter((row) => row.ok).length / withSource.length,
    shown: withSource.filter((row) => row.anywhere).length / withSource.length,
    falseMatches: withoutSource.filter((row) => row.found).length,
    missed: withSource.filter((row) => !row.found).length,
    wrong: withSource.filter((row) => row.found && !row.ok).length,
    extraSources: rows.reduce((sum, row) => sum + row.extra, 0),
    cases: rows.length,
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = scoreSourceMatching();
  for (const row of result.rows) {
    console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.id.padEnd(10)} expected=${row.expected ?? '-'} found=${row.found ?? '-'}${row.extra ? ` extra=${row.extra}` : ''}`);
  }
  console.log(`cases=${result.cases} top1=${(result.top1 * 100).toFixed(0)}% shown=${(result.shown * 100).toFixed(0)}% wrong=${result.wrong} missed=${result.missed} falseMatches=${result.falseMatches} extraSources=${result.extraSources} accuracy=${(result.accuracy * 100).toFixed(0)}%`);
}
