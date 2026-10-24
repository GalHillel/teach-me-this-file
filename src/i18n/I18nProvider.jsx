import { useEffect, useMemo, useState } from 'react';
import { I18nContext, createTranslator, detectUiLanguage, directionOf, rememberUiLanguage } from './translate.js';

export default function I18nProvider({ children }) {
  const [language, setLanguage] = useState(detectUiLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = directionOf(language);
    rememberUiLanguage(language);
  }, [language]);

  const value = useMemo(
    () => ({ language, dir: directionOf(language), t: createTranslator(language), setLanguage }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
