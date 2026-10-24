const SIZE = 3;

const words = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);

export const ngramCounts = (text) => {
  const counts = new Map();
  for (const word of words(text)) {
    const padded = ` ${word} `;
    for (let i = 0; i + SIZE <= padded.length; i += 1) {
      const gram = padded.slice(i, i + SIZE);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  return counts;
};

const weigh = (counts, idf) => {
  const vector = new Map();
  let norm = 0;
  for (const [gram, count] of counts) {
    const weight = (1 + Math.log(count)) * (idf.get(gram) ?? 0);
    if (!weight) continue;
    vector.set(gram, weight);
    norm += weight * weight;
  }
  return { vector, norm: Math.sqrt(norm) };
};

export const buildNgramIndex = (chunks) => {
  const counted = chunks.map((chunk) => ngramCounts(`${chunk.section ?? ''} ${chunk.text}`));
  const df = new Map();
  for (const counts of counted) for (const gram of counts.keys()) df.set(gram, (df.get(gram) ?? 0) + 1);
  const idf = new Map([...df].map(([gram, count]) => [gram, Math.log(1 + chunks.length / count)]));
  return { chunks, idf, docs: counted.map((counts) => weigh(counts, idf)) };
};

export const scoreNgrams = (query, index) => {
  const { vector, norm } = weigh(ngramCounts(query), index.idf);
  return index.docs.map((doc, position) => {
    let dot = 0;
    for (const [gram, weight] of vector) dot += weight * (doc.vector.get(gram) ?? 0);
    return { chunk: index.chunks[position], score: norm && doc.norm ? dot / (norm * doc.norm) : 0 };
  });
};

export const fuseRanks = (rankings, k = 60) => {
  const scores = new Map();
  for (const ranking of rankings) {
    ranking.forEach((id, position) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + position + 1)));
  }
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
};
