const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

const between = (text, tag) => text.split(`<${tag}>`)[1]?.split(`</${tag}>`)[0]?.trim() ?? '';

const mockPlan = (prompt) => {
  const ids = [...prompt.matchAll(/\[(c\d+) \|/g)].map((match) => match[1]);
  const hebrew = /[\u0590-\u05FF]/.test(between(prompt, 'teacher_instructions'));
  return {
    title: 'Mock lesson',
    languageCode: hebrew ? 'he' : 'en',
    audience: 'Test students',
    durationMinutes: 10,
    style: 'Short explanations followed by a question.',
    objectives: ['Understand the first idea', 'Understand the second idea'],
    steps: [0, 1, 2].map((index) => ({
      title: `Idea ${index + 1}`,
      goal: `Understand idea ${index + 1}`,
      keyConcepts: [`${['alpha', 'beta', 'gamma'][index]} term`],
      checkQuestion: `What is idea ${index + 1} about?`,
      successCriteria: 'Mentions the main point.',
      prerequisites: index ? [index] : [],
      sourceIds: ids.slice(index, index + 1),
    })),
    notes: '',
  };
};

const mockAssessment = (prompt) => {
  const answer = between(prompt, 'student_message').toLowerCase();
  const base = { conceptsShown: [], conceptsMissing: [], misconception: '', evidence: '', confidence: 'high', issue: 'none' };
  if (answer.includes('gap')) return { ...base, verdict: 'incorrect', completeness: 0, conceptsMissing: ['alpha term'], missingPrerequisite: 1 };
  if (answer.includes('no idea')) return { ...base, verdict: 'incorrect', completeness: 0, issue: 'no_knowledge' };
  if (answer.includes('other question')) return { ...base, verdict: 'incorrect', completeness: 0, issue: 'misread_question' };
  if (answer.includes('wrong')) {
    return { ...base, verdict: 'incorrect', completeness: 0, conceptsMissing: ['the main point'], misconception: 'confused the idea' };
  }
  if (answer.includes('partly')) return { ...base, verdict: 'partial', completeness: 0.5, conceptsShown: ['part of it'], conceptsMissing: ['the rest'] };
  if (answer.includes('off topic')) return { ...base, verdict: 'off_topic', completeness: 0 };
  if (answer.endsWith('?')) return { ...base, verdict: 'question', completeness: 0 };
  return { ...base, verdict: 'correct', completeness: 1, conceptsShown: ['the main point'], confidence: answer.includes('maybe') ? 'low' : 'high' };
};

export const createMockProvider = ({ delayMs = 40 } = {}) => ({
  name: 'mock',
  model: 'mock',

  async generateJson({ task, prompt, signal, onMeta }) {
    await wait(delayMs * 5, signal);
    onMeta?.({ model: 'mock', backup: false, fallbacks: 0 });
    return task === 'plan' ? mockPlan(prompt) : mockAssessment(prompt);
  },

  async *streamText({ system, messages = [], signal, onMeta }) {
    onMeta?.({ model: 'mock', backup: false, fallbacks: 0 });
    const slow = /slowly/i.test(messages.at(-1)?.content ?? '');
    const block = between(system, 'sources');
    const id = block.match(/^\[(c\d+) \|/m)?.[1];
    const lines = block.split('\n').filter((line) => line && !line.startsWith('['));
    const source = lines.find((line) => !line.startsWith('#') && line.split(/\s+/).length >= 4) ?? lines[0] ?? '';
    const words = source.replace(/^#+\s*/, '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
    const invented = /fake quote/i.test(messages.at(-1)?.content ?? '');
    const quote = invented ? 'the moon is made of green cheese' : words;
    const reply = `Mock tutor reply. The source says "${quote}"${id ? ` [${id}]` : ''}. What do you think this means?`;
    for (const word of reply.split(/(?<= )/)) {
      await wait(slow ? delayMs * 40 : delayMs, signal);
      yield word;
    }
  },
});
