import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/translate.js';
import Icon from './Icon.jsx';

export default function Dialog({ open, onClose, title, children, variant = 'center', labelId }) {
  const { t } = useI18n();
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const placement = {
    center: 'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl',
    wide: 'm-auto max-h-[92dvh] w-[min(60rem,calc(100vw-1.5rem))] rounded-2xl',
    side: 'my-0 ms-auto me-0 h-dvh max-h-dvh w-[min(30rem,100%)] sm:rounded-s-2xl max-sm:mt-auto max-sm:h-[80dvh] max-sm:w-full max-sm:max-w-full max-sm:rounded-t-2xl',
  }[variant];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      aria-labelledby={labelId}
      className={`${placement} bg-surface p-0 text-ink shadow-2xl backdrop:bg-ink/40`}
    >
      <div className="flex h-full max-h-[inherit] flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id={labelId} className="font-display text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost -me-2 px-2" aria-label={t('dialog.close')}>
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] focus-visible:outline-offset-[-2px]" tabIndex={0} role="region" aria-labelledby={labelId}>
          {open && children}
        </div>
      </div>
    </dialog>
  );
}
