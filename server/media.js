// Shared rules for large file uploads (video, mainly).
//
// Two things forced this into its own module. First, video is an order of
// magnitude bigger than the photos and PDFs everything else deals in — a
// 3-minute phone clip is comfortably 150 MB — so it needs its own ceiling
// rather than one global limit that's either too small for video or
// recklessly large for everything else. Second, the old path read every
// upload into memory (multer.memoryStorage) before handing the Buffer to R2;
// two people posting videos at once would have been enough to push the
// container over its memory limit. Uploads now land on disk and are streamed
// out, so peak memory is a few MB regardless of file size.
//
// Callers are responsible for calling cleanupTemp() when they're done — in a
// finally block, so a failed upload doesn't leave the temp file behind.
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { v4 as uuid } from 'uuid';

// Non-video files keep the limit they've always had; video gets its own.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

// A TRAINING VIDEO IS NOT A CHAT CLIP, and 200 MB is about ninety seconds of
// 1080p off a phone — not enough for a machine procedure, which is the one
// thing course materials exist to hold. Disk-backed and streamed to R2 in 8 MB
// parts, so the ceiling costs disk for the length of the request rather than
// memory. Opt-in per route like MAX_ARCHIVE_BYTES, never the default: the
// comms paperclip has no reason to accept two gigabytes.
//
// It is not raised further because nothing here resumes. One HTTP request has
// to survive the whole upload, and past this a slow uplink is likelier to time
// out than to finish — at which point the answer is to trim the video, not to
// raise a number again.
export const MAX_LONG_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

// Extensions phones and cameras actually produce. Matched on the filename as
// well as the mime type because browsers are inconsistent about .mov and .mkv
// (Safari sends video/quicktime, some Android builds send an empty type).
//
// AN UNRECOGNISED VIDEO IS NOT MERELY UNPLAYABLE — IT FALLS TO THE 25 MB
// NON-VIDEO RULE, and is refused with a message about "non-video files" for a
// file the person is looking at in a video player. So the list covers what a
// camcorder, a screen recorder and Windows produce as well as what a phone
// does. Nothing downstream assumes these play: the material card already falls
// back to a download when the browser rejects the codec.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|3g2|hevc|wmv|mpg|mpeg|mpe|m2v|mts|m2ts|ts|ogv|asf|f4v|divx|vob|mxf)$/i;

export function isVideo(contentType, filename) {
  if ((contentType || '').toLowerCase().startsWith('video/')) return true;
  return VIDEO_EXT.test(filename || '');
}

export const humanSize = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

// Temp landing area for in-flight uploads. Deliberately the OS temp dir and
// not the data volume: these files live for seconds and must never compete
// with the database for space.
const TEMP_DIR = path.join(os.tmpdir(), 'readydoc-uploads');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// A disk-backed multer instance. fileSize is the video ceiling because multer
// enforces one limit for the whole request; per-file rules are applied after
// the fact by rejectOversize(), which can tell video from everything else.
export function mediaUpload({ files = 10, maxBytes = MAX_VIDEO_BYTES } = {}) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, TEMP_DIR),
      filename: (_req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname || '').slice(0, 12)}`),
    }),
    limits: { fileSize: maxBytes, files },
  });
}

// A whole document archive is not a video and is not a 25 MB attachment — the
// plant's supplier folders are a few gigabytes, and one vendor's zip is already
// 28 MB. Multer writes to disk, so a large ceiling costs disk rather than
// memory. It is opt-in per route, never the default.
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

// Enforce the smaller non-video limit. Returns an error message, or null when
// everything is within bounds.
export function rejectOversize(files, { videoMax = null } = {}) {
  for (const f of files) {
    if (isVideo(f.mimetype, f.originalname)) {
      // Multer's own ceiling is the real guard; this only reports a size a
      // route deliberately allows less of than the request did.
      if (videoMax && f.size > videoMax) {
        return `${f.originalname || 'That video'} is ${humanSize(f.size)} — larger than the ${humanSize(videoMax)} limit.`;
      }
      continue;
    }
    if (f.size > MAX_FILE_BYTES) {
      // NAME THE SIZE, not just the limit. "Too large" sends somebody back to
      // guess; "312 MB against a 25 MB limit" tells them what to do about it.
      return `${f.originalname || 'That file'} is ${humanSize(f.size)} — larger than the ${humanSize(MAX_FILE_BYTES)} limit for files that are not video.`;
    }
  }
  return null;
}

// Best-effort removal of the temp files behind a request.
export function cleanupTemp(files) {
  for (const f of files || []) {
    if (f?.path) fs.promises.unlink(f.path).catch(() => {});
  }
}

// Multer signals an over-limit upload with a MulterError rather than a plain
// throw; translate it into a message a person can act on.
export function uploadErrorMessage(err, maxBytes = MAX_VIDEO_BYTES) {
  // The ceiling is per ROUTE now (the archive raises it), so a message naming
  // the video limit on an archive upload would send somebody to split a zip
  // that was never too big.
  if (err?.code === 'LIMIT_FILE_SIZE') return `Files must be under ${humanSize(maxBytes)}.`;
  if (err?.code === 'LIMIT_FILE_COUNT') return 'Too many files in one upload.';
  return err?.message || 'Upload failed.';
}
