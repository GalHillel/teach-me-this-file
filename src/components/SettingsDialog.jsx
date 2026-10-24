import { useState } from 'react';
import { useI18n } from '../i18n/translate.js';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';

const PROVIDERS = [
  { value: 'auto', labelKey: 'settings.auto' },
  { value: 'gemini', label: 'Google AI Studio (Gemini)' },
  { value: 'groq', label: 'Groq' },
  { value: 'openrouter', label: 'OpenRouter' },
  ...(import.meta.env.DEV ? [{ value: 'mock', labelKey: 'settings.mock' }] : []),
];

const detectProvider = (key) => {
  if (key.startsWith('AIza')) return 'Gemini';
  if (key.startsWith('gsk_')) return 'Groq';
  if (key.startsWith('sk-or-')) return 'OpenRouter';
  return null;
};

function SettingsForm({ settings, serverKey, onSave }) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [provider, setProvider] = useState(settings.provider);
  const [visible, setVisible] = useState(false);
  const detected = detectProvider(apiKey.trim());

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ apiKey: apiKey.trim(), provider });
      }}
    >
      <div>
        <label htmlFor="api-key" className="mb-1.5 block text-sm font-medium">{t('settings.key')}</label>
        <div className="relative">
          <input
            id="api-key"
            type={visible ? 'text' : 'password'}
            autoComplete="off"
            spellCheck="false"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t('settings.placeholder')}
            className="field pe-11 font-mono text-sm"
            aria-describedby="api-key-help"
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted hover:text-ink"
            aria-label={visible ? t('settings.hide') : t('settings.show')}
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} className="size-4.5" />
          </button>
        </div>
        <p id="api-key-help" className="mt-1.5 text-sm text-muted">
          {apiKey.trim() && provider === 'auto'
            ? detected ? t('settings.looksLike', { provider: detected }) : t('settings.unknownFormat')
            : t('settings.freeKeys')}
        </p>
      </div>

      <div>
        <label htmlFor="provider" className="mb-1.5 block text-sm font-medium">{t('settings.provider')}</label>
        <select id="provider" value={provider} onChange={(event) => setProvider(event.target.value)} className="field">
          {PROVIDERS.map((option) => (
            <option key={option.value} value={option.value}>{option.labelKey ? t(option.labelKey) : option.label}</option>
          ))}
        </select>
      </div>

      <p className="rounded-lg bg-pen-soft px-3.5 py-3 text-sm leading-relaxed text-ink">
        {t('settings.privacy')}
        {serverKey && ` ${t('settings.serverKey')}`}
      </p>

      <div className="flex justify-end gap-2">
        {apiKey && (
          <button type="button" className="btn-ghost" onClick={() => setApiKey('')}>{t('settings.clear')}</button>
        )}
        <button type="submit" className="btn-primary">{t('settings.save')}</button>
      </div>
    </form>
  );
}

export default function SettingsDialog({ open, onClose, settings, serverKey, onSave }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t('settings.title')} labelId="settings-title">
      <SettingsForm
        settings={settings}
        serverKey={serverKey}
        onSave={(next) => {
          onSave(next);
          onClose();
        }}
      />
    </Dialog>
  );
}
