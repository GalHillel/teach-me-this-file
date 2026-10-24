import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-pen underline">{children}</a>,
};

export default function Markdown({ children }) {
  return (
    <div className="prose-tutor">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false }]]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
