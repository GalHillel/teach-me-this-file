import { UI_LANGUAGES } from '../i18n/messages.js';
import { useI18n } from '../i18n/translate.js';
import Icon from './Icon.jsx';

function LanguagePicker() {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="btn-ghost relative px-2.5">
      <Icon name="globe" className="size-4.5" />
      <span className="text-sm uppercase max-sm:sr-only" aria-hidden="true">{language}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={t('header.language')}
      >
        {UI_LANGUAGES.map((option) => (
          <option key={option.code} value={option.code} lang={option.code}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export default function AppHeader({ keyReady, onOpenSettings, onNewLesson }) {
  const { t } = useI18n();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" className="size-7" />
        <span dir="ltr" className={`whitespace-nowrap font-display text-[17px] font-semibold tracking-tight ${onNewLesson ? 'max-sm:sr-only' : ''}`}>{t('app.name')}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {onNewLesson && (
          <button type="button" onClick={onNewLesson} className="btn-ghost px-3">
            <Icon name="back" className="size-4.5" />
            <span className="whitespace-nowrap">{t('header.newLesson')}</span>
          </button>
        )}
        <LanguagePicker />
        <button type="button" onClick={onOpenSettings} className="btn-secondary px-3">
          <Icon name="key" className="size-4.5" />
          <span className="max-sm:sr-only">{keyReady ? t('header.keyReady') : t('header.addKey')}</span>
          <span className={`size-2 rounded-full ${keyReady ? 'bg-success' : 'bg-margin'}`} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
