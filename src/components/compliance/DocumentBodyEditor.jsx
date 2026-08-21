import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Type, List, ListOrdered, Table as TableIcon,
  AlignLeft, ArrowLeftToLine, ArrowRightToLine, X,
} from 'lucide-react';
import FormatBar from '../common/FormatBar.jsx';
import MarkdownView from '../common/MarkdownView.jsx';
import {
  parseBlocks, serializeBlocks, emptyBlock, BLOCK_LABEL,
  tableAddColumn, tableRemoveColumn, tableAddRow, tableRemoveRow, tableMoveRow, tableFromPaste,
} from '../../../shared/markdown-blocks.js';

/**
 * Write a controlled document without typing Markdown.
 *
 * Document Control stopped using ReadyDoc for the Food Defense Plan because
 * fixing its vulnerability-assessment table meant repairing pipe characters in
 * a monospace box. A table is the one thing a plain textarea is worst at and
 * the one thing an SOP is full of, so it gets a real grid here: cells are
 * inputs, rows and columns are buttons, and the pipes never appear.
 *
 * THE STORAGE IS STILL MARKDOWN. `serializeBlocks` is called on every change
 * and the parent keeps holding the same string it always did — the reader view,
 * the PDF, the Spanish translation, search and print all read it unchanged.
 * The Markdown tab is kept as the escape hatch, so nothing here is a trap: if
 * the editor cannot express something, the text is still right there.
 */
export default function DocumentBodyEditor({ value, onChange, placeholder }) {
  const [mode, setMode] = useState('blocks'); // blocks | markdown | preview
  // THE BLOCKS ARE THE EDITING STATE; the Markdown string is what we publish.
  //
  // Re-parsing our own output on every keystroke would be the obvious
  // implementation and the wrong one: serializing trims each cell, so a space
  // typed between two words would vanish under the caret. So the blocks are
  // re-derived only when the text changes from OUTSIDE — loading a document,
  // an AI proofread, a translation — which is what `lastSerialized` detects.
  const lastSerialized = useRef(null);
  const [blocks, setBlocks] = useState(() => parseBlocks(value || ''));

  useEffect(() => {
    if ((value || '') === lastSerialized.current) return;
    lastSerialized.current = null;
    setBlocks(parseBlocks(value || ''));
  }, [value]);

  const push = (next) => {
    setBlocks(next);
    const text = serializeBlocks(next);
    lastSerialized.current = text;
    onChange(text);
  };

  const update = (id, patch) => push(blocks.map(b => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id) => push(blocks.filter(b => b.id !== id));
  const move = (id, dir) => {
    const i = blocks.findIndex(b => b.id === id);
    const to = i + dir;
    if (i < 0 || to < 0 || to >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[to]] = [next[to], next[i]];
    push(next);
  };
  const insertAfter = (id, type) => {
    const i = blocks.findIndex(b => b.id === id);
    const next = blocks.slice();
    next.splice(i < 0 ? next.length : i + 1, 0, emptyBlock(type));
    push(next);
  };

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-100 bg-gray-50 rounded-t-lg">
        {[['blocks', 'Edit'], ['markdown', 'Markdown'], ['preview', 'Preview']].map(([m, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium ${mode === m ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-gray-400">
          {blocks.length} block{blocks.length === 1 ? '' : 's'}
        </span>
      </div>

      {mode === 'markdown' && (
        <textarea value={value} onChange={e => { lastSerialized.current = null; onChange(e.target.value); }}
          rows={16} spellCheck="true" placeholder={placeholder}
          className="w-full px-3 py-2 text-sm font-mono border-0 rounded-b-lg focus:ring-0" />
      )}

      {mode === 'preview' && (
        <div className="px-4 py-3 min-h-[16rem] bg-white rounded-b-lg prose-sm overflow-x-auto">
          <MarkdownView text={value} />
        </div>
      )}

      {mode === 'blocks' && (
        <div className="p-2 space-y-1.5 bg-gray-50/50 rounded-b-lg">
          {!blocks.length && (
            <p className="text-xs text-gray-400 px-2 py-6 text-center">
              Nothing here yet. Add the first section below.
            </p>
          )}
          {blocks.map((b, i) => (
            <BlockShell key={b.id} block={b} first={i === 0} last={i === blocks.length - 1}
              onMove={(d) => move(b.id, d)} onRemove={() => remove(b.id)} onInsert={(t) => insertAfter(b.id, t)}>
              <BlockBody block={b} onChange={(patch) => update(b.id, patch)} />
            </BlockShell>
          ))}
          <AddBlock onAdd={(t) => push([...blocks, emptyBlock(t)])} />
        </div>
      )}
    </div>
  );
}

const KINDS = [
  ['heading', Type], ['paragraph', AlignLeft], ['bullets', List],
  ['numbered', ListOrdered], ['table', TableIcon],
];

function BlockShell({ block, first, last, onMove, onRemove, onInsert, children }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="group relative rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-100">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {BLOCK_LABEL[block.type] || 'Text'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {/* type="button" everywhere: this editor renders inside the document
              <form>, and a bare button defaults to submit — pressing "add row"
              would save the document. */}
          <button type="button" onClick={() => onMove(-1)} disabled={first}
            className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30" title="Move up"><ChevronUp size={13} /></button>
          <button type="button" onClick={() => onMove(1)} disabled={last}
            className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30" title="Move down"><ChevronDown size={13} /></button>
          <button type="button" onClick={() => setAdding(v => !v)}
            className="p-1 text-gray-300 hover:text-powder-600" title="Insert below"><Plus size={13} /></button>
          <button type="button" onClick={onRemove}
            className="p-1 text-gray-300 hover:text-red-600" title="Delete this block"><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="p-2">{children}</div>
      {adding && (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
          <span className="text-[11px] text-gray-400 mr-1">Insert below:</span>
          {KINDS.map(([kind, Icon]) => (
            <button key={kind} type="button" onClick={() => { onInsert(kind); setAdding(false); }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50">
              <Icon size={11} /> {BLOCK_LABEL[kind]}
            </button>
          ))}
          <button type="button" onClick={() => setAdding(false)} className="p-1 text-gray-300 hover:text-gray-600"><X size={12} /></button>
        </div>
      )}
    </div>
  );
}

function AddBlock({ onAdd }) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1">
      <span className="text-[11px] text-gray-400 mr-1">Add:</span>
      {KINDS.map(([kind, Icon]) => (
        <button key={kind} type="button" onClick={() => onAdd(kind)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-white text-[11px] text-gray-600 hover:bg-gray-50">
          <Icon size={11} /> {BLOCK_LABEL[kind]}
        </button>
      ))}
    </div>
  );
}

function BlockBody({ block, onChange }) {
  if (block.type === 'heading') {
    return (
      <div className="flex items-center gap-2">
        <select value={block.level || 2} onChange={e => onChange({ level: Number(e.target.value) })}
          className="px-1.5 py-1 border border-gray-200 rounded text-xs text-gray-600 shrink-0">
          {[1, 2, 3, 4].map(l => <option key={l} value={l}>H{l}</option>)}
        </select>
        <input value={block.text || ''} onChange={e => onChange({ text: e.target.value })}
          placeholder="Section heading"
          className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm font-semibold text-gray-900" />
      </div>
    );
  }

  if (block.type === 'paragraph') return <ParagraphBlock block={block} onChange={onChange} />;
  if (block.type === 'bullets' || block.type === 'numbered') return <ListBlock block={block} onChange={onChange} />;
  if (block.type === 'table') return <TableBlock block={block} onChange={onChange} />;
  return null;
}

function ParagraphBlock({ block, onChange }) {
  const ref = useRef(null);
  return (
    <div>
      <FormatBar getEl={() => ref.current} value={block.text || ''} onChange={(v) => onChange({ text: v })} />
      <textarea ref={ref} value={block.text || ''} onChange={e => onChange({ text: e.target.value })}
        rows={Math.min(12, Math.max(2, String(block.text || '').split('\n').length + 1))}
        spellCheck="true" placeholder="Body text…"
        className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
    </div>
  );
}

function ListBlock({ block, onChange }) {
  const items = block.items?.length ? block.items : [''];
  const set = (i, v) => onChange({ items: items.map((x, j) => (j === i ? v : x)) });
  const add = (i) => { const n = items.slice(); n.splice(i + 1, 0, ''); onChange({ items: n }); };
  const del = (i) => onChange({ items: items.length > 1 ? items.filter((_, j) => j !== i) : [''] });
  return (
    <div className="space-y-1">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-5 text-right text-xs text-gray-400 shrink-0">
            {block.type === 'numbered' ? `${i + 1}.` : '•'}
          </span>
          <input value={it} onChange={e => set(i, e.target.value)}
            // Enter adds the next item, which is what every list editor does and
            // what stops this feeling like a form.
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(i); } }}
            placeholder="List item" className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm" />
          <button type="button" onClick={() => del(i)} className="p-1 text-gray-300 hover:text-red-600" title="Remove"><X size={12} /></button>
        </div>
      ))}
      <button type="button" onClick={() => add(items.length - 1)}
        className="text-[11px] text-powder-600 hover:underline ml-6">+ Add item</button>
    </div>
  );
}

/**
 * The grid. This is the whole reason the block editor exists.
 *
 * Pasting is the part a word processor does badly: a range copied out of Excel
 * arrives tab-separated, and dropping it into the first cell fills the whole
 * table rather than putting a wall of text in one box.
 */
function TableBlock({ block, onChange }) {
  const header = block.header?.length ? block.header : [''];
  const rows = block.rows || [];
  const apply = (t) => onChange({ header: t.header, rows: t.rows });

  const setHeader = (c, v) => apply({ ...block, header: header.map((x, j) => (j === c ? v : x)) });
  const setCell = (r, c, v) => apply({ ...block, header, rows: rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });

  const onPaste = (e, r, c) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\t') && !text.includes('\n')) return; // an ordinary paste into one cell
    const grid = tableFromPaste(text);
    if (!grid) return;
    e.preventDefault();
    // Pasted into the header row replaces the table; pasted into a body cell it
    // fills from there, so an existing table can be topped up.
    if (r === -1 && c === 0) { apply(grid); return; }
    const cells = [grid.header, ...grid.rows];
    const nextRows = rows.slice();
    cells.forEach((line, ri) => {
      const target = r + ri;
      while (nextRows.length <= target) nextRows.push(Array(header.length).fill(''));
      nextRows[target] = nextRows[target].map((cell, ci) => (ci >= c && line[ci - c] !== undefined ? line[ci - c] : cell));
    });
    apply({ ...block, header, rows: nextRows });
  };

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="w-6" />
              {header.map((h, c) => (
                <th key={c} className="p-0.5 align-bottom">
                  <div className="flex items-center justify-center gap-0.5 pb-0.5">
                    <button type="button" onClick={() => apply(tableAddColumn(block, c))}
                      className="p-0.5 text-gray-300 hover:text-powder-600" title="Insert column before"><ArrowLeftToLine size={10} /></button>
                    <button type="button" onClick={() => apply(tableRemoveColumn(block, c))}
                      className="p-0.5 text-gray-300 hover:text-red-600" title="Delete column"><X size={10} /></button>
                    <button type="button" onClick={() => apply(tableAddColumn(block, c + 1))}
                      className="p-0.5 text-gray-300 hover:text-powder-600" title="Insert column after"><ArrowRightToLine size={10} /></button>
                  </div>
                  <input value={h} onChange={e => setHeader(c, e.target.value)}
                    onPaste={e => onPaste(e, -1, c)}
                    placeholder={`Column ${c + 1}`}
                    className="w-36 px-1.5 py-1 border border-gray-300 rounded text-xs font-semibold bg-gray-50" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="align-middle">
                  <div className="flex flex-col items-center">
                    <button type="button" onClick={() => apply(tableMoveRow(block, r, -1))} disabled={r === 0}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-20" title="Move row up"><ChevronUp size={11} /></button>
                    <button type="button" onClick={() => apply(tableRemoveRow(block, r))}
                      className="text-gray-300 hover:text-red-600" title="Delete row"><X size={11} /></button>
                    <button type="button" onClick={() => apply(tableMoveRow(block, r, 1))} disabled={r === rows.length - 1}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-20" title="Move row down"><ChevronDown size={11} /></button>
                  </div>
                </td>
                {row.map((cell, c) => (
                  <td key={c} className="p-0.5">
                    <textarea value={cell} onChange={e => setCell(r, c, e.target.value)}
                      onPaste={e => onPaste(e, r, c)} rows={1}
                      onInput={e => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; }}
                      className="w-36 px-1.5 py-1 border border-gray-200 rounded text-xs resize-none align-top" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => apply(tableAddRow(block))}
          className="inline-flex items-center gap-1 text-[11px] text-powder-600 hover:underline"><Plus size={11} /> Add row</button>
        <button type="button" onClick={() => apply(tableAddColumn(block))}
          className="inline-flex items-center gap-1 text-[11px] text-powder-600 hover:underline"><Plus size={11} /> Add column</button>
        <span className="text-[11px] text-gray-400">
          Paste a range from Excel into any cell to fill the grid.
        </span>
      </div>
    </div>
  );
}
