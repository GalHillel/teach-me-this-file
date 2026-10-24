import { localizeLabel, useI18n } from '../i18n/translate.js';
import { highlightPassage } from '../lesson/sources.js';
import Dialog from './Dialog.jsx';

const KINDS = new Set(['based', 'related', 'step']);

export default function SourcePanel({ selection, chunks, onClose }) {
  const { t } = useI18n();
  const chunk = selection ? chunks.find((item) => item.id === selection.source.chunkId) : null;
  const kind = KINDS.has(selection?.source.kind) ? selection.source.kind : 'based';
  return (
    <Dialog
      open={Boolean(chunk)}
      onClose={onClose}
      title={chunk ? t('source.title', { label: localizeLabel(chunk.label, t) }) : t('source.titlePlain')}
      variant="side"
      labelId="source-title"
    >
      {chunk && (
        <div className="space-y-4">
          <p className="text-sm text-muted">{t(`source.explain.${kind}`)}</p>
          <blockquote dir="auto" className="whitespace-pre-wrap rounded-lg border-s-4 border-margin bg-paper px-4 py-3 text-[15px] leading-relaxed">
            {highlightPassage(chunk.text, selection.message.content).map((part) =>
              part.hit ? <mark key={part.key} className="marker">{part.text}</mark> : part.text,
            )}
          </blockquote>
          <p className="text-xs text-muted">{t('source.footer', { name: selection.documentName })}</p>
        </div>
      )}
    </Dialog>
  );
}
