import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createProgress } from '../server/lesson/progress.js';
import { openingPraiseFilter, praiseAllowed } from '../server/lesson/calibration.js';

const run = (active, chunks) => {
  const out = [];
  const filter = openingPraiseFilter(active, (text) => out.push(text));
  chunks.forEach((chunk) => filter.push(chunk));
  filter.flush();
  return out.join('');
};

describe('opening praise on an answer that is not right', () => {
  it('drops the praise word at the start of the reply, across stream chunks', () => {
    expect(run(true, ['Gre', 'at! You named ', 'water. What else goes in?'])).toBe('You named water. What else goes in?');
    expect(run(true, ['**Excellent** start, you named water.'])).toBe('You named water.');
    expect(run(true, ['מצוין! ', 'ציינת שהחלקיקים זזים מהר יותר.'])).toBe('ציינת שהחלקיקים זזים מהר יותר.');
    expect(run(true, ['כל הכבוד, התחלה טובה. מה עוד קורה לחלקיקים?'])).toBe('התחלה טובה. מה עוד קורה לחלקיקים?');
    expect(run(true, ['Très bien ! Tu as trouvé l\'eau.'])).toBe('Tu as trouvé l\'eau.');
  });

  it('keeps praise that is not at the start, specific acknowledgements, and everything when the answer was right', () => {
    expect(run(true, ['You\'re right that water comes in through the roots. What about the air?'])).toBe('You\'re right that water comes in through the roots. What about the air?');
    expect(run(true, ['Water is one part. Great that you thought of the roots!'])).toBe('Water is one part. Great that you thought of the roots!');
    expect(run(true, ['Greatness is not the point here.'])).toBe('Greatness is not the point here.');
    expect(run(false, ['Great! That is exactly it.'])).toBe('Great! That is exactly it.');
    expect(run(true, ['Hi'])).toBe('Hi');
  });

  it('applies only when the grade was not correct, or when the tutor must not say yet', () => {
    expect(praiseAllowed({ move: 'advance', assessment: { verdict: 'correct' } })).toBe(true);
    expect(praiseAllowed({ move: 'build_up', assessment: { verdict: 'correct' } })).toBe(true);
    expect(praiseAllowed({ move: 'probe', assessment: { verdict: 'correct' } })).toBe(false);
    expect(praiseAllowed({ move: 'hint', assessment: { verdict: 'partial' } })).toBe(false);
    expect(praiseAllowed({ move: 'final_next', assessment: { verdict: 'incorrect' } })).toBe(false);
    expect(praiseAllowed({ move: 'introduce', assessment: null })).toBe(true);
  });
});

describe('streamed reply to a partial answer', () => {
  it('reaches the student without the opening praise', async () => {
    const plan = {
      title: 'Cells',
      languageCode: 'en',
      audience: 'kids',
      style: '',
      objectives: ['cells'],
      steps: [
        { id: 's1', title: 'What is a cell', goal: 'Cells are units of life', keyConcepts: ['cell'], checkQuestion: 'What is a cell?', successCriteria: 'smallest unit of life', sourceIds: ['c1'] },
        { id: 's2', title: 'Nucleus', goal: 'The nucleus controls the cell', keyConcepts: ['nucleus'], checkQuestion: 'What does the nucleus do?', successCriteria: 'controls the cell', sourceIds: ['c1'] },
      ],
    };
    const provider = {
      name: 'test',
      generateJson: async () => ({ verdict: 'partial', completeness: 0.5, confidence: 'high', conceptsMissing: ['smallest'] }),
      async *streamText() {
        yield 'Great';
        yield ' job! A cell is a unit of life. Which word tells us about its size?';
      },
    };
    const chunk = { id: 'c1', label: 'Page 1', text: 'The cell is the smallest unit of life.' };
    const response = await request(createApp({ providerFor: () => ({ provider, usesServerKey: false }) }))
      .post('/api/turns')
      .send({ kind: 'reply', teacherPrompt: 'Teach kids', plan, progress: createProgress(plan), history: [{ role: 'tutor', content: 'What is a cell?' }], studentMessage: 'A unit of life', sources: { current: [chunk], next: [] } });
    const text = response.text.split('\n\n').filter((block) => block.startsWith('event: delta')).map((block) => JSON.parse(block.split('\n')[1].slice(6)).text).join('');
    expect(text).toBe('A cell is a unit of life. Which word tells us about its size?');
  });
});
