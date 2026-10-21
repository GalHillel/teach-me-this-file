import { memo } from 'react';
import { VERDICT_LABELS } from '../lesson/chatReducer.js';
import Icon from './Icon.jsx';
import Markdown from './Markdown.jsx';

const VERDICT_STYLES = {
  correct: 'bg-success-soft text-success',
  partial: 'bg-marker-soft text-ink',
  incorrect: 'bg-danger-soft text-danger',
  question: 'bg-pen-soft text-pen',
  off_topic: 'bg-rule text-muted',
};

function SourceLinks({ message, chunkLabels, onOpenSource }) {
  if (message.status !== 'done') return null;
  if (message.sources.length === 0) {
    return <p className="mt-2 text-xs text-muted">No matching passage in the file for this message.</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {message.sources.map((source) => (
        <button
          key={source.chunkId}
          type="button"
          onClick={() => onOpenSource(message, source)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted hover:border-pen hover:text-pen"
        >
          <Icon name="quote" className="size-3.5" />
          Source: {chunkLabels.get(source.chunkId) ?? 'passage'}
        </button>
      ))}
    </div>
  );
}

function ChatMessage({ message, chunkLabels, onOpenSource }) {
  if (message.role === 'system') {
    return (
      <div className="flex items-center gap-3 py-1 text-xs text-muted" role="note">
        <span className="h-px flex-1 bg-line" />
        <span className="max-w-[80%] text-center" dir="auto">{message.content}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }

  if (message.role === 'student') {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="sr-only">You said:</span>
        <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-md bg-pen px-4 py-2.5 text-[15px] leading-relaxed text-white">
          {message.content}
        </div>
        {message.verdict && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${VERDICT_STYLES[message.verdict]}`}>{VERDICT_LABELS[message.verdict]}</span>
        )}
      </div>
    );
  }

  const streaming = message.status === 'streaming' || message.status === 'pending';
  return (
    <article className="max-w-[min(100%,42rem)]" aria-busy={streaming}>
      <p className="mb-1 text-xs font-medium text-pen">Tutor</p>
      <div dir="auto" className={`text-[15.5px] text-ink ${message.status === 'streaming' ? 'streaming-caret' : ''}`}>
        <Markdown>{message.content}</Markdown>
      </div>
      {message.status === 'stopped' && <p className="mt-1.5 text-xs text-muted">Stopped before the end. The lesson state was not changed.</p>}
      <SourceLinks message={message} chunkLabels={chunkLabels} onOpenSource={onOpenSource} />
    </article>
  );
}

export default memo(ChatMessage);
