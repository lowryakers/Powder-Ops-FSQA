import { useState, useEffect, useCallback, useRef, useMemo, Fragment, memo } from 'react';
import { createPortal } from 'react-dom';
import { useApiGet, apiFetch, apiPost, apiPut, apiUpload } from '../../hooks/useApi';
import { getSocket } from '../../lib/socket';
import { useDragPager } from '../../lib/useDragPager';
import { setAppBadge } from '../../lib/appBadge';
import { notifyDataChanged } from '../../lib/dataChanged';
import { Share2, Hash, Lock, Send, Plus, X, MessageSquare, ArrowLeft, Smile, Edit2, Trash2, Paperclip, FileText, Download, Search, Loader2, Sparkles, Languages, Bell, BellOff, CalendarDays, Home, Settings, CheckCheck, Megaphone, UserPlus, UserMinus, Users, ChevronDown, ChevronLeft, ChevronRight, Check, LogOut, Copy, MoreVertical, ClipboardCheck, ExternalLink, Columns2, Clock, Film, ChevronUp, Forward, Mic, Camera, CornerUpLeft } from 'lucide-react';
import CommsSettings from './CommsSettings.jsx';
import { shareFile as shareAttachment, canNativeShare } from '../../lib/shareFile.js';
import NotificationStatus from './NotificationStatus.jsx';
import ZoomableImage from './ZoomableImage.jsx';
import { useSwipeBack } from '../../lib/useSwipeBack';
import { useCompactLayout } from '../../lib/useCompactLayout.js';
import { useSeenAfterDwell } from '../../lib/useSeenAfterDwell.js';
import FormatBar from '../common/FormatBar.jsx';
import MarkupOverlay from '../common/MarkupOverlay.jsx';
import { useFormatKeys } from '../../lib/useFormatKeys.js';
import ActivityView from './ActivityView.jsx';
import { replaceShortcodes, PICKER_GROUPS, EMOJI_INDEX } from '../../utils/emoji.js';
import { looksLikeTask, suggestTitle, mentionedUsers, teamForChannel } from '../../lib/taskIntent.js';

// VAPID public key (base64url) → Uint8Array for PushManager.subscribe.
// The reverse trip: a live subscription reports its applicationServerKey as an
// ArrayBuffer, and comparing it to the server's advertised key is the only way
// to notice the two have drifted apart.
function subKeyToBase64(buf) {
  if (!buf) return null;
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Render a message body: convert :shortcode: emoji and Slack <!channel>/<!here>
// refs, then tokenize @mentions and Slack *bold* / ~strike~ / `code` markup into
// styled nodes. (Italic via single underscore is intentionally left alone so
// snake_case words and channel refs aren't mangled.)
// Links that point back into ReadyDoc — reminder DMs from ReadyBot, module
// cross-links — should navigate INSIDE the app rather than reloading the site.
// Recognizes ?c=<channel>[&m=<message>] (jump to a conversation) and
// ?tab=<module> (open a module), on our own origin only.
function parseAppLink(href) {
  let u;
  try { u = new URL(href, window.location.origin); } catch { return null; }
  if (u.origin !== window.location.origin) return null;
  const channelId = u.searchParams.get('c');
  const messageId = u.searchParams.get('m');
  const tab = u.searchParams.get('tab');
  if (channelId) return { kind: 'channel', channelId, messageId, label: messageId ? 'Open the message' : 'Open the conversation' };
  if (tab) return { kind: 'tab', tab, label: 'Open in ReadyDoc' };
  return null;
}
function openAppLink(link) {
  if (link.kind === 'channel') {
    window.dispatchEvent(new CustomEvent('comms-open-channel', {
      detail: { channelId: link.channelId, messageId: link.messageId },
    }));
    return;
  }
  // A module link inside the docked panel or a popout: the `app-navigate`
  // event is listened for by App, which isn't in this document at all, so it
  // used to be a button that visibly did nothing. Ask the window that owns
  // ReadyDoc to do the navigating — the panel stays on Messages, which is the
  // only thing it should ever show.
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'readydoc-navigate', tab: link.tab }, window.location.origin);
    return;
  }
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage({ type: 'readydoc-navigate', tab: link.tab }, window.location.origin);
      window.opener.focus();
      return;
    } catch { /* opener gone or cross-origin */ }
  }
  window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: link.tab } }));
}

// Chat calls people by their short first + last name — the same one they sign
// in with. The full legal name stays on records and signatures; a conversation
// doesn't need it. `username` comes from the server; falling back to the full
// name keeps anyone imported without one from rendering blank.
/**
 * Every class that affects where a character lands, shared by the composer
 * textarea and the MarkupOverlay behind it.
 *
 * They have to be identical or the highlight drifts off the words — so it is
 * one constant rather than two copies that look the same today.
 *
 * `border` is in here for width only, with the colour set separately
 * (gray-300 on the field, transparent on the overlay). The textarea's 1px
 * border pushes its first character in by a pixel; an overlay without one
 * would sit a pixel high and left of every word.
 */
const COMPOSER_METRICS = 'px-3 py-2 text-sm leading-normal font-sans border';

const chatName = (u) => u?.username || u?.name || '';

// Inline formatting inside one run of text: mentions, links, and the character
// markers people type (or the toolbar inserts). Order in the alternation
// matters — underline (`__x__`) is listed before italic (`_x_`) so the two-
// underscore form wins at a position where both could start.
function renderInline(s, users, me, keyBase = '') {
  const names = [...new Set((users || []).flatMap(u => [chatName(u), u.name]).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const parts = [
    'https?:\\/\\/[^\\s<]+',                       // clickable URL (matched first)
    names.length ? '@(?:' + names.map(escapeRe).join('|') + ')' : null,
    '@channel', '@here',
    '\\*(?=\\S)[^*\\n]*?\\S\\*',                    // *bold*
    '(?<![A-Za-z0-9_])__(?=\\S)[^_\\n]*?\\S__(?![A-Za-z0-9_])', // __underline__
    '(?<![A-Za-z0-9_])_(?=\\S)[^_\\n]*?\\S_(?![A-Za-z0-9_])',   // _italic_
    '~(?=\\S)[^~\\n]*?\\S~',                        // ~strike~
    '`[^`\\n]+`',                                   // `code`
  ].filter(Boolean);
  const re = new RegExp('(' + parts.join('|') + ')', 'g');

  const out = []; let last = 0, m, k = 0;
  const key = () => `${keyBase}-${k++}`;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    let tok = m[0];
    if (/^https?:\/\//.test(tok)) {
      // Don't swallow trailing sentence punctuation into the link.
      let trail = '';
      const tm = tok.match(/[.,;:!?)\]}"']+$/);
      if (tm) { trail = tm[0]; tok = tok.slice(0, -trail.length); }
      // A link back into ReadyDoc itself (reminder DMs, cross-links) jumps
      // in-app instead of reloading the whole site in a new tab.
      const inApp = parseAppLink(tok);
      if (inApp) {
        out.push(
          <button key={key()} type="button"
            onClick={(e) => { e.stopPropagation(); openAppLink(inApp); }}
            className="inline-flex items-center gap-1 align-baseline text-powder-700 underline font-medium hover:text-powder-800">
            {inApp.label}
          </button>
        );
        if (trail) out.push(trail);
        last = m.index + m[0].length;
        continue;
      }
      out.push(<a key={key()} href={tok} target="_blank" rel="noopener noreferrer" className="text-powder-700 underline break-all hover:text-powder-800">{tok}</a>);
      if (trail) out.push(trail);
      last = m.index + m[0].length;
      continue;
    }
    if (tok[0] === '@') {
      const nm = tok.slice(1);
      // Either spelling of my name counts as "you were mentioned".
      const isMe = [chatName(me), me?.name].filter(Boolean)
        .some(n => n.toLowerCase() === nm.toLowerCase());
      const isBroadcast = nm === 'channel' || nm === 'here';
      out.push(<span key={key()} className={isMe ? 'bg-amber-200 text-amber-900 rounded px-1 font-semibold' : isBroadcast ? 'bg-amber-100 text-amber-800 rounded px-1 font-medium' : 'text-powder-700 font-medium'}>{tok}</span>);
    } else if (tok.startsWith('__')) {
      out.push(<span key={key()} className="underline">{tok.slice(2, -2)}</span>);
    } else if (tok[0] === '_') {
      out.push(<em key={key()}>{tok.slice(1, -1)}</em>);
    } else if (tok[0] === '*') {
      out.push(<strong key={key()}>{tok.slice(1, -1)}</strong>);
    } else if (tok[0] === '~') {
      out.push(<span key={key()} className="line-through">{tok.slice(1, -1)}</span>);
    } else if (tok[0] === '`') {
      out.push(<code key={key()} className="px-1 py-0.5 rounded bg-gray-100 text-[0.85em] font-mono">{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length ? out : s;
}

// Block-level render: paragraphs keep their line breaks, while runs of `- `/`* `
// lines become a bullet list and `1. ` lines a numbered list — the clean
// structure people expect from Slack / Claude. Inline markers are applied
// within each paragraph and list item.
function renderBody(text, users, me) {
  if (!text) return text;
  const s = replaceShortcodes(text)
    .replace(/<!channel>|<!everyone>/gi, '@channel')
    .replace(/<!here>/gi, '@here');

  const blocks = [];
  let para = [];
  let list = null; // { type: 'ul' | 'ol', items: [] }
  const flushPara = () => {
    if (!para.length) return;
    const key = `p${blocks.length}`;
    blocks.push(<p key={key} className="whitespace-pre-wrap break-words">{renderInline(para.join('\n'), users, me, key)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    const cls = (list.type === 'ul' ? 'list-disc' : 'list-decimal') + ' pl-5 space-y-0.5 my-1';
    const Tag = list.type;
    blocks.push(<Tag key={key} className={cls}>
      {list.items.map((it, i) => <li key={i} className="break-words">{renderInline(it, users, me, `${key}-${i}`)}</li>)}
    </Tag>);
    list = null;
  };

  for (const line of s.split('\n')) {
    // A space after the marker is required, so `*bold*` (no space) is not a
    // bullet and only a genuine "- "/"* "/"1. " list item is.
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(numbered[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList();
  flushPara();
  return blocks;
}

// ── Composer formatting ───────────────────────────────────────────────────────
// Wrap the current selection in a marker pair. With nothing selected, drop the
// markers and place the caret between them so you can type into the format.
const parseMsgDate = (iso) => new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
const fmtTime = (iso) => parseMsgDate(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayKey = (iso) => { const d = parseMsgDate(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
// Slack-style day divider label: Today / Yesterday / weekday+date.
const dayLabel = (iso) => {
  const d = parseMsgDate(iso); const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
};
function DateDivider({ iso }) {
  return (
    <div className="flex items-center gap-3 px-4 my-2">
      <div className="flex-1 h-px bg-gray-200" />
      <span className="text-[11px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-full px-3 py-0.5 shadow-sm">{dayLabel(iso)}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}
// Mark the searched words inside a result so the eye lands on why it matched,
// instead of reading two lines to find out. Prefix-matched like the FTS query
// itself ("gask" highlights "gasket").
function highlightTerms(text, query) {
  const body = text || '';
  const terms = (query || '').trim().split(/\s+/).filter(t => t.length >= 2);
  if (!terms.length) return body;
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  const out = [];
  let last = 0, m, k = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(<mark key={k++} className="bg-amber-200 text-amber-900 rounded-sm px-0.5">{m[0]}</mark>);
    last = m.index + m[0].length;
    if (re.lastIndex === m.index) re.lastIndex++; // guard against a zero-width match
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

const fmtSize = (n) => { if (!n && n !== 0) return ''; if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'; return (n / 1024 / 1024).toFixed(1) + ' MB'; };

// Browsers can't decode HEIC/HEIF (iPhone) or TIFF — treat those "images" as
// plain files so they get a download card instead of a broken <img>.
function browserRenderable(a) {
  const probe = `${a.filename || ''} ${a.content_type || ''}`.toLowerCase();
  return a.is_image && !/heic|heif|\.tiff?\b|image\/tiff/.test(probe);
}
const isPdf = (a) => /\.pdf(\s|$)/i.test(a.filename || '') || (a.content_type || '') === 'application/pdf';

// Video the browser will actually decode. AVI, MKV and raw HEVC upload fine and
// stay downloadable, but no browser plays them — they fall through to the file
// card rather than showing a dead player. A codec the container can't handle
// still fires onError, which flips these back to the card too.
const videoPlayable = (a) => {
  const probe = `${a.filename || ''} ${a.content_type || ''}`.toLowerCase();
  return a.is_video && !/\.(avi|mkv|hevc)\b|x-msvideo|matroska/.test(probe);
};

// A spinner is fine for a screenshot; a 200 MB video needs to show it's moving.
// Once the bytes are all out the server is still streaming them to storage, so
// 100% holds with a different label rather than sitting at a stale bar.
function UploadProgress({ percent }) {
  const done = percent >= 100;
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs text-gray-400 min-w-[160px]">
      <Loader2 size={12} className="animate-spin shrink-0" />
      <span className="shrink-0">{done ? 'Processing…' : `Uploading ${percent}%`}</span>
      {!done && (
        <span className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
          <span className="block h-full bg-powder-500 transition-[width] duration-150" style={{ width: `${percent}%` }} />
        </span>
      )}
    </div>
  );
}

// Attachments live on R2 behind a presigned URL, which is a DIFFERENT ORIGIN —
// so `<a download>` is ignored and the browser just opens the file in a tab.
// Fetching the bytes and saving a blob fixes that, but only if the bucket has a
// CORS rule allowing this origin; without one the fetch throws and the fallback
// opens a tab, which is what "download behaves like open in a new tab" looks
// like from the outside.
//
// So the bytes now come back through OUR origin (`download_url`), which needs
// no CORS rule and keeps the filename. The presigned URL stays the fallback for
// an attachment serialized before this shipped.
async function downloadAttachment(a) {
  const src = a?.download_url || a?.url;
  if (!src) return;
  try {
    const token = localStorage.getItem('auth_token');
    const res = await fetch(src, a?.download_url
      ? { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      : undefined);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = href;
    el.download = a.filename || 'download';
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  } catch {
    window.open(a.url || src, '_blank', 'noopener');
  }
}


const isAudio = (a) => (a.content_type || '').startsWith('audio/');

function Attachment({ a, onOpen }) {
  const [broken, setBroken] = useState(false);
  // Audio (voice notes) checked BEFORE video: audio/webm would otherwise
  // render as a black <video> box.
  if (isAudio(a) && a.url && !broken) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <audio src={a.url} controls preload="metadata" onError={() => setBroken(true)} className="h-10 max-w-[250px]" />
        <span className="text-[10px] text-gray-400 shrink-0">{fmtSize(a.size)}</span>
        {canNativeShare && (
          <button type="button" onClick={() => shareAttachment(a)} data-tip="Share"
            className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50">
            <Share2 size={13} />
          </button>
        )}
      </div>
    );
  }
  if (videoPlayable(a) && a.url && !broken) {
    return (
      <div className="mt-1 max-w-sm">
        {/* preload="metadata" so a channel full of clips doesn't pull megabytes
            on open — the poster frame and duration are enough until played. */}
        <video src={a.url} controls playsInline preload="metadata" onError={() => setBroken(true)}
          className="rounded-lg border border-gray-200 max-h-72 w-full bg-black" />
        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-400">
          <span className="truncate">{a.filename}</span>
          <span className="shrink-0">· {fmtSize(a.size)}</span>
        </div>
      </div>
    );
  }
  if (browserRenderable(a) && a.url && !broken) {
    // Screenshots need the same one-click download as any other file. The
    // button sits on the image (always visible on touch, on hover for mouse)
    // so nobody has to open the viewer or reach for right-click.
    return (
      <div className="relative inline-block mt-1 max-w-xs group/img">
        <button type="button" onClick={onOpen} className="block text-left">
          <img src={a.url} alt={a.filename} onError={() => setBroken(true)}
            className="rounded-lg border border-gray-200 max-h-64 object-contain" />
        </button>
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-100 md:opacity-0 md:group-hover/img:opacity-100 transition-opacity">
          {/* Share opens the phone's own sheet with the image attached, so it
              can go straight into a text. Hidden where the API doesn't exist
              (desktop Firefox) rather than offered to fail. */}
          {canNativeShare && (
            <button type="button"
              onClick={e => { e.stopPropagation(); shareAttachment(a); }}
              data-tip="Share image"
              className="p-1.5 rounded-lg bg-black/55 text-white hover:bg-black/75">
              <Share2 size={14} />
            </button>
          )}
          <button type="button"
            onClick={e => { e.stopPropagation(); downloadAttachment(a); }}
            data-tip="Download image"
            className="p-1.5 rounded-lg bg-black/55 text-white hover:bg-black/75">
            <Download size={14} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <span className="mt-1 inline-flex items-center gap-1">
      <button type="button" onClick={onOpen}
        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 max-w-xs text-left">
        <FileText size={16} className="text-powder-600 shrink-0" />
        <span className="text-sm text-gray-800 truncate">{a.filename}</span>
        <span className="text-[10px] text-gray-400 shrink-0">{fmtSize(a.size)}</span>
        <Download size={13} className="text-gray-400 shrink-0" />
      </button>
      {canNativeShare && (
        <button type="button" onClick={() => shareAttachment(a)} data-tip="Share file"
          className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50">
          <Share2 size={13} />
        </button>
      )}
    </span>
  );
}

// Full-screen viewer for a message's attachments: ← → (buttons, keys, or swipe)
// move through every file without closing; Esc / backdrop / ✕ closes. Non-image
// files show a download card so mixed sets still page smoothly.
function Lightbox({ atts, index, onNav, onClose }) {
  const a = atts[index];
  // Follow-the-finger paging between attachments.
  const { trackRef, containerProps } = useDragPager({ index, count: atts.length, onChange: (i) => onNav(i - index) });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onNav(1);
      else if (e.key === 'ArrowLeft') onNav(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNav, onClose]);
  if (!a) return null;
  return (
    <div className="fixed inset-0 bg-black/85 z-[70] flex items-center justify-center overflow-hidden" onClick={onClose}
      {...containerProps}>
      <button onClick={e => { e.stopPropagation(); onClose(); }} className="absolute top-3 right-3 p-2 text-white/70 hover:text-white z-10"><X size={24} /></button>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 text-white/70 text-sm select-none">
        {index + 1} / {atts.length} · <span className="text-white/90">{a.filename}</span>
      </div>
      {atts.length > 1 && (
        <button onClick={e => { e.stopPropagation(); onNav(-1); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/25 z-10"><ChevronLeft size={26} /></button>
      )}
      {atts.length > 1 && (
        <button onClick={e => { e.stopPropagation(); onNav(1); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/25 z-10"><ChevronRight size={26} /></button>
      )}
      {/* A DOCUMENT NEEDS MORE ROOM THAN A PHOTO, and it cannot be pinched.
          Photos and video are capped so they sit inside the frame with the
          controls; a PDF is handed the whole box, because the browser's own
          viewer spends a third of its width on a thumbnail rail before it draws
          a single page. In a docked chat panel or on a phone that left the page
          itself a couple of centimetres across — legible only in the sense that
          pixels were present. Same reason "Open full size" is offered on the
          document itself rather than only in the footer: below about 700px no
          amount of sizing makes an embedded letter-size page readable, and a
          real tab is the honest answer. */}
      <div ref={trackRef}
        className={`will-change-transform ${isPdf(a) ? 'w-[98vw] h-[90vh] max-w-6xl' : 'max-w-[92vw] max-h-[84vh]'}`}
        onClick={e => e.stopPropagation()}>
        {browserRenderable(a) && a.url ? (
          <ZoomableImage src={a.url} alt={a.filename}
            onError={e => { e.target.outerHTML = '<div class="bg-white rounded-xl p-6 text-sm text-gray-700">This photo could not be displayed — use Download below to view it.</div>'; }} />
        ) : videoPlayable(a) && a.url ? (
          <video src={a.url} controls playsInline autoPlay className="max-w-[92vw] max-h-[84vh] bg-black rounded-lg" />
        ) : isPdf(a) && a.url ? (
          <div className="relative w-full h-full">
            <iframe src={a.url} title={a.filename} className="w-full h-full bg-white rounded-lg" />
            <a href={a.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900/85 text-white text-xs font-medium shadow-lg hover:bg-gray-900">
              <ExternalLink size={13} /> Open full size
            </a>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-6 flex flex-col items-center gap-3 min-w-[260px]">
            <FileText size={40} className="text-powder-600" />
            <div className="text-sm font-medium text-gray-900 text-center break-all max-w-[70vw]">{a.filename}</div>
            <div className="text-xs text-gray-400">{fmtSize(a.size)}</div>
            {a.is_image && !browserRenderable(a) && (
              <div className="text-[11px] text-gray-500 text-center max-w-[280px]">This photo format (HEIC/TIFF) can't be previewed in the browser — download it to view.</div>
            )}
            {/* Goes through downloadAttachment, not a bare <a download> — the
                presigned URL is cross-origin so the attribute is ignored. */}
            <button type="button" onClick={e => { e.stopPropagation(); downloadAttachment(a); }}
              className="mt-1 flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <Download size={15} /> Download
            </button>
          </div>
        )}
      </div>
      <div className="absolute bottom-4 right-4 flex items-center gap-3">
        <button type="button" onClick={e => { e.stopPropagation(); downloadAttachment(a); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium">
          <Download size={13} /> Download
        </button>
        <a href={a.url || undefined} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
          className="text-white/60 hover:text-white text-xs underline">Open in new tab</a>
      </div>
    </div>
  );
}

// ReadyBot's offer: this message reads like an assignment — track it instead of
// letting it scroll away. Everything is pre-filled from the message and the
// channel, so the common case is one click; the fields are there for the times
// the guess is close but not right.
const TEAM_OPTIONS = [
  ['maintenance', 'Maintenance'], ['warehouse', 'Warehouse'], ['qa', 'QA'],
  ['cleaning', 'Cleaning'], ['batching', 'Batching'], ['filling', 'Filling'],
  ['kitting', 'Kitting'], ['document_control', 'Document Control'],
];

function MessageToTaskModal({ draft, channel, users, onCancel, onJustSend, onCreated }) {
  const [title, setTitle] = useState(() => suggestTitle(draft));
  const [team, setTeam] = useState(() => teamForChannel(channel?.name) || 'warehouse');
  const [assignee, setAssignee] = useState(() => {
    const hit = mentionedUsers(draft, users, chatName)[0];
    return hit ? chatName(hit) : '';
  });
  // Tomorrow by default — today is usually already spoken for.
  const [due, setDue] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [priority, setPriority] = useState('normal');
  // What finished looks like. One extra optional field, not five — the reason
  // these tasks arrive thin is that the supervisor is mid-conversation, and
  // every required box is a reason to hit "Just send it" instead.
  const [doneWhen, setDoneWhen] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The suggested title is a trimmed first sentence, so on a long message it
  // ends in an ellipsis. Say so rather than letting it ship as the task name.
  const titleIsTruncated = title.trim().endsWith('…');

  const create = async () => {
    if (!title.trim()) { setError('A title is required.'); return; }
    setSaving(true); setError('');
    try {
      // The original message stays the description verbatim; the acceptance
      // note is appended so the assignee reads the ask and the bar together.
      const description = doneWhen.trim()
        ? `${draft}\n\nDone when: ${doneWhen.trim()}`
        : draft;
      await apiPost(`/comms/channels/${channel.id}/to-task`, {
        title: title.trim(), description, task_group: team,
        assigned_to: assignee.trim() || null, due_date: due, priority,
      });
      // /comms/ writes are excluded from the automatic badge refresh (chat
      // traffic feeds no compliance count) — but this one creates a work
      // order, so it has to say so itself. Same for to-record below.
      notifyDataChanged();
      onCreated();
    } catch (e) { setError(e.message || 'Could not create the task.'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[75] flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start gap-2">
          <ClipboardCheck size={18} className="text-powder-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-gray-900">Make this a task?</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              This reads like an assignment. A task can be tracked and closed out; a message scrolls away.
            </p>
          </div>
        </div>

        <blockquote className="text-xs text-gray-600 bg-gray-50 border-l-2 border-gray-300 pl-2 py-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap">
          {draft}
        </blockquote>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Task <span className="font-normal text-gray-400">— what needs doing, in a few words</span>
          </label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Close out MO76721 and report the total"
            className={`w-full px-3 py-2 border rounded-lg text-sm ${titleIsTruncated ? 'border-amber-300 bg-amber-50/40' : 'border-gray-300'}`} />
          {titleIsTruncated && (
            <p className="text-[11px] text-amber-700 mt-1">
              This is the start of the message, cut short. Give it a real name — it&apos;s the line the
              assignee sees on their task list.
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Done when <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input value={doneWhen} onChange={e => setDoneWhen(e.target.value)}
            placeholder="how they'll know it's finished"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Team</label>
            <select value={team} onChange={e => setTeam(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {TEAM_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Assign to</label>
            <input list="to-task-people" value={assignee} onChange={e => setAssignee(e.target.value)}
              placeholder="Whole team" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <datalist id="to-task-people">
              {(users || []).map(u => <option key={u.id} value={chatName(u)} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Due</label>
            <input type="date" value={due} onChange={e => setDue(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {['low', 'normal', 'high', 'critical'].map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={create} disabled={saving}
            className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create task'}
          </button>
          <button onClick={onJustSend} disabled={saving}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
            Just send it
          </button>
        </div>
        <p className="text-[11px] text-gray-400">
          Creating a task posts a note here recording who assigned it and when.
        </p>
      </div>
    </div>
  );
}

function NewChannelModal({ users, me, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('public');
  const [members, setMembers] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const chosen = Object.keys(members).filter(id => members[id]);

  const create = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      const ch = await apiPost('/comms/channels', { name, kind, member_ids: kind === 'private' ? chosen : [] });
      onCreated(ch);
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">New channel</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. shipping" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="flex gap-2">
          {[['public', 'Public — anyone can join'], ['private', 'Private — invite only']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setKind(v)} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${kind === v ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-300'}`}>{l}</button>
          ))}
        </div>
        {kind === 'private' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Members ({chosen.length})</label>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
              {(users || []).filter(u => u.id !== me.id).map(u => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm">
                  <input type="checkbox" checked={!!members[u.id]} onChange={() => setMembers(m => ({ ...m, [u.id]: !m[u.id] }))} />
                  {chatName(u)}
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={create} disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Creating…' : 'Create channel'}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Channel details drawer — opened by clicking the channel title (like Slack).
// Shows privacy, topic, and members; lets members add people and lets admins
// change privacy / announcement mode / rename.
function ChannelDetails({ channel, me, users, onClose, onChanged }) {
  const { data, refresh } = useApiGet(`/comms/channels/${channel.id}`, [channel.id]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(channel.name);
  const isAdmin = me?.role === 'admin';
  const members = data?.members || [];
  const myRole = members.find(m => m.user_id === me?.id)?.role;
  const canManage = isAdmin || myRole === 'owner'; // owner can rename + manage members
  const memberIds = new Set(members.map(m => m.user_id));
  const candidates = (users || []).filter(u => u.is_active && !memberIds.has(u.id));
  const depts = [...new Set(candidates.map(u => u.department).filter(Boolean))].sort();

  const addMany = async (ids) => { if (ids.length) { await apiPost(`/comms/channels/${channel.id}/members`, { user_ids: ids }); refresh(); onChanged?.(); } };
  const removeMember = async (uid) => { await apiFetch(`/comms/channels/${channel.id}/members/${uid}`, { method: 'DELETE' }); refresh(); onChanged?.(); };
  const setField = async (patch) => { await apiPut(`/comms/channels/${channel.id}`, patch); refresh(); onChanged?.(); };
  const saveName = async () => { if (name.trim() && name.trim() !== channel.name) await setField({ name: name.trim() }); setRenaming(false); };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-full max-w-md shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            {channel.post_policy === 'admins' ? <Megaphone size={17} className="text-gray-400 shrink-0" /> : channel.kind === 'private' ? <Lock size={17} className="text-gray-400 shrink-0" /> : <Hash size={17} className="text-gray-400 shrink-0" />}
            {renaming ? (
              <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false); }}
                className="font-semibold text-gray-900 border border-powder-300 rounded px-2 py-0.5 text-sm" />
            ) : (
              <h3 className="text-base font-semibold text-gray-900 truncate">{channel.name}</h3>
            )}
            {canManage && !renaming && <button onClick={() => { setName(channel.name); setRenaming(true); }} className="text-gray-300 hover:text-powder-600" data-tip="Rename"><Edit2 size={13} /></button>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {channel.topic && <p className="text-sm text-gray-600">{channel.topic}</p>}

          {/* Settings (admin) */}
          {isAdmin && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase text-gray-400">Settings</div>
              <label className="flex items-center justify-between text-sm text-gray-700">
                <span className="flex items-center gap-2"><Lock size={14} className="text-gray-400" /> Private (invite only)</span>
                <input type="checkbox" checked={channel.kind === 'private'} onChange={e => setField({ kind: e.target.checked ? 'private' : 'public' })} />
              </label>
              <label className="flex items-center justify-between text-sm text-gray-700">
                <span className="flex items-center gap-2"><Megaphone size={14} className="text-gray-400" /> Announcement (admins post only)</span>
                <input type="checkbox" checked={channel.post_policy === 'admins'} onChange={e => setField({ post_policy: e.target.checked ? 'admins' : 'all' })} />
              </label>
            </div>
          )}

          {/* Members */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold uppercase text-gray-400">Members · {members.length}</div>
              {candidates.length > 0 && <button onClick={() => setAdding(a => !a)} className="text-xs text-powder-600 hover:text-powder-700 font-medium flex items-center gap-1"><UserPlus size={13} /> Add people</button>}
            </div>

            {adding && (
              <div className="mb-3 border border-gray-200 rounded-lg p-2">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <button onClick={() => addMany(candidates.map(u => u.id))} className="text-xs px-2 py-0.5 rounded-lg bg-powder-600 text-white font-medium hover:bg-powder-700">+ Everyone ({candidates.length})</button>
                  {depts.map(d => {
                    const ids = candidates.filter(u => u.department === d).map(u => u.id);
                    return <button key={d} onClick={() => addMany(ids)} className="text-xs px-2 py-0.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-powder-50 capitalize">+ {d.replace('_', ' ')} ({ids.length})</button>;
                  })}
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {candidates.map(u => (
                    <button key={u.id} onClick={() => addMany([u.id])} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-powder-50 text-left">
                      <UserPlus size={13} className="text-powder-600" />
                      <span className="text-sm text-gray-800 flex-1">{chatName(u)}</span>
                      <span className="text-xs text-gray-400 capitalize">{(u.department || '').replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-0.5">
              {members.map(m => (
                <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                  <div className="h-7 w-7 rounded-lg bg-powder-100 text-powder-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                    {chatName(m).split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-800 flex-1">{chatName(m)}{m.user_id === me.id ? ' (you)' : ''}</span>
                  {m.role === 'owner' && <span className="text-[10px] uppercase text-gray-400">owner</span>}
                  {canManage && m.user_id !== me.id && <button onClick={() => removeMember(m.user_id)} className="text-gray-300 hover:text-red-500" data-tip="Remove" data-tip-left><UserMinus size={14} /></button>}
                </div>
              ))}
            </div>
          </div>

          {/* Leave — anyone can leave a private/group conversation they're in. */}
          {channel.kind !== 'public' && memberIds.has(me.id) && (
            <button onClick={async () => { await removeMember(me.id); onClose(); }}
              className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 font-medium">
              <LogOut size={14} /> Leave {myRole === 'owner' ? 'group' : 'conversation'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Thread drawer: a parent message and its replies, with a reply composer.
// ── @mention autocomplete (shared by the channel composer and thread replies) ──
// Slack-style: type @ plus any letters; matching is case-insensitive, and names
// whose first/last name starts with what you've typed rank first. An empty
// query (just "@") lists everyone in the channel.
function filterMentionPool(pool, query, meId) {
  if (query === null) return [];
  const q = query.toLowerCase();
  // Search both forms so typing a middle name still finds the person, but
  // rank and insert the short one.
  const hits = (pool || []).filter(u => u.id !== meId
    && (chatName(u).toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)));
  hits.sort((a, b) => {
    const ap = chatName(a).toLowerCase().split(/\s+/).some(p => p.startsWith(q)) ? 0 : 1;
    const bp = chatName(b).toLowerCase().split(/\s+/).some(p => p.startsWith(q)) ? 0 : 1;
    return ap - bp || chatName(a).localeCompare(chatName(b));
  });
  return hits.slice(0, 6);
}
function detectMentionQuery(e) {
  const val = e.target.value;
  const caret = e.target.selectionStart ?? val.length;
  const mm = /(?:^|\s)@([^\s@]*)$/.exec(val.slice(0, caret));
  return mm ? mm[1] : null;
}
function MentionDropdown({ matches, hi, onHover, onPick }) {
  if (!matches.length) return null;
  return (
    <div className="absolute bottom-full mb-1 left-3 right-3 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-20 max-h-48 overflow-y-auto">
      {matches.map((u, idx) => (
        <button key={u.id} onMouseEnter={() => onHover(idx)}
          onMouseDown={e => { e.preventDefault(); onPick(chatName(u)); }}
          className={`w-full text-left px-3 py-1.5 text-sm ${idx === hi ? 'bg-powder-50' : 'hover:bg-gray-50'}`}>
          <span className="font-medium text-gray-800">@{chatName(u)}</span>
        </button>
      ))}
    </div>
  );
}

// ── Drafts (Slack-style) ─────────────────────────────────────────────────────
// Unsent composer text survives navigating away — keyed by channel id (main
// composer) or `thread:<parentId>` (replies), stored per device. A Drafts
// section at the top of the channel list gets you back to them.
const DRAFTS_LS = 'comms_drafts';
// ── Where you were ───────────────────────────────────────────────────────────
// Coming back to Messages should be predictable: you land where you left. If
// you were reading a conversation, you get that conversation; if you went back
// to the list, you get the list. Nothing else picks a channel for you — the old
// behaviour opened #general (or whatever happened to be first) on every launch,
// which is why it felt random, and worse, marked it read on the way past.
const LAST_CH_LS = 'comms_last_channel';
function rememberChannel(id) { try { localStorage.setItem(LAST_CH_LS, id || ''); } catch { /* full */ } }
function forgetChannel() { try { localStorage.removeItem(LAST_CH_LS); } catch { /* ignore */ } }
function lastChannel() { try { return localStorage.getItem(LAST_CH_LS) || null; } catch { return null; } }

// WHICH VIEW, not just which channel. Threads and Activity are their own
// screens with no channel of their own, so remembering the channel alone meant
// a refresh while working the Threads inbox always dropped you into a channel
// — and if you hadn't opened one at all that session there was nothing saved,
// so you landed on #general. The view is remembered beside the channel.
const LAST_VIEW_LS = 'comms_last_view';
function rememberView(v) {
  try { if (v) localStorage.setItem(LAST_VIEW_LS, v); else localStorage.removeItem(LAST_VIEW_LS); } catch { /* full */ }
}
function lastView() { try { return localStorage.getItem(LAST_VIEW_LS) || null; } catch { return null; } }

function readDrafts() { try { return JSON.parse(localStorage.getItem(DRAFTS_LS) || '{}'); } catch { return {}; } }
function writeDraft(key, text) {
  if (!key) return;
  const d = readDrafts();
  if (text && text.trim()) d[key] = { text, at: Date.now() };
  else if (d[key]) delete d[key];
  else return; // nothing changed
  try { localStorage.setItem(DRAFTS_LS, JSON.stringify(d)); } catch { /* full */ }
  window.dispatchEvent(new CustomEvent('comms-drafts-changed'));
}

// The 3-dot menu's tallest form is about 250px. If the button sits closer than
// that to the bottom of the window, the menu opens upward instead — otherwise
// it lands below the fold and the options can't be read without scrolling,
// which is exactly where messages are read most (the newest ones).
const MENU_EST_HEIGHT = 260;
const MENU_WIDTH = 208; // w-52

// Where to draw a message menu, in VIEWPORT coordinates.
//
// The menu used to be an absolutely-positioned child of the message row, so
// ANY ancestor with overflow clipped it — and in the Threads inbox there are
// two: the card (overflow-hidden, for its rounded corners) and the list's own
// scroller. The old check measured the window, so it could see neither and
// happily dropped a full-height menu into a container that cut it in half,
// with no way to scroll to the rest.
//
// So the menu is drawn on <body> through a portal at FIXED coordinates taken
// from the button: no ancestor can clip it, and no transformed ancestor (the
// swipe-back pane) can shift it. It flips above the button when there's more
// room there, is clamped to the viewport horizontally, and carries a maxHeight
// so a menu that still doesn't fit scrolls itself instead of being unreachable.
function menuPosition(btn) {
  const r = btn.getBoundingClientRect();
  const gap = 4, margin = 8;
  const below = window.innerHeight - r.bottom - gap;
  const above = r.top - gap;
  const up = below < MENU_EST_HEIGHT && above > below;
  return {
    left: Math.max(margin, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - margin)),
    ...(up ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap }),
    maxHeight: Math.max(140, (up ? above : below) - margin),
  };
}

function MenuPortal({ style, onClose, children }) {
  // A fixed menu can't follow the button it belongs to, so any scroll closes it
  // rather than letting it float away. Capture phase, because the scroller is
  // an ancestor and its scroll event doesn't bubble to window.
  useEffect(() => {
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('scroll', onClose, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div style={style} className="fixed w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-[61] py-1 overflow-y-auto">
        {children}
      </div>
    </>,
    document.body,
  );
}

// Slack-style "Remind me about this": pick a delay and ReadyBot DMs you at
// that time with an excerpt + a link back to the message.
function RemindPicker({ m, onClose }) {
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const opts = [
    ['In 20 minutes', () => new Date(Date.now() + 20 * 60000)],
    ['In 1 hour', () => new Date(Date.now() + 60 * 60000)],
    ['In 3 hours', () => new Date(Date.now() + 180 * 60000)],
    ['Tomorrow at 9 AM', () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }],
    ['Next Monday at 9 AM', () => { const d = new Date(); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); d.setHours(9, 0, 0, 0); return d; }],
  ];
  const pick = async (label, fn) => {
    setError(null);
    try {
      await apiPost(`/comms/messages/${m.id}/remind`, { at: fn().toISOString() });
      setDone(label);
      setTimeout(onClose, 1100);
    } catch (e) { setError(e.message); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xs p-4 space-y-1 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-2"><Clock size={15} className="text-powder-600" /> Remind me about this</p>
        {done ? (
          <p className="text-sm text-green-700 py-2">✓ ReadyBot will remind you {done.toLowerCase()}.</p>
        ) : (
          <>
            {opts.map(([label, fn]) => (
              <button key={label} onClick={() => pick(label, fn)}
                className="w-full text-left px-3 py-2 text-sm text-gray-800 rounded-lg hover:bg-powder-50">{label}</button>
            ))}
            {error && <p className="text-xs text-red-600 px-1">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

// Composers grow with their content (like Slack) up to a cap, then scroll
// internally. Called from a layout effect on every body change so programmatic
// clears (after send) and draft restores resize too.
function sizeTextarea(el, max = 240) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

// Viewing a channel clears its lingering push notifications on THIS device.
// (Cross-device clearing via a silent push was removed: web push requires each
// push to show a notification, so the "silent" dismiss made Android surface a
// phantom generic notification instead.)
function clearChannelNotifications(channelId) {
  if (!channelId || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(async (reg) => {
    const shown = await reg.getNotifications();
    for (const n of shown) {
      const url = (n.data && n.data.url) || '';
      if (n.tag === `channel-${channelId}` || url.includes('c=' + channelId)) n.close();
    }
  }).catch(() => { /* no SW / not supported */ });
}

// Voice note — tap the mic, talk, tap ✓. The floor is gloved half the day, so
// talking beats typing. Records via MediaRecorder and hands the finished file
// to the composer's normal upload path, where it becomes a pending attachment
// like any other file (review it, then Send). Hidden where the API doesn't
// exist rather than offered to fail; storage-gated by the caller like the
// paperclip.
function VoiceNoteButton({ disabled, onReady }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const discardRef = useRef(false);

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  // Recording must not outlive the composer it belongs to (navigating away
  // with a hot mic is a privacy bug, not a quirk).
  useEffect(() => () => {
    discardRef.current = true;
    try { recRef.current?.stop(); } catch { /* not recording */ }
    clearInterval(timerRef.current);
  }, []);

  if (!supported) return null;

  const stop = (discard) => {
    discardRef.current = discard;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported?.('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported?.('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      discardRef.current = false;
      rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        setRecording(false); setElapsed(0);
        if (!discardRef.current && chunksRef.current.length) {
          const type = rec.mimeType || mime || 'audio/webm';
          const ext = type.includes('mp4') ? 'm4a' : 'webm';
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          onReady(new File(chunksRef.current, `voice-note-${stamp}.${ext}`, { type }));
        }
      };
      recRef.current = rec;
      rec.start(250);
      setRecording(true); setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch {
      alert('Microphone access was blocked — allow it in your browser settings to record a voice note.');
    }
  };

  if (recording) {
    const mm = String(Math.floor(elapsed / 60));
    const ss = String(elapsed % 60).padStart(2, '0');
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-red-50 border border-red-200 shrink-0">
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-semibold text-red-700 tabular-nums">{mm}:{ss}</span>
        <button onClick={() => stop(true)} className="p-1 text-gray-400 hover:text-gray-600" title="Cancel recording"><X size={15} /></button>
        <button onClick={() => stop(false)} className="p-1 text-red-600 hover:text-red-700" title="Finish — attach to message"><Check size={16} /></button>
      </div>
    );
  }
  return (
    <button onClick={start} disabled={disabled}
      className="p-2.5 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded-xl disabled:opacity-40" title="Record a voice note">
      <Mic size={18} />
    </button>
  );
}

function ThreadPanel({ parent, me, channelName, mentionUsers, members, canTranslate, viewerLang, onTranslate, onClose, onChanged, socketRef, storageOn, onThreadRead }) {
  const [thread, setThread] = useState(null);
  const [body, setBody] = useState(() => readDrafts()[`thread:${parent.id}`]?.text || '');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState([]); // uploaded-but-unsent attachments
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100 while bytes are going out
  const fileInputRef = useRef(null);
  const replyRef = useRef(null);
  const endRef = useRef(null);
  // Same shortcuts as the main composer — people should learn them once.
  const replyKeys = useFormatKeys({
    getEl: () => replyRef.current,
    value: body,
    onChange: (v) => { setBody(v); writeDraft(`thread:${parent.id}`, v); },
  });
  // Reply box grows with its content, like the main composer.
  useEffect(() => { sizeTextarea(replyRef.current); }, [body]);
  // Opening a thread lands the cursor in the reply box (desktop only), matching
  // how opening a channel focuses the main composer.
  useEffect(() => {
    if (window.matchMedia?.('(hover: none)').matches) return;
    const raf = requestAnimationFrame(() => replyRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [parent.id]);
  // @mention autocomplete for the reply box (same behavior as the composer).
  const [mQuery, setMQuery] = useState(null);
  const [mHi, setMHi] = useState(0);
  const mMatches = useMemo(
    () => filterMentionPool(members?.length ? members : mentionUsers, mQuery, me.id),
    [members, mentionUsers, mQuery, me.id]);
  const insertReplyMention = (name) => {
    const ta = replyRef.current;
    const caret = ta ? ta.selectionStart : body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]*)$/, '@' + name + ' ');
    const after = body.slice(caret);
    setBody(before + after);
    setMQuery(null);
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(before.length, before.length); } });
  };


  const uploadFiles = async (files) => {
    if (!files.length || !storageOn) return;
    setUploading(true); setProgress(0);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const uploaded = await apiUpload(`/comms/channels/${parent.channel_id}/attachments`, fd, 'POST', setProgress);
      setPending(p => [...p, ...uploaded]);
    } catch (err) { alert(err.message || 'Upload failed'); }
    finally { setUploading(false); setProgress(0); }
  };
  const onPickFiles = (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; uploadFiles(files); };
  // Paste an image/screenshot straight into the reply (text pastes normally).
  const onReplyPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length && storageOn) { e.preventDefault(); uploadFiles(files); }
  };
  const removePending = (id) => setPending(p => p.filter(x => x.id !== id));

  const load = useCallback(async () => {
    try { setThread(await apiFetch(`/comms/messages/${parent.id}/thread`)); } catch { /* gone */ }
  }, [parent.id]);
  useEffect(() => { load(); }, [load]);
  // Opening the thread clears it from Threads — reading it here and reading it
  // in the inbox are the same act. AND re-mark when a reply lands while the
  // drawer is open: keyed on the reply COUNT as well as parent.id, so a reply
  // arriving while you're reading doesn't linger as unread until you close and
  // reopen — the same "mark read while it's on screen, not just on open" rule
  // the channel follows.
  const replyCount = thread?.replies?.length ?? 0;
  useEffect(() => {
    apiPost(`/comms/threads/${parent.id}/read`, {}).then(() => onThreadRead?.()).catch(() => {});
  }, [parent.id, replyCount, onThreadRead]);
  // Live-refresh when a reply to this parent arrives.
  useEffect(() => {
    const s = socketRef?.current; if (!s) return;
    const onNew = (m) => { if (m.parent_id === parent.id) load(); };
    s.on('message:new', onNew);
    return () => s.off('message:new', onNew);
  }, [parent.id, load, socketRef]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread]);

  const react = async (m, emoji) => { await apiPost(`/comms/messages/${m.id}/reactions`, { emoji }); load(); };
  const unreact = async (m, emoji) => { await apiFetch(`/comms/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }); load(); };
  const del = async (m) => { await apiFetch(`/comms/messages/${m.id}`, { method: 'DELETE' }); load(); onChanged?.(); };
  const edit = async (m, text) => { await apiPut(`/comms/messages/${m.id}`, { body: text }); load(); };
  // Marking unread in a thread rewinds the THREAD's own marker ({thread: true}
  // covers the parent message, whose intent here is "the whole thread again").
  // Then leave — staying in the drawer is what re-reads it.
  const markThreadUnread = async (m) => {
    try { await apiPost(`/comms/messages/${m.id}/unread`, { thread: true }); } catch { /* ignore */ }
    onThreadRead?.();
    onClose();
  };

  const send = async () => {
    const text = body.trim();
    const attachment_ids = pending.map(p => p.id);
    if (!text && !attachment_ids.length) return;
    setSending(true);
    try {
      await apiPost(`/comms/channels/${parent.channel_id}/messages`, { body: text, parent_id: parent.id, attachment_ids });
      setBody(''); writeDraft(`thread:${parent.id}`, ''); setPending([]); await load(); onChanged?.();
    } finally { setSending(false); }
  };

  const replies = thread?.replies || [];
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-full max-w-md shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 h-12 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">Thread</div>
            <div className="text-[11px] text-gray-400 truncate">{channelName}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {thread && <Message m={thread.parent} me={me} onReact={react} onUnreact={unreact} onEdit={edit} onDelete={del}
            onMarkUnread={markThreadUnread}
            canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} mentionUsers={mentionUsers} />}
          {replies.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-1">
              <div className="text-[11px] text-gray-400">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</div>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
          )}
          {replies.map(r => <Message key={r.id} m={r} me={me} onReact={react} onUnreact={unreact} onEdit={edit} onDelete={del}
            onMarkUnread={markThreadUnread}
            canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} mentionUsers={mentionUsers} />)}
          <div ref={endRef} />
        </div>
        <div className="border-t border-gray-200 p-3 shrink-0 relative">
          <MentionDropdown matches={mMatches} hi={mHi} onHover={setMHi} onPick={insertReplyMention} />
          {(pending.length > 0 || uploading) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pending.map(p => (
                <div key={p.id} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border border-gray-200 bg-gray-50 text-xs">
                  {isAudio(p) ? <Mic size={12} className="text-powder-600" /> : p.is_video ? <Film size={12} className="text-powder-600" /> : p.is_image ? <Paperclip size={12} className="text-powder-600" /> : <FileText size={12} className="text-powder-600" />}
                  <span className="max-w-[140px] truncate text-gray-700">{p.filename}</span>
                  <button onClick={() => removePending(p.id)} className="text-gray-400 hover:text-red-500"><X size={13} /></button>
                </div>
              ))}
              {uploading && <UploadProgress percent={progress} />}
            </div>
          )}
          <div className="mb-1"><FormatBar getEl={() => replyRef.current} value={body}
            onChange={v => { setBody(v); writeDraft(`thread:${parent.id}`, v); }} /></div>
          <div className="flex items-end gap-2">
            {storageOn && (
              <>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="p-2.5 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded-xl disabled:opacity-40" title="Attach files"><Paperclip size={16} /></button>
                <VoiceNoteButton disabled={uploading} onReady={(f) => uploadFiles([f])} />
              </>
            )}
            <textarea ref={replyRef} value={body}
              onChange={e => { setBody(e.target.value); writeDraft(`thread:${parent.id}`, e.target.value); setMQuery(detectMentionQuery(e)); setMHi(0); }}
              onPaste={onReplyPaste} rows={1}
              onKeyDown={e => {
                if (mMatches.length) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMHi(h => Math.min(h + 1, mMatches.length - 1)); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMHi(h => Math.max(h - 1, 0)); return; }
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertReplyMention(chatName(mMatches[mHi] || mMatches[0])); return; }
                  if (e.key === 'Escape') { setMQuery(null); return; }
                }
                // Ctrl/Cmd+Enter sends here, so it must be claimed before the
                // formatting keys see a Ctrl+Enter and think about lists.
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return; }
                if (replyKeys(e)) return;
              }}
              placeholder="Reply…" className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm resize-none max-h-60 overflow-y-auto" />
            <button onClick={send} disabled={sending || (!body.trim() && !pending.length)} className="p-2.5 bg-powder-600 text-white rounded-xl hover:bg-powder-700 disabled:opacity-40"><Send size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// One thread in the Threads inbox: channel label, parent, replies, reply box.
function ThreadInboxCard({ thread, me, refresh, mentionUsers, canTranslate, viewerLang, onTranslate, onOpenChannel, onMarkRead, onMarkUnread }) {
  const [body, setBody] = useState('');
  const cardReplyRef = useRef(null);
  const cardKeys = useFormatKeys({ getEl: () => cardReplyRef.current, value: body, onChange: setBody });
  // @mention autocomplete — the inbox reply is a real reply into a real
  // channel, so it needs the same picker the channel composer and the thread
  // drawer have. Without it people typed a name by hand, the spelling didn't
  // match, and nobody was notified.
  const [mQuery, setMQuery] = useState(null);
  const [mHi, setMHi] = useState(0);
  const mMatches = useMemo(() => filterMentionPool(mentionUsers, mQuery, me.id), [mentionUsers, mQuery, me.id]);
  const insertCardMention = (name) => {
    const ta = cardReplyRef.current;
    const caret = ta ? ta.selectionStart : body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]*)$/, '@' + name + ' ');
    const after = body.slice(caret);
    setBody(before + after);
    setMQuery(null);
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(before.length, before.length); } });
  };
  const react = async (m, e) => { await apiPost(`/comms/messages/${m.id}/reactions`, { emoji: e }); refresh(); };
  const unreact = async (m, e) => { await apiFetch(`/comms/messages/${m.id}/reactions/${encodeURIComponent(e)}`, { method: 'DELETE' }); refresh(); };
  const del = async (m) => { await apiFetch(`/comms/messages/${m.id}`, { method: 'DELETE' }); refresh(); };
  const edit = async (m, text) => { await apiPut(`/comms/messages/${m.id}`, { body: text }); refresh(); };
  const send = async () => {
    const t = body.trim(); if (!t) return;
    await apiPost(`/comms/channels/${thread.channel_id}/messages`, { body: t, parent_id: thread.parent.id });
    setBody(''); setMQuery(null); onMarkRead?.(thread.parent.id); refresh();
  };
  const Icon = thread.channel_kind === 'dm' ? MessageSquare : thread.channel_kind === 'private' ? Lock : Hash;
  const unread = thread.unread || 0;
  const cardRef = useRef(null);
  // "Acted on" = you've replied in this thread. Shown as a chip so a read
  // thread you've already answered is distinct from one you only skimmed.
  const acted = thread.replies.some(r => r.user_id === me.id);
  // Read threads collapse to a one-line summary so they recede as you scroll;
  // unread ones stay open. Either can be toggled.
  const [expanded, setExpanded] = useState(unread > 0);
  // The line the reader left off at. Captured once per mount so it stays put
  // while they read, rather than jumping as the card marks itself read.
  const [marker] = useState(() => (unread > 0 ? thread.last_read_at || '0' : null));
  const isNew = (m) => marker !== null && String(m.created_at) > marker && m.user_id !== me.id;
  const lastReply = thread.replies[thread.replies.length - 1];

  // Sitting and reading a thread clears it. "Mark read" used to be the ONLY
  // way, so the honest case — you read it, it needed nothing from you, you
  // moved on — left it unread forever and the badge stopped meaning anything.
  //
  // It marks read on the SERVER but deliberately does not refresh this list:
  // the ring, the "N new" badge and the NEW divider stay put while you are
  // still looking at the thread. A card that rearranges itself out from under
  // the sentence you are reading is worse than one that lingers, and the next
  // time the inbox loads it will be in its read state anyway. `onMarkRead`
  // still updates the sidebar count, which is the number people watch.
  //
  // Collapsed cards are excluded — a one-line summary scrolling past is not
  // reading the thread.
  useSeenAfterDwell(cardRef, {
    enabled: unread > 0 && expanded,
    ms: 4000,
    onSeen: () => onMarkRead?.(thread.parent.id),
  });

  return (
    // NO overflow-hidden: it was there to clip the header's fill to the rounded
    // corner, and it also clipped every floating thing a message renders — the
    // hover pill, the emoji picker, the 3-dot menu. The corners are rounded on
    // the first and last children instead, which costs nothing and lets those
    // escape the card.
    <div ref={cardRef} className={`border rounded-xl m-3 transition-opacity ${
      unread > 0 ? 'border-powder-300 ring-1 ring-powder-100 bg-white'
                 : 'border-gray-200 bg-gray-50/60 opacity-75 hover:opacity-100'}`}>
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 bg-gray-50 rounded-t-xl">
        <button onClick={() => onOpenChannel(thread.channel_id)}
          className={`flex items-center gap-1.5 text-sm hover:underline min-w-0 ${unread > 0 ? 'font-semibold text-gray-800' : 'font-medium text-gray-500'}`}>
          <Icon size={14} className="text-gray-400 shrink-0" /> <span className="truncate">{thread.channel_name}</span>
        </button>
        {acted && !unread && (
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400" data-tip="You replied in this thread">
            <Check size={11} /> Replied
          </span>
        )}
        {unread > 0 ? (
          <>
            <span className="px-1.5 py-0.5 rounded-full bg-powder-600 text-white text-[10px] font-bold">{unread} new</span>
            <button onClick={() => onMarkRead?.(thread.parent.id)}
              className="ml-auto flex items-center gap-1 text-[11px] text-gray-500 hover:text-powder-600">
              <Check size={12} /> Mark read
            </button>
          </>
        ) : (
          <button onClick={() => setExpanded(x => !x)}
            className="ml-auto flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-gray-600">
            {expanded ? <>Collapse <ChevronUp size={12} /></> : <>Expand <ChevronDown size={12} /></>}
          </button>
        )}
      </div>
      {!expanded ? (
        // Collapsed read thread: just enough to recognize it and reopen it.
        <button onClick={() => setExpanded(true)} className="w-full text-left px-4 py-2 hover:bg-white rounded-b-xl">
          <p className="text-xs text-gray-500 line-clamp-1">{thread.parent.body || '(attachment)'}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}
            {lastReply ? ` · last from ${lastReply.user_name}` : ''}
          </p>
        </button>
      ) : (
      <div className="py-1">
        <Message m={thread.parent} me={me} onReact={react} onUnreact={unreact} onEdit={edit} onDelete={del}
          onMarkUnread={onMarkUnread}
          canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} mentionUsers={mentionUsers} />
        <div className="px-4 py-0.5 text-[11px] font-medium text-gray-400">{thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}</div>
        {thread.replies.map((r, i) => (
          <Fragment key={r.id}>
            {/* One "new replies" line, at the first reply the reader hasn't seen. */}
            {isNew(r) && !thread.replies.slice(0, i).some(isNew) && (
              <div className="flex items-center gap-2 px-4 py-1">
                <span className="h-px flex-1 bg-red-300" />
                <span className="text-[10px] font-bold uppercase text-red-500">New</span>
              </div>
            )}
            <Message m={r} me={me} onReact={react} onUnreact={unreact} onEdit={edit} onDelete={del}
              onMarkUnread={onMarkUnread}
              canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} mentionUsers={mentionUsers} />
          </Fragment>
        ))}
      </div>
      )}
      {expanded && (
      <div className="relative p-2 border-t border-gray-100 rounded-b-xl">
        <MentionDropdown matches={mMatches} hi={mHi} onHover={setMHi} onPick={insertCardMention} />
        <div className="mb-1"><FormatBar getEl={() => cardReplyRef.current} value={body} onChange={setBody} /></div>
        <div className="flex items-end gap-2">
          <textarea ref={cardReplyRef} value={body} rows={1} onInput={e => sizeTextarea(e.target, 160)}
            onChange={e => { setBody(e.target.value); setMQuery(detectMentionQuery(e)); setMHi(0); }}
            onKeyDown={e => {
              // While the @ menu is open: arrows move, Enter/Tab picks, Esc closes.
              if (mMatches.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMHi(h => Math.min(h + 1, mMatches.length - 1)); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMHi(h => Math.max(h - 1, 0)); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertCardMention(chatName(mMatches[mHi] || mMatches[0])); return; }
              }
              if (e.key === 'Escape' && mQuery !== null) { setMQuery(null); return; }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return; }
              if (cardKeys(e)) return;
            }}
            placeholder="Reply…" className="flex-1 px-3 py-1.5 border border-gray-300 rounded-xl text-sm resize-none max-h-40 overflow-y-auto" />
          <button onClick={send} disabled={!body.trim()} className="p-2 bg-powder-600 text-white rounded-xl hover:bg-powder-700 disabled:opacity-40"><Send size={15} /></button>
        </div>
      </div>
      )}
    </div>
  );
}

function ThreadsView({ me, mentionUsers, canTranslate, viewerLang, onTranslate, onOpenChannel, onCloseMobile, onRead, refreshKey, backButton }) {
  const { data: threads, loading, refresh } = useApiGet('/comms/threads', [refreshKey]);
  // Unread first, then most recently active — the point of the view is what
  // still needs an answer, not a chronological archive.
  const list = useMemo(() => [...(threads || [])].sort((a, b) => {
    const au = a.unread > 0 ? 0 : 1, bu = b.unread > 0 ? 0 : 1;
    return au - bu || String(b.last_reply).localeCompare(String(a.last_reply));
  }), [threads]);
  const unreadCount = list.filter(t => t.unread > 0).length;

  // Reading a thread here clears it, the same as opening a channel does.
  const markRead = useCallback(async (parentId) => {
    try { await apiPost(`/comms/threads/${parentId}/read`, {}); onRead?.(); } catch { /* ignore */ }
  }, [onRead]);

  // "I'll come back to this" from inside the inbox. Marking any message in a
  // thread rewinds that THREAD's marker (the server decides that from the
  // message), so the card comes back with its "N new" badge on the next load.
  const markUnread = useCallback(async (m) => {
    try { await apiPost(`/comms/messages/${m.id}/unread`, { thread: true }); onRead?.(); } catch { /* ignore */ }
    refresh();
  }, [onRead, refresh]);

  return (
    <>
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
        <button onClick={onCloseMobile} className="md:hidden -ml-1 p-1 text-gray-500 hover:text-gray-700" title="Back"><ArrowLeft size={18} /></button>
        {backButton}
        <MessageSquare size={16} className="text-powder-600" />
        <span className="font-semibold text-gray-900">Threads</span>
        <span className="text-xs text-gray-400">{list.length ? `· ${list.length}` : ''}</span>
        {unreadCount > 0 && (
          <button onClick={async () => {
            await Promise.all(list.filter(t => t.unread > 0).map(t => apiPost(`/comms/threads/${t.parent.id}/read`, {}).catch(() => {})));
            onRead?.(); refresh();
          }} className="ml-auto flex items-center gap-1 text-xs text-powder-600 hover:underline">
            <CheckCheck size={13} /> Mark all read
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? <p className="text-center text-sm text-gray-400 py-8">Loading threads…</p>
          : list.length === 0 ? <p className="text-center text-sm text-gray-400 py-8">No threads yet. Reply to a message to start one.</p>
          : list.map(t => <ThreadInboxCard key={t.parent.id} thread={t} me={me} refresh={refresh} mentionUsers={mentionUsers}
              canTranslate={canTranslate} viewerLang={viewerLang} onTranslate={onTranslate} onOpenChannel={onOpenChannel}
              onMarkRead={markRead} onMarkUnread={markUnread} />)}
      </div>
    </>
  );
}

// Searchable, grouped emoji picker used for reactions and the composer.
function EmojiPicker({ onPick, onClose, align = 'right', vertical = 'down' }) {
  const [q, setQ] = useState('');
  const boxRef = useRef(null);
  const term = q.trim().toLowerCase();
  const searchHits = term ? EMOJI_INDEX.filter(e => e.name.includes(term)).slice(0, 48) : null;
  // Close on outside click / Escape — NOT on mouseleave (that closed the picker
  // the moment you moved the pointer to search, or when the mobile keyboard
  // opened). Using 'click' (not mousedown) so the toggle button that opened it
  // closes cleanly instead of closing-then-reopening.
  useEffect(() => {
    const onDocClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // Attach on the next tick so the very click that OPENED the picker doesn't
    // immediately bubble to document and close it again.
    const tid = setTimeout(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => { clearTimeout(tid); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div ref={boxRef} className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} ${vertical === 'up' ? 'bottom-8' : 'top-7'} z-30 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-2`}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search emoji…"
        className="w-full px-2 py-1.5 mb-2 border border-gray-200 rounded-lg text-xs outline-none focus:border-powder-300" />
      <div className="max-h-56 overflow-y-auto">
        {searchHits ? (
          <div className="grid grid-cols-8 gap-0.5">
            {searchHits.map(e => <button key={e.name} title={e.name} onClick={() => onPick(e.emoji)} className="p-1 text-lg hover:bg-gray-100 rounded">{e.emoji}</button>)}
            {searchHits.length === 0 && <p className="col-span-8 text-center text-xs text-gray-400 py-3">No emoji found</p>}
          </div>
        ) : PICKER_GROUPS.map(g => (
          <div key={g.label} className="mb-1.5">
            <div className="text-[10px] font-bold uppercase text-gray-400 px-1 mb-0.5">{g.label}</div>
            <div className="grid grid-cols-8 gap-0.5">
              {g.emojis.map((e, i) => <button key={g.label + i} onClick={() => onPick(e)} className="p-1 text-lg hover:bg-gray-100 rounded">{e}</button>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Quick-reaction row shown at the top of the mobile action sheet.
const QUICK_EMOJIS = ['👍', '✅', '🙏', '😂', '😮', '❤️'];

// Slack-style bottom sheet for a message on mobile: quick reactions up top,
// then the actions (reply / copy / translate / mark unread / edit / delete).
// Compact row inside the desktop 3-dot message menu.
function MenuRow({ icon: Icon, label, danger, act, onAction }) {
  return (
    <button onClick={() => onAction(act)}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
      {Icon ? <Icon size={14} className={danger ? 'text-red-500' : 'text-gray-400'} />
        : <span className="block h-2.5 w-2.5 ml-0.5 mr-0.5 rounded-full border-2 border-gray-400" />}
      {label}
    </button>
  );
}

// Slack's red "unread starts here" line.
function NewDivider() {
  return (
    <div className="flex items-center gap-2 px-4 my-1">
      <div className="flex-1 h-px bg-red-400" />
      <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide">New</span>
    </div>
  );
}

function SheetRow({ icon: Icon, label, danger, act, onAction }) {
  return (
    <button onClick={() => onAction(act)}
      className={`w-full flex items-center gap-3 px-3 h-12 rounded-xl text-[15px] text-left ${danger ? 'text-red-600' : 'text-gray-800'} active:bg-gray-100`}>
      {Icon ? <Icon size={19} className={danger ? 'text-red-500' : 'text-gray-400'} />
        : <span className="block h-3 w-3 ml-0.5 mr-1 rounded-full border-2 border-gray-400" />}
      {label}
    </button>
  );
}

function MessageActionSheet({ preview, mine, canReply, canTranslate, translateLabel, canMarkUnread, onClose, onReact, onAction }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end md:hidden" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-t-2xl px-3 pt-2 pb-8 animate-sheet-up max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="mx-auto h-1 w-10 rounded-full bg-gray-300 mb-2.5" />
        {preview && <p className="text-xs text-gray-400 truncate px-1.5 mb-2.5">{preview}</p>}
        <div className="flex items-center justify-between px-1 mb-2">
          {QUICK_EMOJIS.map(e => (
            <button key={e} onClick={() => onReact(e)} className="h-11 w-11 rounded-full bg-gray-50 active:bg-gray-200 text-2xl flex items-center justify-center">{e}</button>
          ))}
          <button onClick={() => setShowAll(s => !s)} className={`h-11 w-11 rounded-full flex items-center justify-center ${showAll ? 'bg-powder-100 text-powder-600' : 'bg-gray-50 text-gray-500'}`}>
            <Smile size={20} />
          </button>
        </div>
        {showAll && (
          <div className="max-h-44 overflow-y-auto mb-2 border border-gray-100 rounded-xl p-1.5">
            {PICKER_GROUPS.map(g => (
              <div key={g.label} className="mb-1">
                <div className="text-[10px] font-bold uppercase text-gray-400 px-1">{g.label}</div>
                <div className="grid grid-cols-8 gap-0.5">
                  {g.emojis.map((e, i) => <button key={g.label + i} onClick={() => onReact(e)} className="p-1 text-xl">{e}</button>)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-gray-100 pt-1">
          {canReply && <SheetRow icon={MessageSquare} label="Reply in thread" act="reply" onAction={onAction} />}
          <SheetRow icon={Copy} label="Copy text" act="copy" onAction={onAction} />
          <SheetRow icon={Forward} label="Forward to channel…" act="forward" onAction={onAction} />
          <SheetRow icon={Clock} label="Remind me about this…" act="remind" onAction={onAction} />
          {canTranslate && <SheetRow icon={Languages} label={translateLabel || 'Translate'} act="translate" onAction={onAction} />}
          {canMarkUnread && <SheetRow icon={null} label="Mark unread from here" act="unread" onAction={onAction} />}
          <SheetRow icon={ClipboardCheck} label="Create compliance record…" act="record" onAction={onAction} />
          {mine && <SheetRow icon={Edit2} label="Edit message" act="edit" onAction={onAction} />}
          {mine && <SheetRow icon={Trash2} label="Delete message" danger act="delete" onAction={onAction} />}
        </div>
      </div>
    </div>
  );
}

// Promote a chat message into a draft compliance record. The record is
// pre-filled from the message + author + timestamp and back-linked to the
// source; it lands as a draft in the owning module for QA to complete.
const RECORD_TYPES = [
  { type: 'deviation', label: 'Deviation' },
  { type: 'non_conformance', label: 'Non-Conformance' },
  { type: 'on_hold', label: 'On Hold' },
];
function ConvertRecordModal({ m, onClose }) {
  const [type, setType] = useState('deviation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // { record_number, label }

  const create = async () => {
    setBusy(true); setError('');
    try { setDone(await apiPost(`/comms/messages/${m.id}/to-record`, { type })); notifyDataChanged(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3 max-h-[92vh] overflow-y-auto">
        {done ? (
          <div className="text-center py-2 space-y-2">
            <ClipboardCheck size={36} className="mx-auto text-green-600" />
            <p className="text-sm font-semibold text-gray-900">{done.label} {done.record_number} created</p>
            <p className="text-xs text-gray-500">Saved as a draft in the {done.label} module, pre-filled from this message and back-linked to it. Open the module to complete and sign it.</p>
            <button onClick={onClose} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Done</button>
          </div>
        ) : (
          <>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><ClipboardCheck size={16} className="text-powder-600" /> Create compliance record</h3>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
              <p className="text-[11px] text-gray-400 mb-0.5">{m.user_name} · {fmtTime(m.created_at)}</p>
              <p className="text-xs text-gray-700 line-clamp-4 whitespace-pre-wrap">{m.body}</p>
            </div>
            <div className="flex gap-1.5">
              {RECORD_TYPES.map(rt => (
                <button key={rt.type} onClick={() => setType(rt.type)}
                  className={`flex-1 px-2 py-2 rounded-lg border-2 text-xs font-semibold transition-colors ${type === rt.type ? 'border-powder-500 bg-powder-50 text-powder-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {rt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">The message text, author, and time are copied into a draft record with an audit-trail link back to this conversation.</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={create} disabled={busy} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
                {busy ? 'Creating…' : 'Create draft record'}
              </button>
              <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Forward a message into another channel — the alternative people actually
// use is a screenshot, which loses the text, the file and the author. The
// picker is the caller's own channel list; the server re-checks access on
// both ends and carries the attachments across without a re-upload.
function ForwardModal({ m, onClose }) {
  const { data: channels } = useApiGet('/comms/channels');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const list = (channels || []).filter(c => c.id !== m.channel_id);
  const label = (c) => (c.kind === 'dm' ? c.name : `#${c.name}`);

  const forward = async () => {
    if (!target) { setError('Pick a channel first.'); return; }
    setBusy(true); setError('');
    try {
      await apiPost(`/comms/messages/${m.id}/forward`, { channel_id: target, note: note.trim() });
      setDone(list.find(c => c.id === target) || null);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3 max-h-[92vh] overflow-y-auto">
        {done ? (
          <div className="text-center py-2 space-y-2">
            <Forward size={36} className="mx-auto text-green-600" />
            <p className="text-sm font-semibold text-gray-900">Forwarded to {label(done)}</p>
            <button onClick={onClose} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Done</button>
          </div>
        ) : (
          <>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Forward size={16} className="text-powder-600" /> Forward message</h3>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
              <p className="text-[11px] text-gray-400 mb-0.5">{m.user_name}</p>
              <p className="text-xs text-gray-700 line-clamp-3 whitespace-pre-wrap">{m.body || `(${m.attachments?.length || 0} attachment${m.attachments?.length === 1 ? '' : 's'})`}</p>
              {m.body && m.attachments?.length > 0 && <p className="text-[11px] text-gray-400 mt-0.5">+ {m.attachments.length} attachment{m.attachments.length === 1 ? '' : 's'}</p>}
            </div>
            <select value={target} onChange={e => setTarget(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Forward to…</option>
              {list.map(c => <option key={c.id} value={c.id}>{label(c)}</option>)}
            </select>
            <input value={note} onChange={e => setNote(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="Add a note (optional)" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={forward} disabled={busy || !target}
                className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
                {busy ? 'Forwarding…' : 'Forward'}
              </button>
              <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const Message = memo(function Message({ m, me, onReact, onUnreact, onEdit, onDelete, onReply, onMarkUnread, canTranslate, viewerLang, onTranslate, autoText, highlighted, mentionUsers }) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body || '');
  const [translated, setTranslated] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [transError, setTransError] = useState(null);
  const [sheet, setSheet] = useState(false); // mobile long-press action sheet
  const [menuOpen, setMenuOpen] = useState(false); // desktop 3-dot menu
  const [menuStyle, setMenuStyle] = useState(null); // viewport coords, measured on open
  const menuBtnRef = useRef(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const [lightbox, setLightbox] = useState(null); // index into m.attachments
  const [convert, setConvert] = useState(false); // message → compliance record
  const [remind, setRemind] = useState(false);   // Slack-style "remind me"
  const [fwd, setFwd] = useState(false);         // forward to another channel
  const mine = m.user_id === me.id;

  const doTranslate = useCallback(async () => {
    if (translating || translated) return;
    setTranslating(true); setTransError(null);
    // A swallowed failure here is how "translation stopped working" went
    // unreported for weeks — the tap did nothing and said nothing. Errors are
    // shown; a result identical to the original is named too, because it
    // usually means the message is already in the viewer's language (check
    // which language the translate mode is set to).
    try {
      const t = await onTranslate(m, viewerLang);
      if (t === m.body) setTransError(`Already in ${viewerLang === 'en' ? 'English' : 'Spanish'} — or the translator returned it unchanged.`);
      else setTranslated(t);
    } catch (e) { setTransError(e?.message || 'Translation failed — try again.'); }
    finally { setTranslating(false); }
  }, [translating, translated, onTranslate, m, viewerLang]);

  // Channel-level auto-translate arrives pre-batched from the parent (autoText);
  // a manual per-message translate (translated) always wins.
  const displayBody = translated ?? (autoText || m.body);
  const isAutoTranslated = !translated && autoText && autoText !== m.body;

  // Mobile interaction (Slack-style): quick tap opens the thread; a long-press
  // (held still ~450ms) opens the action sheet. Desktop keeps the hover bar.
  const pressTimer = useRef(null);
  const pressPos = useRef(null);
  const suppressClick = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const onTouchStart = (e) => {
    if (m.deleted || editing) return;
    // A second finger means a pinch, not a long-press. Without this the timer
    // started by the first finger still fires and the action sheet opens on
    // top of whatever the user was trying to zoom.
    if (e.touches.length > 1) { cancelPress(); suppressClick.current = true; return; }
    const t = e.touches[0];
    if (!t) return;
    suppressClick.current = false;   // fresh gesture
    pressPos.current = { x: t.clientX, y: t.clientY };
    pressTimer.current = setTimeout(() => { pressTimer.current = null; suppressClick.current = true; setSheet(true); }, 450);
  };
  const onTouchMove = (e) => {
    if (e.touches.length > 1) { cancelPress(); suppressClick.current = true; return; }
    // Note: no early return on a cleared timer. Once the finger has travelled,
    // this gesture is a SCROLL and must not also count as a tap — the old
    // version only cancelled the long-press, so flicking the list open and
    // lifting your finger over a message threw you into its thread. That one
    // accidental navigation is most of what "not smooth" feels like.
    if (!pressPos.current) return;
    const t = e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - pressPos.current.x) > 12 || Math.abs(t.clientY - pressPos.current.y) > 12) {
      cancelPress();
      suppressClick.current = true;
    }
  };
  const onTouchEnd = () => { cancelPress(); pressPos.current = null; };
  const onRowClick = (e) => {
    if (e.target.closest('a, button, input, textarea, select')) return;
    if (suppressClick.current) { suppressClick.current = false; return; }
    // Touch: tap opens the thread (like Slack). Desktop uses the hover bar.
    if (window.matchMedia?.('(hover: none)').matches && onReply && !m.deleted && !editing) onReply(m);
  };
  const handleSheetAction = (act) => {
    setSheet(false);
    setMenuOpen(false);
    if (act === 'reply' && onReply) onReply(m);
    else if (act === 'copy') { try { navigator.clipboard?.writeText(displayBody || m.body || ''); } catch { /* ignore */ } }
    else if (act === 'translate') doTranslate();
    else if (act === 'unread' && onMarkUnread) onMarkUnread(m);
    else if (act === 'record') setConvert(true);
    else if (act === 'remind') setRemind(true);
    else if (act === 'forward') setFwd(true);
    else if (act === 'edit') { setDraft(m.body || ''); setEditing(true); }
    else if (act === 'delete') onDelete(m);
  };

  return (
    <div onClick={onRowClick} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
      className={`msg-row group relative flex gap-2 px-4 py-1.5 hover:bg-gray-50 transition-colors ${highlighted ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}>
      <div className="h-8 w-8 rounded-lg bg-powder-100 text-powder-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
        {m.user_name?.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-gray-900 text-sm">{m.user_name}</span>
          <span className="text-[11px] text-gray-400">{fmtTime(m.created_at)}{m.edited ? ' · edited' : ''}</span>
        </div>
        {m.deleted ? (
          <p className="text-sm text-gray-400 italic">message deleted</p>
        ) : editing ? (
          // A long message was previously edited through a one-line input, which
          // showed a few words at a time. This grows to fit the message (capped
          // so it can't swallow the channel) and keeps Enter-to-save with
          // Shift+Enter for a new line.
          <div className="mt-1">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 320)}px`; } }}
              rows={1}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-y min-h-[64px] max-h-80 leading-relaxed"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEdit(m, draft); setEditing(false); }
                if (e.key === 'Escape') setEditing(false);
              }} autoFocus />
            <div className="flex items-center gap-2 mt-1">
              <button onClick={() => { onEdit(m, draft); setEditing(false); }} className="text-xs font-medium text-powder-600">Save</button>
              <button onClick={() => setEditing(false)} className="text-xs text-gray-400">Cancel</button>
              <span className="text-[10px] text-gray-400">Enter to save · Shift+Enter for a new line</span>
            </div>
          </div>
        ) : (
          m.body && (
            <div>
              {/* renderBody returns block elements (paragraphs + lists), so this
                  is a div, not a p — a p can't legally contain a ul/ol. */}
              <div className="text-sm text-gray-800 break-words space-y-0.5">{renderBody(displayBody, mentionUsers, me)}</div>
              {translating && <span className="text-[11px] text-gray-400 italic">Translating…</span>}
              {transError && <span className="text-[11px] text-amber-700">{transError}</span>}
              {translated && (
                <button onClick={() => setTranslated(null)} className="text-[11px] text-powder-600 hover:underline">
                  Translated to {viewerLang === 'en' ? 'English' : 'Spanish'} · Show original
                </button>
              )}
              {isAutoTranslated && <span className="text-[11px] text-gray-400 italic">translated</span>}
            </div>
          )
        )}
        {!m.deleted && m.attachments?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {m.attachments.map((a, i) => <Attachment key={a.id} a={a} onOpen={() => setLightbox(i)} />)}
          </div>
        )}
        {lightbox !== null && m.attachments?.length > 0 && (
          <Lightbox atts={m.attachments} index={lightbox}
            onNav={(d) => setLightbox(i => (i + d + m.attachments.length) % m.attachments.length)}
            onClose={() => setLightbox(null)} />
        )}
        {m.reactions?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {m.reactions.map(r => {
              const reacted = r.users.includes(me.id);
              return (
                <button key={r.emoji} onClick={() => reacted ? onUnreact(m, r.emoji) : onReact(m, r.emoji)}
                  className={`px-2 py-1 text-sm md:px-1.5 md:py-0.5 md:text-xs rounded-full border ${reacted ? 'bg-powder-50 border-powder-300' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                  {r.emoji} {r.count}
                </button>
              );
            })}
          </div>
        )}
        {onReply && m.reply_count > 0 && (
          <button onClick={() => onReply(m)} className="mt-1 inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full border border-gray-200 hover:border-powder-300 hover:bg-powder-50 text-xs">
            <MessageSquare size={12} className="text-powder-600" />
            <span className="font-medium text-powder-700">{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}</span>
            {m.reply_names?.length > 0 && <span className="text-gray-400">· {m.reply_names.join(', ')}</span>}
          </button>
        )}
      </div>
      {/* Desktop hover pill (Slack-style): suggested reactions, full picker,
          reply, and a 3-dot menu with the rest. On phones everything lives in
          the long-press sheet, so messages get the full width. */}
      {/* Shown wherever a mouse exists (pointer:fine) — including the narrow
          split-screen dock and pop-out windows; width alone doesn't decide. */}
      {!m.deleted && (
        <div className={`absolute -top-3 right-3 z-10 hidden [@media(pointer:fine)]:flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-sm px-1 py-0.5 transition-opacity ${menuOpen || showEmoji ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {['✅', '👍', '🙌'].map(e => (
            <button key={e} onClick={() => onReact(m, e)} className="px-1 py-0.5 text-[15px] hover:bg-gray-100 rounded" data-tip={`React ${e}`}>{e}</button>
          ))}
          <button onClick={() => setShowEmoji(s => !s)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" data-tip="More reactions"><Smile size={15} /></button>
          {onReply && <button onClick={() => onReply(m)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" data-tip="Reply in thread"><MessageSquare size={14} /></button>}
          <div className="relative">
            {/* Open upward when the message is near the bottom of the channel,
                which is where most messages are read. Dropping down there put
                the menu below the fold and forced a scroll to see the options. */}
            <button ref={menuBtnRef}
              onClick={() => {
                if (menuBtnRef.current) setMenuStyle(menuPosition(menuBtnRef.current));
                setMenuOpen(o => !o);
              }}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded" data-tip="More actions" data-tip-left><MoreVertical size={14} /></button>
            {menuOpen && menuStyle && (
              <MenuPortal style={menuStyle} onClose={closeMenu}>
                <MenuRow icon={Copy} label="Copy text" act="copy" onAction={handleSheetAction} />
                <MenuRow icon={Forward} label="Forward to channel…" act="forward" onAction={handleSheetAction} />
                <MenuRow icon={Clock} label="Remind me about this…" act="remind" onAction={handleSheetAction} />
                {canTranslate && m.body && !translated && (
                  <MenuRow icon={Languages} label={`Translate to ${viewerLang === 'en' ? 'English' : 'Spanish'}`} act="translate" onAction={handleSheetAction} />
                )}
                {onMarkUnread && <MenuRow icon={null} label="Mark unread from here" act="unread" onAction={handleSheetAction} />}
                {m.body && <MenuRow icon={ClipboardCheck} label="Create compliance record…" act="record" onAction={handleSheetAction} />}
                {mine && <MenuRow icon={Edit2} label="Edit message" act="edit" onAction={handleSheetAction} />}
                {mine && <MenuRow icon={Trash2} label="Delete message" danger act="delete" onAction={handleSheetAction} />}
              </MenuPortal>
            )}
          </div>
          {showEmoji && <EmojiPicker onPick={(e) => { onReact(m, e); setShowEmoji(false); }} onClose={() => setShowEmoji(false)} />}
        </div>
      )}
      {convert && <ConvertRecordModal m={m} onClose={() => setConvert(false)} />}
      {remind && <RemindPicker m={m} onClose={() => setRemind(false)} />}
      {fwd && <ForwardModal m={m} onClose={() => setFwd(false)} />}
      {sheet && !m.deleted && (
        <MessageActionSheet
          preview={`${m.user_name}: ${(displayBody || '').slice(0, 80)}`}
          mine={mine} canReply={!!onReply} canTranslate={canTranslate && !!m.body && !translated}
          translateLabel={`Translate to ${viewerLang === 'en' ? 'English' : 'Spanish'}`} canMarkUnread={!!onMarkUnread}
          onClose={() => setSheet(false)}
          onReact={(e) => { setSheet(false); onReact(m, e); }}
          onAction={handleSheetAction}
        />
      )}
    </div>
  );
});

export default function CommsView({ user, onExit, onGoToSchedule, onSplitScreen, openChannelName, openChannelId, openMessageId, openNonce, backLabel, onBackToModule, homePref, onSetHome, bottomNavPadding = false }) {
  const { data: channels, refresh: refreshChannels } = useApiGet('/comms/channels');
  const { data: users } = useApiGet('/users');
  const { data: commsStatus } = useApiGet('/comms/status');
  const storageOn = !!commsStatus?.storage;
  const semanticOn = !!commsStatus?.semantic;
  const askOn = !!commsStatus?.ask;
  const translateOn = !!commsStatus?.translate;
  const pushOn = !!commsStatus?.push;
  const [viewerLang, setViewerLang] = useState(() => localStorage.getItem('op_lang') || 'en');
  // One-tap translation mode: tapping EN or ES translates the whole channel to
  // that language ("Original" turns it off). Remembered across sessions.
  const [autoTranslate, setAutoTranslate] = useState(() => (localStorage.getItem('comms_translate_mode') || 'off') !== 'off');
  const [translatingNow, setTranslatingNow] = useState(false);
  const [autoTrans, setAutoTrans] = useState({}); // `${messageId}:${lang}` -> translated text (null = failed, skip)
  const [highlightId, setHighlightId] = useState(null); // deep-linked message flash
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [showNotifStatus, setShowNotifStatus] = useState(false);
  const [activeId, setActiveId] = useState(null);
  // On phones the list and thread can't share the screen — show one at a time.
  const [mobileThread, setMobileThread] = useState(false);
  // "New" divider: where the reader left off, captured when the channel opens
  // (stays put while reading; cleared on switch). '0' = everything is new.
  const [newMarkerTs, setNewMarkerTs] = useState(null);
  // Jump-to-date: when set, the message list shows a window starting at that day.
  const [dateView, setDateView] = useState(null);
  // A channel with THIS many unread opens at the START of them (the "New"
  // divider) instead of the bottom — you need to read forward from where you
  // left off, not scroll up hunting for it. Below the threshold the divider is
  // already on screen at the bottom, so opening at the latest costs nothing.
  const OPEN_AT_FIRST_UNREAD_MIN = 5;
  const landOnNewRef = useRef(null); // channel id that should open at its New divider
  // Declared HERE because openChannel below writes all three — state a
  // function closes over must be declared before the function is.
  const [chanFilter, setChanFilter] = useState(''); // sidebar quick-filter (type to filter, ↑/↓ + Enter)
  const [threadsOpen, setThreadsOpen] = useState(false); // Threads inbox view
  const [activityOpen, setActivityOpen] = useState(false); // Activity feed view

  // ── Back one step, like a browser ─────────────────────────────────────────
  // Jumping between channels (or off to Threads/Activity) loses your place,
  // and on a wide screen the only way back was to find the old channel in the
  // sidebar again. This keeps a within-session trail of where you WERE — a
  // channel, Threads, or Activity — and the header button pops one step.
  // In-memory on purpose: persisting it would replay stale hops days later,
  // and `comms_last_channel` already handles "land where you left".
  const navStackRef = useRef([]);           // [{view:'channel', id} | {view:'threads'} | {view:'activity'}]
  const navHereRef = useRef(null);          // where you are now
  const navSuppressRef = useRef(false);     // set while goBack() itself navigates
  const [navPrev, setNavPrev] = useState(null); // top of stack — drives the button
  const sameLoc = (a, b) => !!a && !!b && a.view === b.view && a.id === b.id;
  const recordNav = (loc) => {
    if (navSuppressRef.current) { navSuppressRef.current = false; navHereRef.current = loc; return; }
    const here = navHereRef.current;
    if (sameLoc(here, loc)) return;
    if (here) {
      const stack = navStackRef.current;
      if (!sameLoc(stack[stack.length - 1], here)) stack.push(here);
      if (stack.length > 30) stack.shift();
      setNavPrev(stack[stack.length - 1] || null);
    }
    navHereRef.current = loc;
  };

  const openChannel = (id) => {
    const ch = (channels || []).find(c => c.id === id);
    setNewMarkerTs(ch && ch.unread > 0 ? (ch.last_read_at || '0') : null);
    landOnNewRef.current = (ch && ch.unread >= OPEN_AT_FIRST_UNREAD_MIN) ? id : null;
    setDateView(null);
    setActiveId(id); setMobileThread(true); setChanFilter(''); setThreadsOpen(false); setActivityOpen(false);
    rememberChannel(id); rememberView('channel');
    recordNav({ view: 'channel', id });
  };
  // Going back to the list is a decision: come back to the list next time.
  // The compact, one-pane-at-a-time layout — the same `md` breakpoint the
  // markup switches on, tracked live so a rotate or a resize is picked up.
  const isCompactLayout = useCompactLayout();

  const backToList = () => { setMobileThread(false); forgetChannel(); rememberView(null); };
  // Drag the conversation right to go back, iMessage-style. Only on the compact
  // layout — on desktop the list is always beside you, so there's nothing to go
  // back to and a stray horizontal drag should do nothing.
  const swipeBack = useSwipeBack(backToList, { enabled: isCompactLayout && mobileThread });

  // Pop one step off the trail recordNav (above openChannel) keeps.
  const goBack = () => {
    const stack = navStackRef.current;
    let target = stack.pop();
    // A channel that has since been deleted (or left) is skipped, not visited.
    while (target && target.view === 'channel' && !(channels || []).some(c => c.id === target.id)) {
      target = stack.pop();
    }
    setNavPrev(stack[stack.length - 1] || null);
    if (!target) return;
    navSuppressRef.current = true;
    if (target.view === 'channel') { openChannel(target.id); return; }
    setThreadsOpen(target.view === 'threads');
    setActivityOpen(target.view === 'activity');
    setMobileThread(false);
    rememberView(target.view);
  };
  const navPrevLabel = !navPrev ? null
    : navPrev.view === 'threads' ? 'Threads'
    : navPrev.view === 'activity' ? 'Activity'
    : (() => {
        const ch = (channels || []).find(c => c.id === navPrev.id);
        return ch ? (ch.kind === 'dm' ? ch.name : `#${ch.name}`) : 'previous channel';
      })();
  const backButton = navPrev ? (
    <button onClick={goBack} className="p-1 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded shrink-0"
      data-tip={`Back to ${navPrevLabel}`} aria-label={`Back to ${navPrevLabel}`}>
      <CornerUpLeft size={16} />
    </button>
  ) : null;
  const [chanHi, setChanHi] = useState(0);
  // Admin-defined sidebar sections (channel groupings) + collapse state.
  const { data: sections, refresh: refreshSections } = useApiGet('/comms/sections');
  const [collapsedSecs, setCollapsedSecs] = useState({});
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [newChannel, setNewChannel] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [dmSelected, setDmSelected] = useState([]); // user ids picked for a new (group) DM
  const [dmGroupName, setDmGroupName] = useState(''); // optional name → makes it a managed group
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [typers, setTypers] = useState([]); // {user_id, user_name, at} of people typing in the active channel
  const [pending, setPending] = useState([]); // uploaded-but-unsent attachments for the composer
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100 while bytes are going out
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState('keyword'); // keyword | smart | ask
  const [answer, setAnswer] = useState(null); // AI answer in ask mode
  // Search narrowing: totals + facets from the server, and the caller's picks.
  const [searchMeta, setSearchMeta] = useState(null);
  const [searchSort, setSearchSort] = useState('relevance'); // relevance | newest | oldest
  const [fChannel, setFChannel] = useState('');
  const [fPerson, setFPerson] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [mentionQuery, setMentionQuery] = useState(null); // text after "@" being typed, or null
  const scrollRef = useRef(null);
  const socketRef = useRef(null);
  const lastTypeSent = useRef(0);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null); // camera-first capture on phones
  const justOpenedRef = useRef(true); // force scroll-to-bottom on channel open
  const [showJump, setShowJump] = useState(false); // "Jump to latest" affordance
  const linkedOpenedRef = useRef(null); // guards the module→channel deep-link
  const bootRestoredRef = useRef(false); // the launch view has been decided
  const composerRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // parent message whose thread is open
  // A message being offered up as a task (null = no prompt showing).
  const [taskDraft, setTaskDraft] = useState(null);
  const canAssignTasks = user?.role === 'admin' || user?.role === 'supervisor';
  // Threads carry their own unread state now, so the badge needs its own feed.
  const [threadTick, setThreadTick] = useState(0);
  const { data: threadUnread, refresh: refreshThreadUnread } = useApiGet('/comms/threads/unread', [threadTick]);
  // Per-tab unread counts for Activity. Shares threadTick so reading anything
  // refreshes the badges without a second poller.
  const { data: activityUnread, refresh: refreshActivityUnread } = useApiGet('/comms/activity/unread', [threadTick]);
  const bumpThreads = () => setThreadTick(t => t + 1);

  const list = channels || [];
  // Keep the PWA home-screen icon badge in sync while the user is in Comms.
  const totalUnread = list.reduce((n, c) => n + (c.unread || 0), 0);
  useEffect(() => { setAppBadge(totalUnread); }, [totalUnread]);
  const publicCh = list.filter(c => c.kind === 'public');
  const privateCh = list.filter(c => c.kind === 'private');
  // DMs are conversation-driven, so surface unread first, then most recent.
  const dms = list.filter(c => c.kind === 'dm').sort((a, b) =>
    (b.unread > 0) - (a.unread > 0) || (b.last_activity || '').localeCompare(a.last_activity || ''));
  // Everything unread, floated to the very top of the sidebar (most recent first).
  const unreadList = list.filter(c => c.unread > 0)
    .sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || ''));
  // Section grouping for the sidebar: pinned default channels first, then each
  // admin section (in order), then everything ungrouped.
  const pinned = list.filter(c => c.is_default);
  const nonDefaultCh = list.filter(c => !c.is_default && c.kind !== 'dm');
  const byOrder = (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name);
  const sectionList = sections || [];
  const sectionGroups = sectionList
    .map(s => ({ ...s, channels: nonDefaultCh.filter(c => c.section_id === s.id).sort(byOrder) }))
    .filter(g => g.channels.length);
  const ungroupedCh = nonDefaultCh.filter(c => !c.section_id || !sectionList.some(s => s.id === c.section_id)).sort(byOrder);
  const active = list.find(c => c.id === activeId) || null;
  // Channel quick-filter: flat, ordered match list for keyboard jump-to.
  const chanTerm = chanFilter.trim().toLowerCase();
  const chanMatches = chanTerm
    ? [...publicCh, ...privateCh, ...dms].filter(c => (c.name || '').toLowerCase().includes(chanTerm))
    : [];
  const kindIcon = (c) => (c.kind === 'dm' ? MessageSquare : c.post_policy === 'admins' ? Megaphone : c.kind === 'private' ? Lock : Hash);
  // On phones, the main pane also needs to show when a search/ask is running.
  const searchActive = searchResults !== null || answer !== null || (searching && searchMode === 'ask');
  const showMainMobile = mobileThread || searchActive || threadsOpen || activityOpen;

  // Left-edge swipe (from App) steps back one level within Messages rather than
  // jumping straight out: open thread → channel → channel list → ReadyDoc.
  useEffect(() => {
    const back = () => {
      if (replyTo) { setReplyTo(null); return; }
      if (searchActive) { setSearchQ(''); setSearchResults(null); setAnswer(null); return; }
      if (activityOpen) { setActivityOpen(false); return; }
      if (threadsOpen) { setThreadsOpen(false); return; }
      if (mobileThread) { backToList(); return; }
      if (onBackToModule) { onBackToModule(); return; }
      onExit?.();
    };
    window.addEventListener('comms-back', back);
    return () => window.removeEventListener('comms-back', back);
  }, [replyTo, searchActive, threadsOpen, activityOpen, mobileThread, onBackToModule, onExit]);

  // Active channel's members — used to warn when @mentioning a non-member and to
  // scope the mention autocomplete to people who can actually see the channel.
  const { data: activeInfo } = useApiGet(activeId ? `/comms/channels/${activeId}` : '/comms/status', [activeId]);
  const channelMemberIds = useMemo(() => new Set((activeInfo?.members || []).map(m => m.user_id)), [activeInfo]);
  const channelMembers = useMemo(() => (activeInfo?.members || []).map(m => ({ id: m.user_id, name: m.name, username: m.username })), [activeInfo]);

  // Default to #general (or first channel) once loaded.
  // Pick the initial channel once the list loads: a module deep-link (e.g.
  // Schedule's "Discuss" → #production) wins, else #general, else the first.
  useEffect(() => {
    // bootRestored guards the Threads/Activity restore specifically: those
    // views set no activeId, so without it the effect would re-run on the next
    // channel-list refresh and fall through to #general underneath them.
    if (activeId || !list.length || bootRestoredRef.current) return;
    // From a push notification: open the exact channel by id. Use openChannel()
    // (not bare setActiveId) so phones land in the conversation, not the list.
    if (openChannelId && linkedOpenedRef.current !== openChannelId && list.some(c => c.id === openChannelId)) {
      linkedOpenedRef.current = openChannelId; openChannel(openChannelId); return;
    }
    if (openChannelName && linkedOpenedRef.current !== openChannelName) {
      // Tolerate underscores / hyphens / spacing differences (e.g. a link to
      // "production_schedule" resolving a "#production-schedule" channel).
      const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const t = norm(openChannelName);
      const target = list.find(c => norm(c.name) === t) || list.find(c => norm(c.name).includes(t));
      if (target) { linkedOpenedRef.current = openChannelName; openChannel(target.id); return; }
    }
    // ON A PHONE, THE APP OPENS ON THE LIST. FULL STOP. Restoring the last
    // conversation read as helpful and wasn't: you open Messages to see what
    // is NEW, and landing inside Tuesday's conversation both hid the list you
    // came for and — because a conversation on screen is a conversation
    // marked read — cleared the very unread you tapped in to read. Deep links
    // and notification taps still open their exact channel (the branches
    // above); this only decides the unprompted landing. Touch capability is
    // the test, same as the empty-restore rule below — width can't tell the
    // docked split panel from a phone.
    if (window.matchMedia?.('(hover: none)').matches) {
      bootRestoredRef.current = true;
      return;
    }

    // Wide layouts: restore where you were — the VIEW as well as the
    // conversation. The channel is restored first in both cases so that
    // closing Threads leaves you in the channel you had open rather than an
    // empty pane.
    // BOTH values are read before anything is opened: openChannel() records
    // 'channel' as the view, so reading lastView() after it would always come
    // back 'channel' and the Threads restore could never fire.
    const saved = lastChannel();
    const view = lastView();
    const savedIsReal = saved && list.some(c => c.id === saved);
    if (savedIsReal) openChannel(saved);
    if (view === 'threads' || view === 'activity') {
      bootRestoredRef.current = true;
      setThreadsOpen(view === 'threads');
      setActivityOpen(view === 'activity');
      setMobileThread(false);
      rememberView(view); // openChannel() above just overwrote it — put it back
      recordNav({ view }); // and tell the back trail where the session started
      return;
    }
    if (savedIsReal) return;

    // Nothing to restore. On a phone that means the channel LIST — picking a
    // channel for someone is what made the landing feel arbitrary, and it used
    // to mark that channel read without ever showing it. The desktop
    // split-screen dock is also narrow enough to hit the compact layout, and
    // there an empty pane reads as "messages aren't loading"; width can't tell
    // the dock from a phone, but touch capability can.
    if (window.matchMedia?.('(hover: none)').matches) return;
    const target = publicCh.find(c => c.name === 'general') || list[0];
    openChannel(target.id);
  }, [list, activeId, openChannelName, openChannelId]); // eslint-disable-line

  // A push-notification deep-link can arrive while Comms is already open — open
  // the requested channel even if another one is active.
  //
  // KEYED ON THE TAP (openNonce), NOT THE TARGET. Two different notification
  // taps can carry the identical channel — the second message in a busy
  // channel, or a re-tap after the phone locked — and every value here is a
  // primitive, so an effect keyed on the target saw nothing change and did
  // nothing. That is most of "tapping the notification doesn't take me to the
  // message": the app was already showing the right channel and refused to
  // move within it. The nonce changes on every tap, so every tap acts.
  useEffect(() => {
    if (!openChannelId || !list.length) return;
    if (!list.some(c => c.id === openChannelId)) return;
    linkedOpenedRef.current = openChannelId;
    if (openChannelId !== activeId) {
      openChannel(openChannelId);
    } else {
      // Already in the channel: surface the CONVERSATION — the tap may have
      // landed on the thread inbox, the activity feed, or the channel list.
      setThreadsOpen(false); setActivityOpen(false); setMobileThread(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChannelId, openNonce, list.length]);


  // Per-channel message cache: switching channels shows the LAST-SEEN
  // conversation instantly and refreshes it behind. Before this, every switch
  // blanked the pane and waited on the network — which on a floor phone is
  // the whole of "comms feels laggy". The cache is session-only (a ref), so
  // nothing here changes what the server says is true; it only changes what
  // is on screen while the truth is fetched.
  const msgCacheRef = useRef(new Map());
  // The active channel at the moment a response LANDS, not the one it was
  // asked for: switch quickly from #general to a DM and #general's slower
  // response used to arrive last and overwrite the DM's messages — the wrong
  // conversation under the right header until the next refresh.
  const activeIdRef = useRef(null);
  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    try {
      const msgs = await apiFetch(`/comms/channels/${id}/messages`);
      msgCacheRef.current.set(id, msgs);
      if (activeIdRef.current === id) setMessages(msgs);
      // NOTE: loading messages does NOT mark the channel read. See the effect
      // below — a channel is only read once its conversation is on screen.
    } catch { /* channel may be inaccessible */ }
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
    setMessages(activeId ? (msgCacheRef.current.get(activeId) || []) : []);
    setTypers([]); setPending([]);
    loadMessages(activeId);
  }, [activeId, loadMessages]);

  // Socket events mutate `messages` in place — keep the cache carrying what
  // the screen shows, so switching away and back doesn't rewind the channel.
  useEffect(() => {
    if (activeId && messages.length) msgCacheRef.current.set(activeId, messages);
  }, [messages, activeId]);

  // A channel is marked read when its conversation is ACTUALLY ON SCREEN — not
  // when its messages happen to load.
  //
  // This is the bug behind "it ate my unread". On a phone the app used to set
  // an active channel on launch while showing the list; loading that channel's
  // messages posted /read, so the unread you came in to read was gone before
  // you'd seen a word of it — and the same path could wipe a channel you had
  // deliberately marked unread. On a phone the conversation is only on screen
  // once you've navigated into it.
  const conversationOnScreen = !!activeId && !threadsOpen && !activityOpen
    && (!isCompactLayout || mobileThread);
  useEffect(() => {
    if (!conversationOnScreen) return;
    apiPost(`/comms/channels/${activeId}/read`, {}).then(refreshChannels).catch(() => {});
    clearChannelNotifications(activeId);
  }, [conversationOnScreen, activeId, refreshChannels]);

  // Restore this conversation's draft (typed text was saved as you navigated away).
  useEffect(() => { setBody(readDrafts()[activeId]?.text || ''); }, [activeId]);
  // Composer grows with its content (and shrinks back after send/clear).
  useEffect(() => { sizeTextarea(composerRef.current); }, [body, activeId]);
  // Live view of all drafts for the sidebar section + channel-row pencils.
  const [drafts, setDrafts] = useState(readDrafts);
  useEffect(() => {
    const onChange = () => setDrafts(readDrafts());
    window.addEventListener('comms-drafts-changed', onChange);
    return () => window.removeEventListener('comms-drafts-changed', onChange);
  }, []);
  const channelDrafts = useMemo(() => {
    const list = [];
    for (const [key, v] of Object.entries(drafts)) {
      if (key.startsWith('thread:')) continue; // restored in-place when the thread reopens
      const ch = (channels || []).find(c => c.id === key);
      if (ch && v?.text) list.push({ channel: ch, text: v.text, at: v.at });
    }
    return list.sort((a, b) => b.at - a.at);
  }, [drafts, channels]);

  // Establish the shared socket once for this view + a global @mention handler.
  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;
    const onMention = (p) => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        try { new Notification(`${p.from} mentioned you`, { body: p.preview, tag: p.message_id }); } catch { /* ignore */ }
      }
    };
    s.on('mention', onMention);
    return () => { s.off('mention', onMention); socketRef.current = null; };
  }, []);

  // Realtime: join the active channel's room and react to pushed events (Phase 2,
  // replacing the old 4s poll). socket.io does not auto-rejoin rooms, so we
  // re-join and resync on every (re)connect.
  useEffect(() => {
    const s = socketRef.current;
    if (!s || !activeId) return;
    s.emit('channel:join', activeId);

    const onNew = (m) => {
      // A reply anywhere may be a thread the reader follows, so the badge is
      // refreshed even for channels they aren't currently looking at.
      if (m.parent_id && m.user_id !== user.id) bumpThreads();
      if (m.channel_id !== activeId) return;
      // A threaded reply: bump the parent's reply count in the main list.
      if (m.parent_id) {
        setMessages(ms => ms.map(x => x.id === m.parent_id ? { ...x, reply_count: (x.reply_count || 0) + 1 } : x));
        return;
      }
      setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]);
      setTypers(t => t.filter(x => x.user_id !== m.user_id));
    };
    const onUpdate = (m) => { if (m.channel_id === activeId) setMessages(ms => ms.map(x => x.id === m.id ? m : x)); };
    const onChannels = () => { refreshChannels(); refreshSections(); };
    const onTyping = (t) => {
      if (t.channel_id !== activeId || t.user_id === user.id) return;
      setTypers(prev => [...prev.filter(x => x.user_id !== t.user_id), { ...t, at: Date.now() }]);
    };
    const onConnect = () => { s.emit('channel:join', activeId); loadMessages(activeId); refreshChannels(); };

    s.on('message:new', onNew);
    s.on('message:update', onUpdate);
    s.on('channels:changed', onChannels);
    s.on('typing', onTyping);
    s.on('connect', onConnect);
    return () => {
      s.emit('channel:leave', activeId);
      s.off('message:new', onNew); s.off('message:update', onUpdate);
      s.off('channels:changed', onChannels); s.off('typing', onTyping); s.off('connect', onConnect);
    };
  }, [activeId, refreshChannels, refreshSections, loadMessages, user.id]);

  // Expire typing indicators that have gone quiet for >4s.
  useEffect(() => {
    if (!typers.length) return;
    const t = setInterval(() => setTypers(prev => prev.filter(x => Date.now() - x.at < 4000)), 1500);
    return () => clearInterval(t);
  }, [typers.length]);

  // "Pinned to latest" scroll model. A channel opens pinned to the newest
  // message and STAYS pinned through async loads and late layout (images,
  // avatars) via a ResizeObserver on the content — the previous frame-based pin
  // was consumed by the empty-list render on channel switch, which is why
  // channels kept opening on old messages. Scrolling up unpins (reading
  // history); scrolling back near the bottom re-pins.
  const pinnedRef = useRef(true);
  useEffect(() => {
    // When this channel is opening at its New divider, the pin must start OFF
    // — the ResizeObserver below pins on every content resize while it's on,
    // and the fetched messages landing would yank the view back to the bottom
    // out from under the divider.
    pinnedRef.current = landOnNewRef.current !== activeId;
    justOpenedRef.current = true; setShowJump(false);
  }, [activeId]);

  // Land at the START of the missed messages when there are several. The New
  // divider marks where the reader left off; opening a channel carrying a
  // real backlog at the bottom makes them scroll UP hunting for it, reading
  // in reverse. Runs once per open (the ref is cleared on first landing). A
  // push-notification deep link outranks it — queueMessage() clears the ref,
  // because that tap named an exact message.
  useEffect(() => {
    if (landOnNewRef.current !== activeId || !messages.length) return;
    const first = newMarkerTs !== null && messages.find(m => m.created_at > newMarkerTs);
    landOnNewRef.current = null;
    if (!first) {
      // The backlog is older than the loaded window — the bottom is honest.
      pinnedRef.current = true;
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      return;
    }
    setShowJump(true);
    requestAnimationFrame(() => {
      document.querySelector(`[data-mid="${first.id}"]`)?.scrollIntoView({ block: 'start' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeId, newMarkerTs]);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const content = el.firstElementChild;
    const pin = () => { if (pinnedRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; };
    pin();
    const ro = new ResizeObserver(pin);
    if (content) ro.observe(content);
    ro.observe(el); // container resizes (keyboard opening on mobile) re-pin too
    return () => ro.disconnect();
  }, [activeId]);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    if (pinnedRef.current) { el.scrollTop = el.scrollHeight; setShowJump(false); }
  }, [messages]);
  const onMessagesScroll = () => {
    const el = scrollRef.current; if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = fromBottom < 120;
    setShowJump(fromBottom > 240);
  };
  const jumpToLatest = () => {
    pinnedRef.current = true;
    const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
    setShowJump(false);
  };

  // Re-mark read when a new message LANDS while you're looking at the channel.
  // The on-screen effect above only fires on ENTER — a socket message arriving
  // in the open channel changes neither activeId nor conversationOnScreen, so
  // the badge kept counting messages you were actively watching until you left
  // and came back. Only when pinned to the live bottom: if you've scrolled up
  // reading history, a new arrival at the foot isn't "seen" yet. Keyed on the
  // newest id so it fires once per message; it does NOT refreshChannels itself
  // — the server marks read, and this same message's channels:changed refresh
  // carries the zero, so there's no extra round trip on the hot path.
  const lastMsgId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!conversationOnScreen || !lastMsgId || !pinnedRef.current) return;
    apiPost(`/comms/channels/${activeId}/read`, {}).catch(() => {});
    clearChannelNotifications(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsgId, conversationOnScreen]);
  // Jump to a specific day: load the window starting there and land at its top.
  const jumpToDate = async (d) => {
    if (!activeId || !d) return;
    try {
      const msgs = await apiFetch(`/comms/channels/${activeId}/messages?date=${d}`);
      pinnedRef.current = false; // we're reading history, not the live bottom
      setDateView(d);
      setMessages(msgs);
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
    } catch { /* ignore */ }
  };
  const backToLatest = () => {
    setDateView(null);
    pinnedRef.current = true;
    loadMessages(activeId);
  };

  // Type-to-compose: opening a channel focuses the composer (desktop only — on
  // phones autofocus would pop the keyboard over the conversation), and any
  // stray printable keystroke is routed into it, so you can pick a channel and
  // just start typing.
  //
  // A single delayed focus was unreliable: messages load async, and the list
  // render + scroll-to-bottom that follows would land after the focus and pull
  // it away — so the cursor "sometimes" wasn't in the box. We arm a per-channel
  // "wants focus" flag on open and try to land the cursor both immediately and
  // again once messages render, disarming as soon as it succeeds or the user
  // clicks into something else (so we never yank their cursor back mid-read).
  const wantFocusRef = useRef(null);
  useEffect(() => {
    if (window.matchMedia?.('(hover: none)').matches) { wantFocusRef.current = null; return; }
    wantFocusRef.current = activeId || null;
  }, [activeId]);
  useEffect(() => {
    if (!wantFocusRef.current || wantFocusRef.current !== activeId) return;
    if (window.matchMedia?.('(hover: none)').matches) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
      // The user has already put their cursor somewhere deliberate — stand down.
      if (el === composerRef.current) wantFocusRef.current = null;
      return;
    }
    const raf = requestAnimationFrame(() => {
      const ta = composerRef.current;
      if (ta && !ta.disabled) { ta.focus(); wantFocusRef.current = null; }
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId, messages]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const ta = composerRef.current;
      if (!ta || ta.disabled) return;
      ta.focus(); // the keystroke then lands in the composer
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const postMessage = async (text) => {
    const attachment_ids = pending.map(p => p.id);
    setBody(''); writeDraft(active.id, ''); setPending([]); setMentionQuery(null);
    try {
      const m = await apiPost(`/comms/channels/${active.id}/messages`, { body: text, attachment_ids });
      setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]);
      refreshChannels();
    } catch { setBody(text); setPending(pending); }
  };

  const send = async () => {
    const text = body.trim();
    if ((!text && pending.length === 0) || !active) return;
    // Intercept a directive aimed at named people in a team channel: it's a
    // task, and this is the last moment anyone will bother to make it one.
    // Only supervisors and admins assign work, so only they get asked.
    if (canAssignTasks && active.kind !== 'dm' && looksLikeTask(text)) {
      setTaskDraft(text);
      return;
    }
    await postMessage(text);
  };

  const uploadFiles = async (files) => {
    if (!files.length || !active || !storageOn) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const uploaded = await apiUpload(`/comms/channels/${active.id}/attachments`, fd, 'POST', setProgress);
      setPending(p => [...p, ...uploaded]);
    } catch (err) { alert(err.message || 'Upload failed'); }
    finally { setUploading(false); setProgress(0); }
  };
  const onPickFiles = (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; uploadFiles(files); };
  // Paste an image/screenshot straight into the composer (text pastes normally).
  const onComposerPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length && storageOn) { e.preventDefault(); uploadFiles(files); }
  };
  // Drag a file from the desktop / Downloads and drop it on the conversation.
  const [dropHover, setDropHover] = useState(false);
  const dragDepth = useRef(0);
  const onDragEnterMsgs = (e) => {
    if (!storageOn || !e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropHover(true);
  };
  const onDragOverMsgs = (e) => { if (storageOn && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
  const onDragLeaveMsgs = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropHover(false);
  };
  const onDropMsgs = (e) => {
    if (!storageOn) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDropHover(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  };
  const removePending = (id) => setPending(p => p.filter(x => x.id !== id));
  // STABLE handler identities (useCallback), so a memoized Message row doesn't
  // re-render on every keystroke in the composer. On a busy channel — hundreds
  // of rows — re-rendering all of them per character is the other half of "comms
  // feels laggy on a phone". None of these close over changing state except
  // delMsg, which reads the active channel from a ref.
  const react = useCallback(async (m, emoji) => { const updated = await apiPost(`/comms/messages/${m.id}/reactions`, { emoji }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); }, []);
  const unreact = useCallback(async (m, emoji) => { const updated = await apiFetch(`/comms/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); }, []);
  const editMsg = useCallback(async (m, text) => { if (!text.trim()) return; const updated = await apiPut(`/comms/messages/${m.id}`, { body: text }); setMessages(ms => ms.map(x => x.id === m.id ? updated : x)); }, []);
  const delMsg = useCallback(async (m) => { await apiFetch(`/comms/messages/${m.id}`, { method: 'DELETE' }); loadMessages(activeIdRef.current); }, [loadMessages]);

  const onBodyChange = (e) => {
    const val = e.target.value;
    setBody(val);
    writeDraft(activeId, val); // unsent text survives navigation (Slack-style)
    // @mention autocomplete: detect an @token immediately before the caret.
    setMentionQuery(detectMentionQuery(e));
    setMentionHi(0);
    // eslint-disable-next-line react-hooks/purity -- event handler (typing throttle), not render
    const now = Date.now();
    if (activeId && socketRef.current && now - lastTypeSent.current > 1500) {
      lastTypeSent.current = now;
      socketRef.current.emit('typing', activeId);
    }
  };

  // Ctrl/Cmd+B/I/U, Enter continuing a list, Tab indenting one. Goes through
  // the same setBody + writeDraft pair as typing, so a shortcut can't leave the
  // saved draft behind the text on screen.
  const composerKeys = useFormatKeys({
    getEl: () => composerRef.current,
    value: body,
    onChange: (v) => { setBody(v); writeDraft(activeId, v); },
  });


  const [mentionHi, setMentionHi] = useState(0);
  const mentionMatches = useMemo(() => {
    // Suggest channel members first (they can see the channel); fall back to all
    // users only if member list hasn't loaded.
    const pool = channelMembers.length ? channelMembers : (users || []);
    return filterMentionPool(pool, mentionQuery, user.id);
  }, [mentionQuery, channelMembers, users, user.id]);

  // People typed as @Name who match a real user but aren't in this channel —
  // they won't see the message, so warn the author before they send.
  const nonMemberMentions = useMemo(() => {
    if (!body.includes('@') || !channelMemberIds.size || !active || active.kind === 'dm') return [];
    const lower = body.toLowerCase();
    return (users || [])
      .filter(u => u.id !== user.id && !channelMemberIds.has(u.id))
      .filter(u => lower.includes('@' + chatName(u).toLowerCase()) || lower.includes('@' + (u.name || '').toLowerCase()))
      .sort((a, b) => chatName(b).length - chatName(a).length);
  }, [body, users, channelMemberIds, active, user.id]);

  const insertMention = (name) => {
    const ta = composerRef.current;
    const caret = ta ? ta.selectionStart : body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]*)$/, '@' + name + ' ');
    const after = body.slice(caret);
    setBody(before + after);
    setMentionQuery(null);
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(before.length, before.length); } });
  };

  // One key handler for both composer layouts. The phone renders the textarea
  // on its own row and the desktop renders it inline with the buttons, but they
  // are the same field and must behave identically — two copies of this is how
  // @mentions start working on one layout and not the other.
  const composerKeyDown = (e) => {
    // While the @mention menu is open: arrows move, Enter/Tab picks.
    if (mentionMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionHi(h => Math.min(h + 1, mentionMatches.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionHi(h => Math.max(h - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(chatName(mentionMatches[mentionHi] || mentionMatches[0])); return; }
    }
    if (e.key === 'Escape' && mentionQuery !== null) { setMentionQuery(null); return; }
    // The mention menu gets first refusal on every key above; only then do the
    // formatting shortcuts see it.
    if (composerKeys(e)) return;
    // Enter makes a new line; Tab moves to the Send button (then Enter/click sends).
  };
  const translateMessage = useCallback(async (m, lang) => {
    const r = await apiPost(`/comms/messages/${m.id}/translate`, { lang });
    return r.text;
  }, []);
  const setLang = (l) => { setViewerLang(l); localStorage.setItem('op_lang', l); };
  // Segmented control: Original (off) / EN / ES — one tap does everything.
  const setTranslateMode = (mode) => {
    if (mode === 'off') {
      setAutoTranslate(false);
    } else {
      setAutoTranslate(true);
      setLang(mode);
    }
    localStorage.setItem('comms_translate_mode', mode);
  };
  useEffect(() => {
    // Restore the remembered language for translate mode on first load.
    const mode = localStorage.getItem('comms_translate_mode');
    if (mode === 'en' || mode === 'es') setViewerLang(mode);
     
  }, []);

  // Channel auto-translate: batch-translate everything on screen in ONE request
  // (the old per-message burst rate-limited and looked broken). Cache-aware on
  // the server; results accumulate in autoTrans keyed by message+lang.
  const translatingBatch = useRef(false);
  useEffect(() => {
    if (!autoTranslate || !translateOn || !activeId || !messages.length) return;
    const need = messages.filter(m => m.body && !m.deleted && autoTrans[`${m.id}:${viewerLang}`] === undefined).map(m => m.id);
    if (!need.length || translatingBatch.current) return;
    translatingBatch.current = true;
    setTranslatingNow(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await apiPost(`/comms/channels/${activeId}/translate`, { ids: need, lang: viewerLang });
        if (cancelled) return;
        setAutoTrans(prev => {
          const n = { ...prev };
          for (const id of need) n[`${id}:${viewerLang}`] = r.translations[id] ?? null;
          return n;
        });
      } catch { /* retried on next messages/lang change */ }
      finally { translatingBatch.current = false; setTranslatingNow(false); }
    })();
    return () => { cancelled = true; };
  }, [autoTranslate, viewerLang, messages, activeId, translateOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link from a push notification: land on the exact message. If it's a
  // thread reply, open the thread drawer too. Highlight briefly either way.
  //
  // The ref alone cannot TRIGGER anything — writing a ref re-runs no effect,
  // which is why a notification tapped while its channel was already on
  // screen used to scroll nowhere: the resolve effect below only woke on
  // messages/activeId changing, and neither had. `pendingTick` is the wake-up
  // call; bump it every time a target message is queued.
  const pendingMsgRef = useRef(null);
  const [pendingTick, setPendingTick] = useState(0);
  const queueMessage = useCallback((mid) => {
    if (!mid) return;
    pendingMsgRef.current = mid;
    // A deep link names an exact message — it outranks the open-at-first-unread
    // landing, which would otherwise scroll away from it.
    landOnNewRef.current = null;
    setPendingTick(t => t + 1);
  }, []);
  useEffect(() => { queueMessage(openMessageId); }, [openMessageId, openNonce, queueMessage]);

  // Tapping a ReadyDoc link inside a message (ReadyBot reminders, cross-links)
  // jumps straight to that conversation/message instead of reloading the site.
  useEffect(() => {
    const onOpen = (e) => {
      const { channelId, messageId } = e.detail || {};
      if (!channelId) return;
      openChannel(channelId);
      queueMessage(messageId);
    };
    window.addEventListener('comms-open-channel', onOpen);
    return () => window.removeEventListener('comms-open-channel', onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mid = pendingMsgRef.current;
    if (!mid || !activeId || !messages.length) return;
    const inList = messages.find(x => x.id === mid);
    const finish = (targetId) => {
      pendingMsgRef.current = null;
      pinnedRef.current = false; // we're navigating to a specific spot, not the bottom
      setHighlightId(targetId);
      requestAnimationFrame(() => {
        document.querySelector(`[data-mid="${targetId}"]`)?.scrollIntoView({ block: 'center' });
      });
      setTimeout(() => setHighlightId(null), 3000);
    };
    if (inList) { finish(mid); return; }
    // Not in the main list — likely a thread reply. Resolve its parent and open
    // the thread drawer on it.
    (async () => {
      try {
        const m = await apiFetch(`/comms/messages/${mid}`);
        if (m.channel_id !== activeId) return; // channel changed underneath us
        if (m.parent_id) {
          const parent = messages.find(x => x.id === m.parent_id) || await apiFetch(`/comms/messages/${m.parent_id}`);
          pendingMsgRef.current = null;
          setReplyTo(parent);
          if (messages.some(x => x.id === m.parent_id)) finish(m.parent_id);
        } else {
          pendingMsgRef.current = null; // older than the loaded window; give up quietly
        }
      } catch { pendingMsgRef.current = null; }
    })();
    // pendingTick is the wake-up for a target queued while messages/activeId
    // were already settled — a notification tapped inside its own channel.
  }, [messages, activeId, pendingTick]);

  const pushSupported = ('serviceWorker' in navigator) && ('PushManager' in window);

  const doSubscribe = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    const { key } = await apiFetch('/comms/push/key');
    if (!key) return false; // server has no VAPID keys — nothing to subscribe to
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await apiPost('/comms/push/subscribe', { subscription: sub.toJSON() });
    setPushSubscribed(true);
    return true;
  }, []);

  // Reflect any existing subscription; and auto-enable notifications by default
  // (unless the user has explicitly turned them off before) so people don't miss
  // messages. Only auto-requests when the browser permission isn't already denied.
  useEffect(() => {
    if (!pushOn || !pushSupported) return;
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(async (sub) => {
      if (sub) {
        // A subscription is bound to the VAPID key it was created with. If the
        // server's key has changed since, this one is undeliverable forever —
        // and it looks perfectly healthy from the phone, which is exactly how
        // someone ends up silently getting nothing on every device. Detect the
        // mismatch and rebuild the subscription against the current key.
        try {
          const { key } = await apiFetch('/comms/push/key');
          const mine = subKeyToBase64(sub.options?.applicationServerKey);
          if (key && mine && mine !== key) {
            await apiPost('/comms/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
            await sub.unsubscribe().catch(() => {});
            await doSubscribe();
            return;
          }
        } catch { /* fall through and re-register what we have */ }
        setPushSubscribed(true);
        // Self-heal: the browser still holds a subscription, but the server's
        // copy can be gone (pruned after a transient 410, a DB restore, a
        // re-seed). Re-register it — the endpoint upserts, so this is a no-op
        // when the row is already there, and repairs silent-notification loss
        // when it isn't.
        apiPost('/comms/push/subscribe', { subscription: sub.toJSON() }).catch(() => {});
        return;
      }
      const optedOut = localStorage.getItem('comms_push_optout') === '1';
      if (!optedOut && (typeof Notification !== 'undefined') && Notification.permission !== 'denied') {
        try { await doSubscribe(); } catch { /* leave the bell for manual enable */ }
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushOn, pushSupported]);

  const togglePush = async () => {
    if (!pushSupported) { alert('Notifications are not supported on this device/browser.'); return; }
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushSubscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await apiPost('/comms/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
        setPushSubscribed(false);
        localStorage.setItem('comms_push_optout', '1'); // remember the user's choice
      } else {
        localStorage.removeItem('comms_push_optout');
        const ok = await doSubscribe();
        if (!ok) return;
      }
    } catch (e) { alert(e.message || 'Could not update notifications'); }
    finally { setPushBusy(false); }
  };

  const markChannelRead = async (id) => { try { await apiPost(`/comms/channels/${id}/read`, {}); refreshChannels(); clearChannelNotifications(id); } catch { /* ignore */ } };
  // Marking unread means "I'll come back to this" — so leave the conversation.
  // Staying in it would just re-mark it read the moment the screen settled,
  // which is exactly the behaviour that lost people's unread before.
  const markUnread = useCallback(async (m) => {
    try { await apiPost(`/comms/messages/${m.id}/unread`, {}); } catch { /* ignore */ }
    backToList();
    refreshChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshChannels]);

  const toggleDmPick = (id) => setDmSelected(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  const startDm = async () => {
    if (!dmSelected.length) return;
    let ch;
    if (dmSelected.length === 1) {
      ch = await apiPost(`/comms/dm/${dmSelected[0]}`, {}); // 1:1 DM
    } else if (dmGroupName.trim()) {
      // Named multi-person group → a private, member-managed channel (Slack-style
      // group): the creator owns it and can add/remove people and rename later.
      ch = await apiPost('/comms/channels', { name: dmGroupName.trim(), kind: 'private', member_ids: dmSelected });
    } else {
      ch = await apiPost('/comms/dm', { user_ids: dmSelected }); // unnamed group DM
    }
    setShowDmPicker(false); setDmSearch(''); setDmSelected([]); setDmGroupName('');
    await refreshChannels();
    openChannel(ch.id);
  };

  const dmCandidates = useMemo(() => {
    const q = dmSearch.toLowerCase();
    // Search both forms — someone typing a middle name should still find them.
    return (users || []).filter(u => u.id !== user.id
      && (chatName(u).toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)));
  }, [users, dmSearch, user.id]);

  // Debounced keyword/semantic search. Ask mode is manual (runs on Enter) since
  // it calls the AI — we don't want a request per keystroke.
  useEffect(() => {
    if (searchMode === 'ask') return;
    if (searchQ.trim().length < 2) {
      setSearchResults(null); setAnswer(null); setSearching(false); setSearchMeta(null); return;
    }
    setSearching(true); setAnswer(null);
    const mode = searchMode === 'smart' ? 'semantic' : 'keyword';
    const params = new URLSearchParams({ q: searchQ.trim(), mode, sort: searchSort });
    if (fChannel) params.set('channel_id', fChannel);
    if (fPerson) params.set('user_id', fPerson);
    if (fFrom) params.set('from', fFrom);
    if (fTo) params.set('to', fTo);
    const t = setTimeout(() => {
      apiFetch(`/comms/search?${params}`)
        .then(r => { setSearchResults(r.results || []); setSearchMeta(r); })
        .catch(() => { setSearchResults([]); setSearchMeta(null); })
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, searchMode, searchSort, fChannel, fPerson, fFrom, fTo]);

  const runAsk = async () => {
    const question = searchQ.trim();
    if (question.length < 3) return;
    setSearching(true); setAnswer(null); setSearchResults(null);
    try {
      const r = await apiPost('/comms/ask', { question });
      setAnswer(r.answer); setSearchResults(r.sources || []);
    } catch (e) { setAnswer(`⚠️ ${e.message || 'Ask failed'}`); setSearchResults([]); }
    finally { setSearching(false); }
  };

  const anyFilter = !!(fChannel || fPerson || fFrom || fTo);
  const clearFilters = () => { setFChannel(''); setFPerson(''); setFFrom(''); setFTo(''); };
  const clearSearch = () => {
    setSearchQ(''); setSearchResults(null); setAnswer(null); setSearchMeta(null);
    clearFilters(); setSearchSort('relevance');
  };
  // Land on the message, not just the channel it lives in. The deep-link path
  // already knows how to scroll to a message and open its thread if it's a
  // reply — a search hit is the same kind of destination.
  const openResult = (r) => {
    const id = r.id;
    clearSearch();
    openChannel(r.channel_id);
    pendingMsgRef.current = id;
  };

  // Date headings, but only when the order is chronological — grouping a
  // relevance-ranked list by day would just scatter one-item headings through
  // it. `key` keeps React stable across re-sorts.
  const searchGroups = useMemo(() => {
    const rows = searchResults || [];
    if (!rows.length) return [];
    if (searchSort === 'relevance' || searchMode === 'ask') return [{ key: 'all', label: null, items: rows }];
    const out = [];
    for (const r of rows) {
      const day = String(r.created_at).slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.key === day) last.items.push(r);
      else out.push({ key: day, label: dayLabel(r.created_at), items: [r] });
    }
    return out;
  }, [searchResults, searchSort, searchMode]);

  const ChannelBtn = ({ c, icon: Icon, highlight, onHover }) => {
    const unread = c.unread > 0;
    const mentioned = c.mentions > 0;
    const isActive = activeId === c.id;
    // Unread channels stand out: a blue dot in the gutter + bold, full-black name.
    // Hovering an unread channel swaps its count for a "mark read" checkmark
    // (per-channel — there's no global "mark everything read").
    return (
    <div onClick={() => openChannel(c.id)} onMouseEnter={onHover}
      className={`group/ch w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm cursor-pointer ${isActive ? 'bg-powder-600 text-white' : highlight ? 'bg-powder-50 text-powder-700' : unread ? 'text-gray-900 hover:bg-gray-100' : 'text-gray-600 hover:bg-gray-100'}`}>
      <span className="w-1.5 shrink-0 flex items-center justify-center">
        {unread && !isActive && <span className={`h-1.5 w-1.5 rounded-full ${mentioned ? 'bg-red-500' : 'bg-powder-500'}`} />}
      </span>
      <Icon size={14} className="shrink-0 opacity-80" />
      <span className={`truncate flex-1 text-left ${unread && !isActive ? 'font-bold' : ''}`}>{c.name}</span>
      {mentioned && <span className={`text-[10px] font-bold px-1.5 rounded-full bg-red-500 text-white ${unread ? 'group-hover/ch:hidden' : ''}`} title="You were mentioned">@{c.mentions}</span>}
      {unread && !mentioned && <span className={`text-[10px] font-bold px-1.5 rounded-full group-hover/ch:hidden ${isActive ? 'bg-white/25 text-white' : 'bg-powder-500 text-white'}`}>{c.unread}</span>}
      {unread && (
        <button onClick={(e) => { e.stopPropagation(); markChannelRead(c.id); }} title="Mark read"
          className={`hidden group-hover/ch:inline-flex items-center p-0.5 rounded ${isActive ? 'text-white hover:bg-white/20' : 'text-gray-400 hover:text-powder-600 hover:bg-gray-200'}`}>
          <CheckCheck size={13} />
        </button>
      )}
    </div>
    );
  };

  return (
    // bottomNavPadding: the app keeps its bottom tab bar visible under Messages
    // (users who navigate by quick tabs), so leave room for it on phones.
    <div className={`fixed inset-0 bg-white flex flex-col ${bottomNavPadding ? 'pb-14 md:pb-0' : ''}`}>
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-gray-200 shrink-0">
        {onBackToModule ? (
          <button onClick={onBackToModule} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-semibold text-powder-700 bg-powder-50 hover:bg-powder-100 rounded-lg shrink-0" title={`Back to ${backLabel}`}>
            <ArrowLeft size={16} /> {backLabel}
          </button>
        ) : onExit ? (
        <button onClick={onExit} className="flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg shrink-0" title="Switch to ReadyDoc">
          <ArrowLeft size={16} /> <span className="hidden sm:inline">ReadyDoc</span>
        </button>
        ) : null}
        {onSplitScreen && (
          <button onClick={onSplitScreen} className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg shrink-0"
            data-tip="Split screen: dock Messages beside the modules">
            <Columns2 size={15} /> Split screen
          </button>
        )}
        {onGoToSchedule && (
          <button onClick={onGoToSchedule} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg shrink-0" title="Go to the Production Schedule">
            <CalendarDays size={16} /> <span className="hidden sm:inline">Schedule</span>
          </button>
        )}
        <div className="h-5 w-px bg-gray-200 shrink-0 hidden sm:block" />
        <MessageSquare size={18} className="text-powder-600 shrink-0" />
        <span className="font-bold text-gray-900 shrink-0 hidden sm:inline">Messages</span>
        <div className="ml-2 sm:ml-4 flex items-center gap-2 flex-1 min-w-0 sm:max-w-lg">
          <div className="relative flex-1">
            {searchMode === 'ask' ? <Sparkles size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-powder-500" />
              : <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />}
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchMode === 'ask') runAsk(); }}
              placeholder={searchMode === 'ask' ? 'Ask about your messages…' : searchMode === 'smart' ? 'Smart search…' : 'Search messages…'}
              className="w-full pl-8 pr-7 py-1.5 border border-gray-300 rounded-lg text-sm" />
            {searchQ && <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
          </div>
          {/* Mode tabs inline on desktop; on mobile they move to a second row (below). */}
          {(semanticOn || askOn) && (
            <div className="hidden sm:flex rounded-lg border border-gray-200 overflow-hidden text-xs shrink-0">
              {[['keyword', 'Keyword'], semanticOn && ['smart', 'Smart'], askOn && ['ask', 'Ask']].filter(Boolean).map(([m, label]) => (
                <button key={m} onClick={() => { setSearchMode(m); setSearchResults(null); setAnswer(null); }}
                  className={`px-2.5 py-1.5 font-medium ${searchMode === m ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
          {onSetHome && (
            <button onClick={() => onSetHome('messages')} data-tip={homePref === 'messages' ? 'Messages is your home screen' : 'Make Messages your home screen'} data-tip-left
              className={`hidden sm:block p-2 rounded-lg ${homePref === 'messages' ? 'text-powder-600 bg-powder-50 hover:bg-powder-100' : 'text-gray-400 hover:bg-gray-100'}`}>
              <Home size={16} />
            </button>
          )}
          {user.role === 'admin' && (
            <button onClick={() => setShowSettings(true)} data-tip="Communication settings" data-tip-left
              className="p-2 rounded-lg text-gray-400 hover:bg-gray-100">
              <Settings size={16} />
            </button>
          )}
          {pushOn && (
            <button onClick={() => setShowNotifStatus(true)} disabled={pushBusy} data-tip-left
              data-tip={pushSubscribed ? 'Notifications on — check status' : 'Notifications off — set them up'}
              className={`p-2 rounded-lg ${pushSubscribed ? 'text-powder-600 bg-powder-50 hover:bg-powder-100' : 'text-gray-400 hover:bg-gray-100'}`}>
              {pushSubscribed ? <Bell size={16} /> : <BellOff size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile: search mode tabs move to their own row so the top bar stays clean */}
      {(semanticOn || askOn) && searchQ && (
        <div className="sm:hidden flex gap-1 px-4 py-1.5 border-b border-gray-200 shrink-0">
          {[['keyword', 'Keyword'], semanticOn && ['smart', 'Smart'], askOn && ['ask', 'Ask']].filter(Boolean).map(([m, label]) => (
            <button key={m} onClick={() => { setSearchMode(m); setSearchResults(null); setAnswer(null); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${searchMode === m ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{label}</button>
          ))}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* sidebar — full width on phones, hidden there once a channel is open */}
        <div className={`w-full md:w-60 border-r border-gray-200 flex-col shrink-0 overflow-y-auto p-2 space-y-3 ${showMainMobile ? 'hidden md:flex' : 'flex'}`}>
          {/* Activity — everything that involved you, in one feed. Sits above
              Threads because Threads is a subset of it. */}
          <button onClick={() => { recordNav({ view: 'activity' }); setActivityOpen(true); setThreadsOpen(false); setMobileThread(false); clearSearch(); rememberView('activity'); }}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${activityOpen ? 'bg-powder-600 text-white font-medium' : `hover:bg-gray-100 ${activityUnread?.all ? 'text-gray-900 font-bold' : 'text-gray-700 font-medium'}`}`}>
            <Bell size={15} className="opacity-80" /> Activity
            {!!activityUnread?.all && !activityOpen && (
              <span className="ml-auto px-1.5 py-0.5 rounded-full bg-powder-600 text-white text-[10px] font-bold">{activityUnread.all}</span>
            )}
          </button>
          {/* Threads inbox shortcut (like Slack) */}
          <button onClick={() => { recordNav({ view: 'threads' }); setThreadsOpen(true); setActivityOpen(false); setMobileThread(false); clearSearch(); rememberView('threads'); }}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${threadsOpen ? 'bg-powder-600 text-white font-medium' : `hover:bg-gray-100 ${threadUnread?.total ? 'text-gray-900 font-bold' : 'text-gray-700 font-medium'}`}`}>
            <MessageSquare size={15} className="opacity-80" /> Threads
            {/* Replies no longer inflate the channel's count, so this badge is
                the only place an unanswered thread shows up. */}
            {!!threadUnread?.total && !threadsOpen && (
              <span className="ml-auto px-1.5 py-0.5 rounded-full bg-powder-600 text-white text-[10px] font-bold">{threadUnread.total}</span>
            )}
          </button>
          {/* Quick filter — type to filter channels & DMs, ↑/↓ + Enter to jump */}
          <div className="relative px-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={chanFilter}
              onChange={e => { setChanFilter(e.target.value); setChanHi(0); }}
              onKeyDown={e => {
                if (!chanMatches.length) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); setChanHi(h => Math.min(h + 1, chanMatches.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setChanHi(h => Math.max(h - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); openChannel(chanMatches[chanHi].id); }
                else if (e.key === 'Escape') { setChanFilter(''); }
              }}
              placeholder="Jump to channel or person…"
              className="w-full pl-7 pr-6 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 focus:bg-white focus:border-powder-300 outline-none" />
            {chanFilter && <button onClick={() => setChanFilter('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>}
          </div>

          {chanTerm ? (
            /* Filtered flat result list (quick-switcher) */
            <div className="space-y-0.5">
              {chanMatches.length === 0
                ? <p className="px-2 py-4 text-center text-xs text-gray-400">No channels or people match “{chanFilter.trim()}”.</p>
                : chanMatches.map((c, idx) => (
                    <ChannelBtn key={c.id} c={c} icon={kindIcon(c)} highlight={idx === chanHi} onHover={() => setChanHi(idx)} />
                  ))}
            </div>
          ) : (
          <>
          {/* Drafts — unsent messages, Slack-style, above everything */}
          {channelDrafts.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[10px] font-bold uppercase text-amber-600">Drafts</div>
              <div className="space-y-0.5">
                {channelDrafts.map(d => (
                  <button key={'d' + d.channel.id} onClick={() => openChannel(d.channel.id)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-100">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                      <Edit2 size={12} className="text-amber-500 shrink-0" />
                      <span className="truncate">{d.channel.kind === 'public' ? `#${d.channel.name}` : (d.channel.name || 'Direct message')}</span>
                    </span>
                    <span className="block pl-5 text-[11px] text-gray-400 truncate">{d.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Unread — everything with new messages, floated to the top */}
          {unreadList.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[10px] font-bold uppercase text-powder-600">Unread</div>
              <div className="space-y-0.5">
                {unreadList.map(c => <ChannelBtn key={'u' + c.id} c={c} icon={kindIcon(c)} />)}
              </div>
            </div>
          )}
          {/* Pinned default channels (#general / #announcements) */}
          {pinned.length > 0 && (
            <div className="space-y-0.5">
              {pinned.map(c => <ChannelBtn key={c.id} c={c} icon={kindIcon(c)} />)}
            </div>
          )}
          {/* Admin sections */}
          {sectionGroups.map(sec => {
            const open = !collapsedSecs[sec.id];
            return (
              <div key={sec.id}>
                <button onClick={() => setCollapsedSecs(s => ({ ...s, [sec.id]: !s[sec.id] }))} className="w-full flex items-center gap-1 px-2 mb-1 text-[10px] font-bold uppercase text-gray-400 hover:text-gray-600">
                  {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {sec.name}
                </button>
                {open && <div className="space-y-0.5">{sec.channels.map(c => <ChannelBtn key={c.id} c={c} icon={kindIcon(c)} />)}</div>}
              </div>
            );
          })}
          {/* Ungrouped channels */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-bold uppercase text-gray-400">{sectionGroups.length ? 'Channels' : 'Channels'}</span>
              <button onClick={() => setNewChannel(true)} className="text-gray-400 hover:text-powder-600" data-tip="New channel" data-tip-left><Plus size={14} /></button>
            </div>
            <div className="space-y-0.5">
              {ungroupedCh.map(c => <ChannelBtn key={c.id} c={c} icon={kindIcon(c)} />)}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-bold uppercase text-gray-400">Direct Messages</span>
              <button onClick={() => setShowDmPicker(s => !s)} className="text-gray-400 hover:text-powder-600" data-tip="New message or group" data-tip-left><Plus size={14} /></button>
            </div>
            {showDmPicker && (
              <div className="mb-1 px-1">
                <input value={dmSearch} onChange={e => setDmSearch(e.target.value)} placeholder="Search people…" className="w-full px-2 py-1 border border-gray-300 rounded text-xs mb-1" autoFocus />
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                  {dmCandidates.map(u => {
                    const picked = dmSelected.includes(u.id);
                    return (
                      <button key={u.id} onClick={() => toggleDmPick(u.id)} className={`w-full flex items-center gap-2 text-left px-2 py-1.5 text-sm ${picked ? 'bg-powder-50' : 'hover:bg-gray-50'}`}>
                        <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${picked ? 'bg-powder-600 border-powder-600' : 'border-gray-300'}`}>{picked && <Check size={11} className="text-white" />}</span>
                        <span className="flex-1 truncate">{chatName(u)}</span>
                        <span className="text-[10px] text-gray-400 capitalize">{(u.department || '').replace('_', ' ')}</span>
                      </button>
                    );
                  })}
                </div>
                {dmSelected.length > 1 && (
                  <input value={dmGroupName} onChange={e => setDmGroupName(e.target.value)} placeholder="Group name (optional)…"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs mt-1" />
                )}
                <button onClick={startDm} disabled={!dmSelected.length}
                  className="w-full mt-1 px-2 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700 disabled:opacity-40">
                  {dmSelected.length <= 1 ? 'Message 1 person'
                    : dmGroupName.trim() ? `Create “${dmGroupName.trim()}” group (${dmSelected.length})`
                    : `Start group message (${dmSelected.length})`}
                </button>
                {dmSelected.length > 1 && (
                  <p className="text-[10px] text-gray-400 mt-1 px-0.5">Name it to make a group you can rename and add/remove people from later.</p>
                )}
              </div>
            )}
            <div className="space-y-0.5">
              {dms.map(c => <ChannelBtn key={c.id} c={c} icon={MessageSquare} />)}
            </div>
          </div>
          </>
          )}
        </div>

        {/* main pane — hidden on phones until a channel is opened */}
        <div className={`flex-1 flex-col min-w-0 ${showMainMobile ? 'flex' : 'hidden md:flex'}`}>
          {activityOpen ? (
            <ActivityView counts={activityUnread} refreshKey={threadTick} backButton={backButton}
              onRead={() => { refreshActivityUnread(); refreshThreadUnread?.(); }}
              onCloseMobile={() => setActivityOpen(false)}
              onOpenMessage={(it) => {
                // Reuse the deep-link path the push notifications already use:
                // it opens the channel, scrolls to the exact message, and
                // resolves a thread reply into its thread drawer.
                setActivityOpen(false);
                window.dispatchEvent(new CustomEvent('comms-open-channel', {
                  detail: { channelId: it.channel_id, messageId: it.id },
                }));
                refreshActivityUnread();
              }} />
          ) : threadsOpen ? (
            <ThreadsView me={user} mentionUsers={users} canTranslate={translateOn} viewerLang={viewerLang}
              onTranslate={translateMessage} onOpenChannel={openChannel} onCloseMobile={() => setThreadsOpen(false)}
              onRead={refreshThreadUnread} refreshKey={threadTick} backButton={backButton} />
          ) : (searchResults !== null || answer !== null || (searching && searchMode === 'ask')) ? (
            <>
              <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
                {searchMode === 'ask' ? <Sparkles size={16} className="text-powder-500" /> : <Search size={16} className="text-gray-400" />}
                <span className="font-semibold text-gray-900">{searchMode === 'ask' ? 'Ask' : 'Search'}</span>
                {searching ? <Loader2 size={14} className="animate-spin text-gray-400" />
                  : searchMode === 'ask'
                    ? <span className="text-xs text-gray-400">{(searchResults?.length || 0)} source{(searchResults?.length || 0) !== 1 ? 's' : ''}</span>
                    : <span className="text-xs text-gray-400">
                        {searchMeta?.total ?? searchResults?.length ?? 0}{searchMeta?.truncated ? '+' : ''} result
                        {(searchMeta?.total ?? 0) !== 1 ? 's' : ''} for “{searchQ.trim()}”
                      </span>}
                {anyFilter && (
                  <button onClick={clearFilters} className="ml-auto text-xs text-powder-600 hover:underline">Clear filters</button>
                )}
              </div>

              {/* Narrowing: sort, then the channels and people the hits are
                  actually in, then a date window. Counts come from the whole
                  hit set, so the options don't vanish as you pick them. */}
              {searchMode !== 'ask' && searchResults !== null && (
                <div className="px-3 py-2 border-b border-gray-100 space-y-1.5 shrink-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase text-gray-400">Sort</span>
                    {[['relevance', 'Best match'], ['newest', 'Newest'], ['oldest', 'Oldest']].map(([v, l]) => (
                      <button key={v} onClick={() => setSearchSort(v)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${searchSort === v ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{l}</button>
                    ))}
                  </div>
                  {(searchMeta?.facets?.channels || []).length > 1 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold uppercase text-gray-400">In</span>
                      {(searchMeta.facets.channels).slice(0, 8).map(c => (
                        <button key={c.id} onClick={() => setFChannel(fChannel === c.id ? '' : c.id)}
                          className={`px-2 py-0.5 rounded-full text-[11px] border max-w-[45%] truncate ${fChannel === c.id ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                          {c.kind === 'dm' ? c.name : '#' + c.name} <span className="opacity-60">{c.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {(searchMeta?.facets?.people || []).length > 1 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold uppercase text-gray-400">From</span>
                      {(searchMeta.facets.people).slice(0, 8).map(p => (
                        <button key={p.id} onClick={() => setFPerson(fPerson === p.id ? '' : p.id)}
                          className={`px-2 py-0.5 rounded-full text-[11px] border max-w-[45%] truncate ${fPerson === p.id ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                          {p.name} <span className="opacity-60">{p.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase text-gray-400">Between</span>
                    <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)}
                      className="px-1.5 py-0.5 border border-gray-200 rounded text-[11px] text-gray-600" />
                    <span className="text-[11px] text-gray-400">and</span>
                    <input type="date" value={fTo} onChange={e => setFTo(e.target.value)}
                      className="px-1.5 py-0.5 border border-gray-200 rounded text-[11px] text-gray-600" />
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-2">
                {searchMode === 'ask' && searching && <p className="text-center text-sm text-gray-400 py-8">Thinking…</p>}
                {answer !== null && (
                  <div className="mb-2 mx-1 p-3 rounded-xl bg-powder-50 border border-powder-100">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-powder-600 mb-1"><Sparkles size={12} /> Answer</div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{answer}</p>
                  </div>
                )}
                {answer !== null && (searchResults?.length || 0) > 0 && <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase text-gray-400">Sources</div>}
                {!searching && searchResults !== null && searchResults.length === 0 && searchMode !== 'ask' && (
                  <p className="text-center text-sm text-gray-400 py-8">
                    {(fChannel || fPerson || fFrom || fTo)
                      ? 'No messages match those filters.' : 'No messages found.'}
                  </p>
                )}
                {searchGroups.map(g => (
                  <div key={g.key}>
                    {/* Grouped by day when sorted by date — a run of results
                        from one afternoon reads as one thing, not fifteen. */}
                    {g.label && (
                      <div className="sticky top-0 bg-white/95 backdrop-blur px-3 py-1 text-[10px] font-bold uppercase text-gray-400 z-10">
                        {g.label}
                      </div>
                    )}
                    {g.items.map(r => (
                      <button key={r.id} onClick={() => openResult(r)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50">
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-0.5">
                          {r.channel_kind === 'dm' ? <MessageSquare size={11} /> : r.channel_kind === 'private' ? <Lock size={11} /> : <Hash size={11} />}
                          <span className="font-medium text-gray-500">{r.channel_kind === 'dm' ? r.channel_name : (r.channel_kind === 'private' ? '' : '#') + r.channel_name}</span>
                          <span>· {r.user_name} · {fmtTime(r.created_at)}</span>
                          {r.parent_id && <span className="px-1 rounded bg-gray-100 text-gray-500">thread reply</span>}
                        </div>
                        <div className="text-sm text-gray-800 line-clamp-2">{highlightTerms(r.body, searchQ)}</div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : active ? (
            <div className="flex-1 flex flex-col min-h-0 bg-white will-change-transform"
              {...swipeBack.handlers} style={swipeBack.style}>
              <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
                <button onClick={backToList} className="md:hidden -ml-1 p-1 text-gray-500 hover:text-gray-700" title="Back to channels"><ArrowLeft size={18} /></button>
                {/* One step back through where you've been — the previous
                    channel, or Threads/Activity. Distinct from the mobile
                    arrow beside it, which goes to the channel LIST. */}
                {backButton}
                {active.kind === 'dm' ? <MessageSquare size={16} className="text-gray-400" /> : active.post_policy === 'admins' ? <Megaphone size={16} className="text-gray-400" /> : active.kind === 'private' ? <Lock size={16} className="text-gray-400" /> : <Hash size={16} className="text-gray-400" />}
                {active.kind === 'dm' ? (
                  <span className="font-semibold text-gray-900 truncate shrink-0 max-w-[55%] sm:max-w-none">{active.name}</span>
                ) : (
                  <button onClick={() => setShowDetails(true)} className="font-semibold text-gray-900 truncate shrink-0 max-w-[55%] sm:max-w-none hover:underline" title="Channel details & members">{active.name}</button>
                )}
                {active.topic && <span className="text-xs text-gray-400 truncate hidden sm:inline">— {active.topic}</span>}
                {active.kind !== 'dm' && (
                  <button onClick={() => setShowDetails(true)} className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100" title="Members">
                    <Users size={13} /> Details
                  </button>
                )}
                {/* Jump to a date in this channel's history */}
                <label className={`${translateOn ? '' : 'ml-auto '}relative p-1.5 rounded-lg cursor-pointer ${dateView ? 'text-powder-600 bg-powder-50' : 'text-gray-400 hover:bg-gray-100'}`} data-tip="Jump to date">
                  <CalendarDays size={15} />
                  <input type="date" value={dateView || ''} onChange={e => e.target.value && jumpToDate(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                </label>
                {/* Gmail-style popout: this conversation in its own slim window,
                    so it stays visible while working in a module. Hidden when
                    already inside the standalone /chat view (popout or dock). */}
                {!window.location.pathname.startsWith('/chat') && (
                  <button onClick={() => window.open(`/chat?cid=${active.id}`, `powderops-chat-${active.id}`, 'width=460,height=760')}
                    className="hidden md:block p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" data-tip="Open in a separate window">
                    <ExternalLink size={15} />
                  </button>
                )}
                {translateOn && (
                  <div className="ml-auto flex items-center gap-1.5">
                    {translatingNow && <span className="text-[10px] text-gray-400 hidden sm:inline">Translating…</span>}
                    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden" title="Show messages in their original language, or translate everything to English / Spanish">
                      <Languages size={13} className="text-gray-400 ml-1.5 mr-0.5" />
                      {[['off', 'Original'], ['en', 'EN'], ['es', 'ES']].map(([mode, label]) => {
                        const active = mode === 'off' ? !autoTranslate : (autoTranslate && viewerLang === mode);
                        return (
                          <button key={mode} onClick={() => setTranslateMode(mode)}
                            className={`px-2 py-1 text-[10px] font-bold ${active ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div ref={scrollRef} onScroll={onMessagesScroll} className="relative flex-1 overflow-y-auto py-2"
                onDragEnter={onDragEnterMsgs} onDragOver={onDragOverMsgs} onDragLeave={onDragLeaveMsgs} onDrop={onDropMsgs}>
                {dropHover && (
                  <div className="sticky top-0 z-30 mx-3 pointer-events-none">
                    <div className="border-2 border-dashed border-powder-400 bg-powder-50/90 rounded-xl py-6 text-center text-sm font-semibold text-powder-700 shadow-sm">
                      Drop files to attach to #{active?.name || 'this conversation'}
                    </div>
                  </div>
                )}
                <div>{/* single wrapper so the pinned-scroll ResizeObserver sees content height */}
                {messages.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No messages yet. Say hello 👋</p>}
                {messages.map((m, i) => {
                  const showDay = i === 0 || dayKey(m.created_at) !== dayKey(messages[i - 1].created_at);
                  const firstNew = newMarkerTs !== null && !dateView && m.created_at > newMarkerTs &&
                    (i === 0 || messages[i - 1].created_at <= newMarkerTs);
                  return (
                    <div key={m.id} data-mid={m.id}>
                      {showDay && <DateDivider iso={m.created_at} />}
                      {firstNew && <NewDivider />}
                      <Message m={m} me={user} onReact={react} onUnreact={unreact} onEdit={editMsg} onDelete={delMsg} onReply={setReplyTo} onMarkUnread={markUnread}
                        canTranslate={translateOn} viewerLang={viewerLang} onTranslate={translateMessage}
                        autoText={autoTranslate ? autoTrans[`${m.id}:${viewerLang}`] : null}
                        highlighted={highlightId === m.id} mentionUsers={users} />
                    </div>
                  );
                })}
                </div>
              </div>
              {dateView ? (
                <div className="relative">
                  <button onClick={backToLatest}
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-full shadow-lg hover:bg-gray-800 whitespace-nowrap">
                    Viewing from {dateView} · Back to latest <ChevronDown size={13} />
                  </button>
                </div>
              ) : showJump && (
                <div className="relative">
                  <button onClick={jumpToLatest}
                    className="absolute bottom-2 right-4 z-10 flex items-center gap-1 px-3 py-1.5 bg-powder-600 text-white text-xs font-semibold rounded-full shadow-lg hover:bg-powder-700">
                    <ChevronDown size={14} /> Jump to latest
                  </button>
                </div>
              )}
              {active.post_policy === 'admins' && user.role !== 'admin' ? (
                <div className="border-t border-gray-200 p-3 shrink-0 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
                  <Lock size={14} /> Only admins can post in #{active.name}. You can still read and react.
                </div>
              ) : (
              <div className="border-t border-gray-200 p-3 shrink-0 relative">
                <MentionDropdown matches={mentionMatches} hi={mentionHi} onHover={setMentionHi} onPick={insertMention} />
                <div className="h-4 px-1 mb-0.5 text-[11px] text-gray-400 italic">
                  {typers.length === 1 ? `${typers[0].user_name} is typing…`
                    : typers.length === 2 ? `${typers[0].user_name} and ${typers[1].user_name} are typing…`
                    : typers.length > 2 ? 'Several people are typing…' : ''}
                </div>
                {(pending.length > 0 || uploading) && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pending.map(p => (
                      <div key={p.id} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border border-gray-200 bg-gray-50 text-xs">
                        {isAudio(p) ? <Mic size={12} className="text-powder-600" /> : p.is_video ? <Film size={12} className="text-powder-600" /> : p.is_image ? <Paperclip size={12} className="text-powder-600" /> : <FileText size={12} className="text-powder-600" />}
                        <span className="max-w-[140px] truncate text-gray-700">{p.filename}</span>
                        <button onClick={() => removePending(p.id)} className="text-gray-400 hover:text-red-500"><X size={13} /></button>
                      </div>
                    ))}
                    {uploading && <UploadProgress percent={progress} />}
                  </div>
                )}
                {nonMemberMentions.length > 0 && (
                  <div className="mb-2 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                    <Bell size={12} className="mt-0.5 shrink-0" />
                    <span>
                      {nonMemberMentions.map(u => chatName(u)).join(', ')} {nonMemberMentions.length === 1 ? "isn't" : "aren't"} in this channel, so {nonMemberMentions.length === 1 ? "they won't" : "they won't"} see this message.
                      {user.role === 'admin' && ' Add them from the channel title → Members.'}
                    </span>
                  </div>
                )}
                <div className="mb-1 -ml-1">
                  <FormatBar getEl={() => composerRef.current} value={body}
                    onChange={v => { setBody(v); writeDraft(activeId, v); }} />
                </div>
                {/* ON A PHONE THE TEXT BOX GETS ITS OWN ROW.
                    Everything used to sit on one line: paperclip, camera, mic,
                    emoji, the textarea and Send. Those five controls are ~42px
                    each plus gaps — about 250px — so on a 390px phone the place
                    you actually type was squeezed into ~110px, a tall narrow
                    slot two or three words wide. The buttons are all optional;
                    the message is the point, so it gets the width and the
                    controls go underneath. Desktop keeps the single row, where
                    250px of chrome is a rounding error. */}
                <div className={isCompactLayout ? 'flex flex-col gap-1.5' : 'flex items-end gap-2'}>
                  {isCompactLayout && (
                    <div className="flex-1 relative">
                      <textarea ref={composerRef} value={body} onChange={onBodyChange} rows={1} onPaste={onComposerPaste}
                        onKeyDown={composerKeyDown}
                        placeholder={`Message ${active.kind === 'dm' ? active.name : '#' + active.name}`}
                        className={`w-full relative bg-transparent text-gray-900 placeholder:text-gray-400 border-gray-300 rounded-xl resize-none max-h-60 overflow-y-auto ${COMPOSER_METRICS}`} />
                    </div>
                  )}
                  <div className={isCompactLayout ? 'flex items-end gap-1' : 'contents'}>
                  {/* SEND IS FIRST IN THE DOM, LAST ON SCREEN. Tab out of the
                      textarea used to walk the paperclip, camera, mic and
                      emoji before reaching Send, so the Tab-then-Enter habit
                      stopped working — the thread reply box has always had
                      the icons before the textarea, which is why it behaved.
                      `order-last` keeps the button where it looks right
                      while the keyboard reaches it first; the icons still
                      follow on subsequent tabs rather than being skipped. */}
                  <button onClick={send} disabled={!body.trim() && pending.length === 0}
                    className="order-last p-2.5 bg-powder-600 text-white rounded-xl hover:bg-powder-700 disabled:opacity-40"
                    title="Send"><Send size={16} /></button>
                  {storageOn && (
                    <>
                      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} />
                      <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className="p-2.5 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded-xl disabled:opacity-40" title="Attach files">
                        <Paperclip size={18} />
                      </button>
                      {/* Camera-first capture on phones: one tap opens the camera
                          (capture="environment"), so "photograph the label" is a
                          single gesture. The paperclip stays general on purpose —
                          forcing capture on it would block picking existing files. */}
                      {isCompactLayout && (
                        <>
                          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickFiles} />
                          <button onClick={() => cameraInputRef.current?.click()} disabled={uploading}
                            className="p-2.5 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded-xl disabled:opacity-40" title="Take a photo">
                            <Camera size={18} />
                          </button>
                        </>
                      )}
                      <VoiceNoteButton disabled={uploading} onReady={(f) => uploadFiles([f])} />
                    </>
                  )}
                  <div className="relative">
                    <button onClick={() => setShowComposerEmoji(s => !s)}
                      className="p-2.5 text-gray-400 hover:text-powder-600 hover:bg-gray-100 rounded-xl" title="Emoji"><Smile size={18} /></button>
                    {showComposerEmoji && (
                      <EmojiPicker align="left" vertical="up" onClose={() => setShowComposerEmoji(false)}
                        onPick={(e) => { setBody(b => b + e); setShowComposerEmoji(false); composerRef.current?.focus(); }} />
                    )}
                  </div>
                  {/* The overlay draws the formatting; the textarea's own text
                      is transparent so the caret and selection still come from
                      the real field. Both carry the SAME metric classes.

                      DESKTOP ONLY, and that is not caution for its own sake.
                      The whole technique rests on the overlay and the textarea
                      laying every character out identically, and mobile
                      browsers break exactly that: Android Chrome and iOS Safari
                      inflate text in BLOCK elements ("font boosting") while
                      leaving form controls alone, so the layer drifts a
                      fraction of a pixel per character and the caret walks away
                      from the text as you type. `text-size-adjust: none` on the
                      layer is the documented fix and is applied, but it can't
                      be verified from here on a real device — and a caret that
                      wanders on the phone everyone types on all day is a far
                      worse trade than not seeing bold while you write it.
                      Re-enable when someone has tested it on an actual
                      handset. */}
                  {!isCompactLayout && (
                    <div className="flex-1 relative">
                      <MarkupOverlay textareaRef={composerRef} value={body} className={`${COMPOSER_METRICS} border-transparent rounded-xl`} />
                      <textarea ref={composerRef} value={body} onChange={onBodyChange} rows={1} onPaste={onComposerPaste}
                        onKeyDown={composerKeyDown}
                        placeholder={`Message ${active.kind === 'dm' ? active.name : '#' + active.name}`}
                        // Its own text is hidden ONLY because the layer behind
                        // is drawing it; the caret and selection still come
                        // from the real field.
                        className={`w-full relative bg-transparent placeholder:text-gray-400 border-gray-300 rounded-xl resize-none max-h-60 overflow-y-auto ${COMPOSER_METRICS} text-transparent caret-gray-900 selection:bg-powder-200/50 selection:text-transparent`} />
                    </div>
                  )}
                  {isCompactLayout && <div className="flex-1" />}
                  </div>
                </div>
              </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Select a channel to start.</div>
          )}
        </div>
      </div>

      {newChannel && <NewChannelModal users={users} me={user} onClose={() => setNewChannel(false)} onCreated={(ch) => { setNewChannel(false); refreshChannels(); openChannel(ch.id); }} />}
      {showSettings && <CommsSettings users={users} onClose={() => setShowSettings(false)} onChanged={refreshChannels} />}
      {showNotifStatus && (
        <NotificationStatus subscribed={pushSubscribed} onClose={() => setShowNotifStatus(false)}
          onToggle={async () => { await togglePush(); }} />
      )}
      {showDetails && active && active.kind !== 'dm' && <ChannelDetails channel={active} me={user} users={users} onClose={() => setShowDetails(false)} onChanged={refreshChannels} />}
      {taskDraft && active && (
        <MessageToTaskModal draft={taskDraft} channel={active} users={users}
          onCancel={() => setTaskDraft(null)}
          onJustSend={() => { const t = taskDraft; setTaskDraft(null); postMessage(t); }}
          onCreated={() => { setTaskDraft(null); setBody(''); writeDraft(active.id, ''); setPending([]); }} />
      )}
      {replyTo && <ThreadPanel parent={replyTo} me={user} onThreadRead={refreshThreadUnread} channelName={active?.kind === 'dm' ? active.name : '#' + (active?.name || '')} mentionUsers={users} members={channelMembers}
        canTranslate={translateOn} viewerLang={viewerLang} onTranslate={translateMessage} socketRef={socketRef} storageOn={storageOn}
        onClose={() => setReplyTo(null)} onChanged={() => loadMessages(activeId)} />}
    </div>
  );
}
