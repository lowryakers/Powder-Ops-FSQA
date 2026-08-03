import { parseBlocks } from '../../../shared/rich-markup.js';

// Render the ReadyDoc formatting grammar as HTML.
//
// The same parser the newsletter PDF uses (shared/rich-markup.js), so the
// preview someone sees while writing is the document they'll send. A second
// parser here would drift, and the drift would only show up after the PDF was
// already out.

function Runs({ runs }) {
  return runs.map((r, i) => {
    let node = r.text;
    if (r.code) return <code key={i} className="px-1 py-0.5 rounded bg-gray-100 text-[0.92em] font-mono">{r.text}</code>;
    if (r.bold) node = <strong key={i}>{node}</strong>;
    if (r.italic) node = <em key={i}>{node}</em>;
    if (r.underline) node = <u key={i}>{node}</u>;
    if (r.strike) node = <s key={i}>{node}</s>;
    return <span key={i}>{node}</span>;
  });
}

export default function RichText({ text, className = '' }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        if (b.type === 'spacer') return <div key={i} className="h-2" />;
        if (b.type === 'p') return <p key={i}><Runs runs={b.runs} /></p>;
        const List = b.type === 'ol' ? 'ol' : 'ul';
        return (
          <List key={i} className={`${b.type === 'ol' ? 'list-decimal' : 'list-disc'} list-outside pl-5 my-1`}>
            {b.items.map((runs, k) => <li key={k}><Runs runs={runs} /></li>)}
          </List>
        );
      })}
    </div>
  );
}
