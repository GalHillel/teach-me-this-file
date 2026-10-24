export const orderByPrerequisites = (count, prerequisitesOf) => {
  const needs = Array.from({ length: count }, (_, index) => new Set((prerequisitesOf(index) ?? []).filter((other) => other !== index && other >= 0 && other < count)));
  const placed = new Set();
  const order = [];
  const brokenEdges = [];

  while (order.length < count) {
    const ready = [];
    for (let index = 0; index < count; index += 1) {
      if (!placed.has(index) && [...needs[index]].every((other) => placed.has(other))) ready.push(index);
    }
    const next = ready.length
      ? ready[0]
      : [...Array(count).keys()].find((index) => !placed.has(index));
    if (!ready.length) {
      for (const other of needs[next]) {
        if (!placed.has(other)) brokenEdges.push([other, next]);
      }
    }
    placed.add(next);
    order.push(next);
  }

  return { order, brokenEdges };
};
