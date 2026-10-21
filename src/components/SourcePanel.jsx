import { highlightPassage } from '../lesson/sources.js';
import Dialog from './Dialog.jsx';

const EXPLANATIONS = {
  match: 'This passage shares the most wording with the tutor\'s message, so the message is most likely based on it.',
  step: 'The tutor\'s message did not reuse wording from the file (for example, because it is in another language). This is the passage the current lesson step was planned from.',
};

export default function SourcePanel({ selection, chunks, onClose }) {
  const chunk = selection ? chunks.find((item) => item.id === selection.source.chunkId) : null;
  return (
    <Dialog open={Boolean(chunk)} onClose={onClose} title={chunk ? `Source: ${chunk.label}` : 'Source'} variant="side" labelId="source-title">
      {chunk && (
        <div className="space-y-4">
          <p className="text-sm text-muted">{EXPLANATIONS[selection.source.kind]}</p>
          <blockquote dir="auto" className="whitespace-pre-wrap rounded-lg border-s-4 border-margin bg-paper px-4 py-3 text-[15px] leading-relaxed">
            {highlightPassage(chunk.text, selection.message.content).map((part) =>
              part.hit ? <mark key={part.key} className="marker">{part.text}</mark> : part.text,
            )}
          </blockquote>
          <p className="text-xs text-muted">Exact text extracted from {selection.documentName}. Highlighted words also appear in the tutor&apos;s message.</p>
        </div>
      )}
    </Dialog>
  );
}
