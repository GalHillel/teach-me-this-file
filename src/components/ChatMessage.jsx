import { memo } from 'react';
import { localizeLabel, useI18n } from '../i18n/translate.js';
import Icon from './Icon.jsx';
import Markdown from './Markdown.jsx';

const VERDICT_STYLES = {
  correct: 'bg-success-soft text-success',
  partial: 'bg-marker-soft text-ink',
  incorrect: 'bg-danger-soft text-danger',
  question: 'bg-pen-soft text-pen',
  off_topic: 'bg-rule text-muted',
  unclear: 'bg-rule text-muted',
};

const MOVE_STYLES = {
  hint: 'bg-marker-soft text-ink',
  reteach: 'bg-marker-soft text-ink',
  rephrase: 'bg-pen-soft text-pen',
  review_question: 'bg-pen-soft text-pen',
  review_next: 'bg-pen-soft text-pen',
  review_finish: 'bg-success-soft text-success',
  probe: 'bg-pen-soft text-pen',
  reveal_and_recheck: 'bg-marker-soft text-ink',
  finish: 'bg-success-soft text-success',
  review_and_finish: 'bg-success-soft text-success',
};

const SOURCE_STYLES = {
  based: 'border-line text-muted hover:border-pen hover:text-pen',
  related: 'border-dashed border-line text-muted hover:border-pen hover:text-pen',
  step: 'border-dashed border-line text-muted hover:border-pen hover:text-pen',
};

function SourceLinks({ message, chunkLabels, onOpenSource }) {
  const { t } = useI18n();
  if (message.status !== 'done') return null;
  if (message.sources.length === 0) {
    return <p className="mt-2 text-xs text-muted">{t('chat.noSource')}</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {message.sources.map((source) => {
        const kind = SOURCE_STYLES[source.kind] ? source.kind : 'based';
        return (
          <button
            key={source.chunkId}
            type="button"
            onClick={() => onOpenSource(message, source)}
            className={`inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-xs ${SOURCE_STYLES[kind]}`}
          >
            <Icon name="quote" className="size-3.5" />
            {t(`chat.source.${kind}`, { label: localizeLabel(chunkLabels.get(source.chunkId), t) ?? '' })}
          </button>
        );
      })}
    </div>
  );
}

function SystemNote({ note }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-muted" role="note">
      <span className="h-px flex-1 bg-line" />
      <span className="max-w-[80%] text-center">
        {t(note.code === 'review_item' ? `note.review_item_${note.result}` : `note.${note.code}`, { ...note, next: `\u2068${note.next ?? ''}\u2069` })}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function ChatMessage({ message, chunkLabels, onOpenSource }) {
  const { t } = useI18n();

  if (message.role === 'system') return message.note ? <SystemNote note={message.note} /> : null;

  if (message.role === 'student') {
    const assessment = message.assessment;
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="sr-only">{t('chat.youSaid')}</span>
        <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-md bg-pen px-4 py-2.5 text-[15px] leading-relaxed text-white">
          {message.content}
        </div>
        {assessment && VERDICT_STYLES[assessment.verdict] && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${VERDICT_STYLES[assessment.verdict]}`}>
            {t(`verdict.${assessment.verdict}`)}
            {assessment.confidence === 'low' && ` (${t('verdict.lowConfidence')})`}
          </span>
        )}
      </div>
    );
  }

  const streaming = message.status === 'streaming' || message.status === 'pending';
  const moveStyle = MOVE_STYLES[message.move] ?? 'bg-rule text-muted';
  return (
    <article className="max-w-[min(100%,42rem)] scroll-mt-4 outline-none" aria-busy={streaming} data-step-index={message.stepIndex} tabIndex={-1}>
      <p className="mb-1 flex items-center gap-2 text-xs font-medium text-pen">
        {t('chat.tutor')}
        {message.move && <span className={`rounded-full px-2 py-0.5 font-normal ${moveStyle}`}>{t(`move.${message.move}`)}</span>}
      </p>
      <div dir="auto" className={`text-[15.5px] text-ink ${message.status === 'streaming' ? 'streaming-caret' : ''}`}>
        <Markdown>{message.content}</Markdown>
      </div>
      {message.status === 'stopped' && <p className="mt-1.5 text-xs text-muted">{t('chat.stopped')}</p>}
      <SourceLinks message={message} chunkLabels={chunkLabels} onOpenSource={onOpenSource} />
    </article>
  );
}

export default memo(ChatMessage);
