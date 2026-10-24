import { createContext, useContext } from 'react';
import { MESSAGES, UI_LANGUAGES } from './messages.js';

const STORAGE_KEY = 'tmtf.uiLanguage';

const fill = (template, params) => template.replace(/\{(\w+)\}/g, (match, name) => (params[name] ?? match));

export const createTranslator = (language) => {
  const messages = MESSAGES[language] ?? MESSAGES.en;
  const plural = new Intl.PluralRules(language);
  const lookup = (key) => messages[key] ?? MESSAGES.en[key];

  return (key, params = {}, fallback = key) => {
    let template;
    if (typeof params.count === 'number') {
      template = lookup(`${key}_${plural.select(params.count)}`) ?? lookup(`${key}_other`);
    }
    template ??= lookup(key) ?? fallback;
    return fill(template, params);
  };
};

export const directionOf = (language) => UI_LANGUAGES.find((item) => item.code === language)?.dir ?? 'ltr';

export const detectUiLanguage = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (MESSAGES[saved]) return saved;
  } catch {
    return 'en';
  }
  const browser = (navigator.languages ?? [navigator.language]).map((item) => item?.slice(0, 2).toLowerCase());
  return browser.find((code) => MESSAGES[code]) ?? 'en';
};

export const rememberUiLanguage = (language) => {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    return;
  }
};

export const languageName = (code, uiLanguage) => {
  try {
    return new Intl.DisplayNames([uiLanguage], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

const LABEL_PATTERNS = [
  [/^Page (\d+)$/, (t, [, count]) => t('label.page', { count })],
  [/^Lines (\d+)\D+(\d+)$/, (t, [, from, to]) => t('label.lines', { from, to })],
  [/^Section: (.+)$/, (t, [, name]) => t('label.section', { name })],
  [/^Section$/, (t) => t('label.sectionPlain')],
  [/^Beginning$/, (t) => t('label.beginning')],
];

export const localizeLabel = (label, t) => {
  for (const [pattern, render] of LABEL_PATTERNS) {
    const match = label?.match(pattern);
    if (match) return render(t, match);
  }
  return label;
};

export const I18nContext = createContext({ language: 'en', dir: 'ltr', t: createTranslator('en'), setLanguage: () => {} });

export const useI18n = () => useContext(I18nContext);
