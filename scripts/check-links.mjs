// Where a generated link points — pure, no server.
//
// Every texted link, magic link and ReadyBot deep link is built from these two
// values, and the failure they produce is the quiet kind: a link that is
// slightly wrong still looks like a link. So the shapes a person actually types
// into Railway are asserted here rather than discovered in somebody's messages.
import { normalizeOrigin, appBaseUrl, readyDocOrigin } from '../server/links.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const FALLBACK = 'https://fallback.example';

console.log('\nA bare hostname is what a person types, and it has one reading');
{
  t('a bare host gets https', normalizeOrigin('app.powder-ops.com', FALLBACK) === 'https://app.powder-ops.com',
    normalizeOrigin('app.powder-ops.com', FALLBACK));
  t('and so does one with a path-less trailing slash',
    normalizeOrigin('app.powder-ops.com/', FALLBACK) === 'https://app.powder-ops.com');
  t('surrounding whitespace is trimmed — a paste into Railway carries it',
    normalizeOrigin('  app.powder-ops.com  ', FALLBACK) === 'https://app.powder-ops.com');
  t('THE RESULT PARSES, which is what the launcher redirect and smsStatus need',
    new URL(normalizeOrigin('app.powder-ops.com', FALLBACK)).hostname === 'app.powder-ops.com');
}

console.log('\nAn explicit scheme is never rewritten');
{
  t('https is left alone', normalizeOrigin('https://app.powder-ops.com', FALLBACK) === 'https://app.powder-ops.com');
  // The verify scripts point these at a local server; silently upgrading that
  // to https would break every one of them.
  t('http://localhost:4987 SURVIVES — the verifies run on it',
    normalizeOrigin('http://localhost:4987', FALLBACK) === 'http://localhost:4987');
  t('a trailing slash still comes off', normalizeOrigin('https://app.powder-ops.com/', FALLBACK) === 'https://app.powder-ops.com');
  t('and several do too', normalizeOrigin('https://app.powder-ops.com///', FALLBACK) === 'https://app.powder-ops.com');
}

console.log('\nUnset means the default, and a default is never a guess at a domain');
{
  t('empty falls back', normalizeOrigin('', FALLBACK) === FALLBACK);
  t('undefined falls back', normalizeOrigin(undefined, FALLBACK) === FALLBACK);
  t('whitespace alone falls back', normalizeOrigin('   ', FALLBACK) === FALLBACK);
}

console.log('\nThe two origins stay separate — they are not interchangeable');
{
  const before = { app: process.env.APP_BASE_URL, rd: process.env.READYDOC_ORIGIN };
  process.env.APP_BASE_URL = 'start.powder-ops.com';
  process.env.READYDOC_ORIGIN = 'app.powder-ops.com';
  t('the front door is its own value', appBaseUrl() === 'https://start.powder-ops.com', appBaseUrl());
  t('the app origin is its own value', readyDocOrigin() === 'https://app.powder-ops.com', readyDocOrigin());
  t('AND THEY ARE NOT THE SAME — a link built from the front door lands on the launcher',
    appBaseUrl() !== readyDocOrigin());
  delete process.env.APP_BASE_URL; delete process.env.READYDOC_ORIGIN;
  t('with neither set, both still answer with a usable URL',
    !!new URL(appBaseUrl()).hostname && !!new URL(readyDocOrigin()).hostname);
  if (before.app !== undefined) process.env.APP_BASE_URL = before.app;
  if (before.rd !== undefined) process.env.READYDOC_ORIGIN = before.rd;
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
