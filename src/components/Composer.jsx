import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/translate.js';
import Icon from './Icon.jsx';

const MAX_LENGTH = 2000;

export default function Composer({ busy, completed, onSend, onStop }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const input = inputRef.current;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [text]);

  useEffect(() => {
    if (!busy && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [busy]);

  const submit = () => {
    const message = text.trim();
    if (!message || busy) return;
    onSend(message);
    setText('');
  };

  return (
    <form
      className="border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <label htmlFor="answer" className="sr-only">{t('composer.label')}</label>
        <textarea
          id="answer"
          ref={inputRef}
          dir="auto"
          rows={1}
          maxLength={MAX_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={completed ? t('composer.followUp') : t('composer.placeholder')}
          className="field min-h-11 resize-none py-2.5 leading-normal"
        />
        {busy ? (
          <button type="button" onClick={onStop} className="btn-secondary size-11 shrink-0 p-0 text-danger" aria-label={t('composer.stop')}>
            <Icon name="stop" className="size-4.5" />
          </button>
        ) : (
          <button type="submit" disabled={!text.trim()} className="btn-primary size-11 shrink-0 p-0" aria-label={t('composer.send')}>
            <Icon name="send" className="size-5" />
          </button>
        )}
      </div>
      <p className="mx-auto mt-1.5 hidden max-w-3xl text-xs text-muted sm:block">{t('composer.hint')}</p>
    </form>
  );
}
