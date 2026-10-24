import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const CITE_PREFIX = '#cite-';

const linkRenderer = (onCite) =>
  function Link({ href, children }) {
    if (href?.startsWith(CITE_PREFIX) && onCite) {
      return (
        <button type="button" className="cite-chip" onClick={() => onCite(href.slice(CITE_PREFIX.length))}>
          {children}
        </button>
      );
    }
    if (href?.startsWith(CITE_PREFIX)) return <span className="cite-chip">{children}</span>;
    return <a href={href} target="_blank" rel="noreferrer noopener" className="text-pen underline">{children}</a>;
  };

export default function Markdown({ children, onCite }) {
  const components = useMemo(() => ({ a: linkRenderer(onCite) }), [onCite]);
  return (
    <div className="prose-tutor">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false }]]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
