import Icon from './Icon.jsx';

export default function AppHeader({ keyReady, onOpenSettings, onNewLesson }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" className="size-7" />
        <span className={`whitespace-nowrap font-display text-[17px] font-semibold tracking-tight ${onNewLesson ? 'max-sm:sr-only' : ''}`}>Teach Me This File</span>
      </div>
      <div className="flex items-center gap-1.5">
        {onNewLesson && (
          <button type="button" onClick={onNewLesson} className="btn-ghost px-3">
            <Icon name="back" className="size-4.5" />
            <span className="whitespace-nowrap">New lesson</span>
          </button>
        )}
        <button type="button" onClick={onOpenSettings} className="btn-secondary px-3">
          <Icon name="key" className="size-4.5" />
          <span className="max-sm:sr-only">{keyReady ? 'Key ready' : 'Add API key'}</span>
          <span className={`size-2 rounded-full ${keyReady ? 'bg-success' : 'bg-margin'}`} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
