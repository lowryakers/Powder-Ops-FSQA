// The controlled-document renderer, shared.
//
// Extracted from DocumentRegistry so the Auditor View shows a document EXACTLY
// as Document Control sees it. A second renderer would drift, and the first
// sign of the drift would be an auditor reading something that doesn't match
// the approved document.
//
// Deliberately React nodes, never innerHTML — document bodies are text people
// edit, and they must not be able to inject markup.

/* ───────── Minimal, safe Markdown renderer (React nodes, no innerHTML) ───────── */
function renderInline(text, kp) {
  const nodes = [];
  let rest = text;
  let k = 0;
  const pattern = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*|\[(.+?)\]\((https?:\/\/[^\s)]+)\))/;
  while (rest) {
    const m = rest.match(pattern);
    if (!m) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) nodes.push(<strong key={`${kp}-${k++}`}>{m[2]}</strong>);
    else if (tok.startsWith('`')) nodes.push(<code key={`${kp}-${k++}`} className="bg-gray-100 px-1 rounded text-[0.9em]">{m[3]}</code>);
    else if (tok.startsWith('*')) nodes.push(<em key={`${kp}-${k++}`}>{m[4]}</em>);
    else nodes.push(<a key={`${kp}-${k++}`} href={m[6]} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{m[5]}</a>);
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

export default function MarkdownView({ text }) {
  if (!text || !text.trim()) return <p className="text-gray-400 text-sm italic">No content yet.</p>;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    // GFM table: a "| a | b |" header row followed by a "| --- | --- |" separator
    if (t.startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const splitRow = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const header = splitRow(lines[i]); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="text-sm border-collapse border border-gray-300 w-auto">
            <thead className="bg-gray-50"><tr>{header.map((c, j) => <th key={j} className="border border-gray-300 px-2 py-1 text-left font-semibold text-gray-800">{renderInline(c, `th${key}${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{header.map((_, ci) => <td key={ci} className="border border-gray-300 px-2 py-1 text-gray-700 align-top">{renderInline(r[ci] || '', `td${key}${ri}${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl === 1 ? 'text-lg font-bold text-gray-900 mt-3 mb-1' : lvl === 2 ? 'text-base font-semibold text-gray-900 mt-2 mb-1' : 'text-sm font-semibold text-gray-800 mt-2 mb-0.5';
      const Tag = `h${lvl + 2}`;
      blocks.push(<Tag key={key++} className={cls}>{renderInline(h[2], 'h' + key)}</Tag>);
      i++; continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; }
      blocks.push(<ul key={key++} className="list-disc pl-5 space-y-0.5 my-1 text-sm text-gray-700">{items.map((it, j) => <li key={j}>{renderInline(it, `ul${key}${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].trim().replace(/^\d+\.\s+/, '')); i++; }
      blocks.push(<ol key={key++} className="list-decimal pl-5 space-y-0.5 my-1 text-sm text-gray-700">{items.map((it, j) => <li key={j}>{renderInline(it, `ol${key}${j}`)}</li>)}</ol>);
      continue;
    }
    const para = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*]\s|\d+\.\s)/.test(lines[i].trim())) { para.push(lines[i].trim()); i++; }
    blocks.push(<p key={key++} className="text-sm text-gray-700 my-1 leading-relaxed">{renderInline(para.join(' '), 'p' + key)}</p>);
  }
  return <div>{blocks}</div>;
}
