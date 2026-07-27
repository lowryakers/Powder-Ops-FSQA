// Where the app's public links point.
//
// Two origins are in play and they are NOT interchangeable:
//
//   • APP_BASE_URL    — the public front door (start.powder-ops.com). That host
//     serves the workspace launcher, and Twilio webhook signatures are computed
//     over this exact origin, so it must match the Twilio console entry.
//
//   • READYDOC_ORIGIN — where the ReadyDoc app itself is served. Every deep link
//     we generate (channel/message jumps, approval magic links, digests) has to
//     target this origin: the launcher host answers page requests with the
//     workspace picker, so a link sent there lands on the picker instead of the
//     record. server.js redirects launcher-host deep links here as a backstop,
//     but generating them correctly saves the extra hop.
//
// Set READYDOC_ORIGIN if the app ever moves to its own custom domain.

export function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://start.powder-ops.com').replace(/\/$/, '');
}

export function readyDocOrigin() {
  return (process.env.READYDOC_ORIGIN || 'https://powderops-fsqa.up.railway.app').replace(/\/$/, '');
}
