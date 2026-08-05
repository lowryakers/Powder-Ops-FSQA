import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { listPrefix } from '../../shared/rich-markup.js';
import { wrapSelection } from './textFormat';

/**
 * The keyboard half of the composer's formatting.
 *
 * The toolbar was the only way to mark text up, which meant everyone who types
 * Ctrl+B by reflex — which is everyone — got nothing and concluded the composer
 * couldn't do it. Same grammar, same helpers, just reachable from the keyboard.
 *
 * Three behaviours:
 *   Ctrl/Cmd + B / I / U      wrap the selection, exactly as the toolbar does
 *   Enter on a list line      continue the list; on an EMPTY item, end it
 *   Tab / Shift+Tab           indent / outdent, but only on a list line
 *
 * TAB IS DELIBERATELY CONDITIONAL. Swallowing Tab everywhere would trap
 * keyboard users in the textarea — it is how you reach the Send button, and in
 * comms it is how you pick an @mention. So it only indents when the caret is
 * actually on a list line, and otherwise does nothing and lets focus move.
 *
 * The caller keeps ownership of the value and of its own key handling: this
 * returns true when it consumed the event, so a composer can run its @mention
 * and send logic first and only then defer to this.
 */
export function formatKeyHandler({ getEl, value, onChange, enabled = true }) {
  return (e) => {
    if (!enabled) return false;
    const el = getEl?.();
    if (!el) return false;
    const v = value ?? '';

    /**
     * Commit the new text and put the caret where it belongs — SYNCHRONOUSLY.
     *
     * The obvious version defers the caret to a requestAnimationFrame, and it
     * is wrong for a keyboard shortcut: anything typed inside that frame lands
     * at the OLD caret position and is then jumped over. Typing Ctrl+B then
     * "Blender 1" without pausing produced `*lender 1*B` — reliably, and only
     * for people who type quickly, which is the worst kind of bug to be told
     * about. flushSync lands the value in the DOM before this call returns, so
     * setSelectionRange has something real to aim at and the next keystroke
     * finds the caret already correct.
     */
    const apply = (r) => {
      flushSync(() => onChange(r.next));
      el.focus();
      el.setSelectionRange(r.selStart, r.selEnd);
    };

    // ── Ctrl/Cmd + B / I / U ────────────────────────────────────────────────
    // metaKey on a Mac, ctrlKey elsewhere. Alt is excluded so Alt+Ctrl combos
    // (which produce real characters on several keyboard layouts) still type.
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const marker = k === 'b' ? '*' : k === 'i' ? '_' : k === 'u' ? '__' : null;
      if (marker) {
        e.preventDefault();
        apply(wrapSelection(el, v, marker));
        return true;
      }
      return false;
    }

    const start = el.selectionStart, end = el.selectionEnd;
    const lineStart = v.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = v.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = v.length;
    const line = v.slice(lineStart, lineEnd);
    const pfx = listPrefix(line);

    // ── Tab indents a list line ─────────────────────────────────────────────
    if (e.key === 'Tab' && pfx && start === end) {
      e.preventDefault();
      const outdent = e.shiftKey;
      if (outdent && !pfx.indent) return true; // already flush left; nothing to do
      const indent = outdent ? pfx.indent.slice(2) : `${pfx.indent}  `;
      const rest = line.slice(pfx.indent.length);
      const next = v.slice(0, lineStart) + indent + rest + v.slice(lineEnd);
      const delta = indent.length - pfx.indent.length;
      apply({ next, selStart: start + delta, selEnd: start + delta });
      return true;
    }

    // ── Enter continues the list ────────────────────────────────────────────
    // Only for a plain Enter with no selection. Shift+Enter is a soft break and
    // Ctrl/Cmd+Enter is "send" in some composers — neither should make a bullet.
    if (e.key === 'Enter' && pfx && start === end && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      // Enter on an item you haven't typed into means "I'm done with the list",
      // which is what every editor does and what people expect. Clearing the
      // marker rather than inserting another is the whole behaviour.
      if (!pfx.content.trim()) {
        e.preventDefault();
        const next = v.slice(0, lineStart) + v.slice(lineEnd);
        apply({ next, selStart: lineStart, selEnd: lineStart });
        return true;
      }
      e.preventDefault();
      const marker = pfx.kind === 'ol'
        ? `${pfx.indent}${pfx.n + 1}${pfx.dot}${pfx.space}`
        : `${pfx.indent}${pfx.marker}${pfx.space}`;
      const next = v.slice(0, start) + '\n' + marker + v.slice(end);
      const caret = start + 1 + marker.length;
      apply({ next, selStart: caret, selEnd: caret });
      return true;
    }

    return false;
  };
}

/**
 * The hook form, for a composer with one textarea.
 *
 * A caller that renders N textareas from a `.map()` — the newsletter's sections
 * — can't call a hook per item, so it uses `formatKeyHandler` directly.
 */
export function useFormatKeys(opts) {
  const { getEl, value, onChange, enabled = true } = opts;
  return useCallback(
    (e) => formatKeyHandler({ getEl, value, onChange, enabled })(e),
    [getEl, value, onChange, enabled],
  );
}
