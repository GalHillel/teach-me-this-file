import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { orderByPrerequisites } from '../server/lesson/ordering.js';
import { validatePlan } from '../server/lesson/planner.js';

const chunks = [{ id: 'c1', label: 'Page 1', text: 'Cells, energy and photosynthesis.' }];
const step = (title, prerequisites = []) => ({ title, checkQuestion: `${title}?`, prerequisites });

describe('orderByPrerequisites', () => {
  it('keeps the original order when it already respects the prerequisites', () => {
    expect(orderByPrerequisites(3, (index) => (index ? [index - 1] : [])).order).toEqual([0, 1, 2]);
  });

  it('moves a step after the steps it needs, otherwise keeping the original order', () => {
    const needs = { 0: [2], 1: [], 2: [], 3: [0] };
    expect(orderByPrerequisites(4, (index) => needs[index]).order).toEqual([1, 2, 0, 3]);
  });

  it('breaks a cycle deterministically and reports the broken edge', () => {
    const needs = { 0: [1], 1: [0], 2: [] };
    const result = orderByPrerequisites(3, (index) => needs[index]);
    expect(result.order).toEqual([2, 0, 1]);
    expect(result.brokenEdges).toEqual([[1, 0]]);
  });

  it('ignores references to itself or to steps that do not exist', () => {
    expect(orderByPrerequisites(2, () => [0, 5, -1]).order).toEqual([0, 1]);
  });

  it('respects every edge of any acyclic graph, and every prefix contains its prerequisites', () => {
    const dag = fc.integer({ min: 1, max: 10 }).chain((count) => fc.tuple(
      fc.constant(count),
      fc.array(fc.tuple(fc.nat(count - 1), fc.nat(count - 1)), { maxLength: 25 }).map((pairs) => pairs.filter(([a, b]) => a < b)),
      fc.shuffledSubarray([...Array(count).keys()], { minLength: count, maxLength: count }),
    ));
    fc.assert(fc.property(dag, ([count, edges, labels]) => {
      const needs = Array.from({ length: count }, () => []);
      for (const [before, after] of edges) needs[labels[after]].push(labels[before]);
      const { order, brokenEdges } = orderByPrerequisites(count, (index) => needs[index]);
      expect([...order].sort((a, b) => a - b)).toEqual([...Array(count).keys()]);
      expect(brokenEdges).toEqual([]);
      for (let cut = 1; cut <= count; cut += 1) {
        const prefix = new Set(order.slice(0, cut));
        for (const index of prefix) expect(needs[index].every((other) => prefix.has(other))).toBe(true);
      }
    }), { numRuns: 300 });
  });

  it('always returns every step once, even with cycles, and reports each violated edge', () => {
    const graph = fc.integer({ min: 1, max: 9 }).chain((count) => fc.tuple(fc.constant(count), fc.array(fc.tuple(fc.nat(count - 1), fc.nat(count - 1)), { maxLength: 30 })));
    fc.assert(fc.property(graph, ([count, edges]) => {
      const needs = Array.from({ length: count }, () => []);
      for (const [before, after] of edges) needs[after].push(before);
      const { order, brokenEdges } = orderByPrerequisites(count, (index) => needs[index]);
      expect([...order].sort((a, b) => a - b)).toEqual([...Array(count).keys()]);
      const place = new Map(order.map((index, position) => [index, position]));
      const violated = edges.filter(([before, after]) => before !== after && place.get(before) > place.get(after));
      for (const [before, after] of violated) expect(brokenEdges).toContainEqual([before, after]);
    }), { numRuns: 300 });
  });
});

describe('validatePlan with prerequisites', () => {
  it('reorders steps so prerequisites come first and turns numbers into step ids', () => {
    const plan = validatePlan({ steps: [step('Equation', [2, 3]), step('Chlorophyll'), step('Inputs')] }, chunks, { fallbackTitle: 'f' });
    expect(plan.steps.map((item) => item.title)).toEqual(['Chlorophyll', 'Inputs', 'Equation']);
    expect(plan.steps[2].prerequisites).toEqual(['s1', 's2']);
    expect(plan.warnings).not.toContain('prerequisite_cycle');
  });

  it('maps prerequisites correctly when the model gives a step that is dropped', () => {
    const plan = validatePlan({ steps: [step('Intro'), { title: 'No question' }, step('Details', [1])] }, chunks, { fallbackTitle: 'f' });
    expect(plan.steps.map((item) => [item.id, item.title, item.prerequisites])).toEqual([['s1', 'Intro', []], ['s2', 'Details', ['s1']]]);
  });

  it('keeps every prerequisite of the steps that fit the step limit', () => {
    const plan = validatePlan({ steps: [step('Advanced', [3]), step('Unrelated'), step('Basics')] }, chunks, { fallbackTitle: 'f', maxSteps: 2 });
    expect(plan.steps.map((item) => item.title)).toEqual(['Unrelated', 'Basics']);
  });

  it('warns about a prerequisite cycle and still returns all steps', () => {
    const plan = validatePlan({ steps: [step('A', [2]), step('B', [1])] }, chunks, { fallbackTitle: 'f' });
    expect(plan.steps).toHaveLength(2);
    expect(plan.warnings).toContain('prerequisite_cycle');
    expect(plan.steps.map((item) => [item.id, item.title, item.prerequisites])).toEqual([['s1', 'A', []], ['s2', 'B', ['s1']]]);
  });

  it('never lists a later step as a prerequisite', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 8 }).chain((count) => fc.array(fc.array(fc.integer({ min: 1, max: count }), { maxLength: 3 }), { minLength: count, maxLength: count })),
      fc.integer({ min: 2, max: 8 }),
      (edges, maxSteps) => {
        const plan = validatePlan({ steps: edges.map((prerequisites, index) => step(`Step ${index}`, prerequisites)) }, chunks, { fallbackTitle: 'f', maxSteps });
        return plan.steps.every((item, index) => item.prerequisites.every((id) => Number(id.slice(1)) - 1 < index));
      },
    ));
  });
});
