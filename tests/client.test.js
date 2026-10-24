import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../server/errors.js';
import { MESSAGES } from '../src/i18n/messages.js';
import { createTranslator, localizeLabel } from '../src/i18n/translate.js';
import { clearLesson, loadLesson, saveChat, saveLesson } from '../src/lesson/storage.js';

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
};

describe('translations', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const base = (key) => key.replace(/_(one|other)$/, '');

  for (const language of ['he', 'fr']) {
    it(`${language} covers every English key with the same placeholders`, () => {
      const missing = Object.keys(MESSAGES.en).filter((key) => !(key in MESSAGES[language]));
      expect(missing).toEqual([]);
      for (const key of Object.keys(MESSAGES.en)) {
        const expected = placeholders(MESSAGES.en[key]).filter((name) => name !== 'count' || !key.endsWith('_one'));
        const actual = placeholders(MESSAGES[language][key]).filter((name) => name !== 'count' || !key.endsWith('_one'));
        expect([key, actual]).toEqual([key, expected]);
      }
      expect(Object.keys(MESSAGES[language]).filter((key) => !(key in MESSAGES.en) && !(base(key) in MESSAGES.en))).toEqual([]);
    });
  }

  it('has a translated message for every error code the server sends', () => {
    expect(ERROR_CODES.filter((code) => !(`errors.${code}` in MESSAGES.en))).toEqual([]);
  });

  it('fills parameters, picks plural forms and falls back', () => {
    const t = createTranslator('fr');
    expect(t('lesson.stepOf', { current: 2, total: 5 })).toBe('Étape 2 sur 5');
    expect(t('file.pages', { count: 1 })).toBe('1 page');
    expect(t('file.pages', { count: 3 })).toBe('3 pages');
    expect(t('errors.unknown_code', {}, 'Server text')).toBe('Server text');
    expect(createTranslator('xx')('setup.start')).toBe('Start lesson');
  });

  it('uses the Hebrew plural forms', () => {
    const t = createTranslator('he');
    expect(t('file.pages', { count: 1 })).toBe('עמוד אחד');
    expect(t('file.pages', { count: 2 })).toBe('2 עמודים');
    expect(t('file.pages', { count: 12 })).toBe('12 עמודים');
  });

  it('translates passage labels made by the file reader', () => {
    const t = createTranslator('he');
    expect(localizeLabel('Page 4', t)).toBe('עמוד 4');
    expect(localizeLabel('Lines 1–40', t)).toBe('שורות 1–40');
    expect(localizeLabel('Section: Cells', t)).toBe('פרק: Cells');
    expect(localizeLabel('Something else', t)).toBe('Something else');
  });
});

describe('lesson storage', () => {
  const lesson = { id: 'l1', document: { name: 'a.txt', chunks: [] }, plan: { steps: [] }, progress: { status: 'active' }, teacherPrompt: 'x' };

  beforeEach(() => {
    globalThis.sessionStorage = memoryStorage();
  });

  afterEach(() => {
    delete globalThis.sessionStorage;
  });

  it('restores the lesson with the latest chat', () => {
    saveLesson(lesson);
    saveChat('l1', { progress: { status: 'completed' }, messages: [{ id: 'm1' }], notice: null });
    expect(loadLesson()).toEqual({ ...lesson, resume: { progress: { status: 'completed' }, messages: [{ id: 'm1' }], notice: null } });
  });

  it('ignores a chat saved for another lesson', () => {
    saveLesson(lesson);
    saveChat('other', { progress: {}, messages: [] });
    expect(loadLesson().resume).toBe(null);
  });

  it('never stores settings or keys, only the lesson and chat', () => {
    saveLesson({ ...lesson, resume: { progress: {} } });
    const stored = [...globalThis.sessionStorage.data.values()].join('\n');
    expect(stored).not.toMatch(/apiKey|AIza|resume/);
  });

  it('clears everything and survives broken or missing storage', () => {
    saveLesson(lesson);
    clearLesson();
    expect(loadLesson()).toBe(null);

    globalThis.sessionStorage.setItem('tmtf.lesson', '{not json');
    expect(loadLesson()).toBe(null);

    globalThis.sessionStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
    expect(saveLesson(lesson)).toBe(false);
    expect(loadLesson()).toBe(null);
  });
});
