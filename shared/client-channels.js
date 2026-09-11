// `client--*` is a reserved channel family: one private channel per outside
// company we coordinate manufacturing with.
//
// THE WHOLE POINT OF THE PREFIX IS THAT THE APP CAN RECOGNISE ONE.
// A client channel holds people who do not work here, so several rules that are
// right for a department channel are wrong for this one — above all that a
// message can be turned into plant work. `teamForChannel()` maps #batching to
// the Batching team; a client channel maps to NOTHING, deliberately, and the
// server refuses to raise a task from one whatever the client sends.
//
// ONE DEFINITION, BOTH SIDES. `src/lib/taskIntent.js` and `server/api/comms.js`
// both import `isClientChannel` from here. A second regex in a component is how
// the button disappears on one screen and the endpoint keeps answering on the
// other — the defect this codebase keeps unpicking.
export const CLIENT_PREFIX = 'client--';

/** Is this channel name part of the reserved client family? */
export function isClientChannel(name) {
  return String(name || '').toLowerCase().startsWith(CLIENT_PREFIX);
}

// WIP IS DEFINED ONCE, HERE, AND QUOTED EVERYWHERE IT APPEARS.
// "WIP ≤ 30" is a release rule two companies act on, so the two companies have
// to be counting the same thing. Written out in full every time it is shown.
export const WIP_DEFINITION =
  'count of active Manufacturing Orders open at any given time (plant-wide)';

export const WIP_LIMIT = 30;

/**
 * The channel guide, posted and pinned as the first message.
 *
 * It opens with how to put ReadyDoc on a phone, because everything after it
 * assumes the reader can reach the app — a guide whose first useful step is on
 * page two is a guide nobody follows.
 *
 * @param {{appUrl?: string, wipLimit?: number}} [opts]
 */
export function clientChannelGuide({ appUrl = 'https://start.powder-ops.com', wipLimit = WIP_LIMIT } = {}) {
  return [
    '*Welcome — this is the manufacturing coordination channel.*',
    'Everything about live production between our two companies happens here, in writing, in one place.',
    '',
    '*1. Put ReadyDoc on your phone (2 minutes)*',
    `Open ${appUrl} in your phone's browser and sign in first, then:`,
    '',
    '*iPhone — Safari*',
    '1. Tap the Share button (the square with the arrow, at the bottom).',
    '2. Scroll down and tap *Add to Home Screen*.',
    '3. Tap *Add*. The ReadyDoc icon is now on your home screen.',
    'Safari only — the Add to Home Screen option does not appear in Chrome on iPhone.',
    '',
    '*Android — Chrome*',
    '1. Tap the three dots at the top right.',
    '2. Tap *Add to Home screen* (or *Install app*).',
    '3. Tap *Install*.',
    '',
    'Open it from that icon from now on. It runs full screen and can send you a notification when you are mentioned.',
    '',
    '*2. Use Threads — one thread per MO or topic*',
    'Reply *in the thread*, not in the main channel. One MO, one thread; one topic, one thread.',
    'Tap a message, then *Reply in thread*. Your unread count is tracked per thread, so a thread you are not part of never buries the one you are.',
    'Start a new thread for a new MO rather than continuing an old one — the thread is the record of that order.',
    '',
    '*3. Do not schedule from chat*',
    'Nothing typed in this channel starts a Manufacturing Order, changes a run date or moves the production schedule. It cannot: the app will not raise plant work from a client channel.',
    'A message here is a request or a status. The schedule is set by Powder Ops planning and confirmed back to you here.',
    '',
    '*4. Release rules — an order runs when all three are true*',
    '1. *BOM confirmed.* The bill of materials is agreed and locked for that MO.',
    '2. *All materials on-site.* Everything: raws, film, pouches, scoops, boxes. Partial is not released.',
    `3. *WIP ≤ ${wipLimit}.* WIP is the ${WIP_DEFINITION}.`,
    '',
    `If any one of the three is not met, the order waits and we say so here. Exceptions to any of these are *Lowry only* — nobody else can waive them, and an exception is written in this channel so there is a record of it.`,
    '',
    '*5. Status update template*',
    'Post a status in the MO\'s thread, in this shape:',
    '',
    '```',
    'MO: <number>   Product: <name>   Qty: <units>',
    'Stage: BOM / materials / scheduled / running / packed / shipped',
    'BOM confirmed: yes / no',
    'Materials on-site: yes / no  (if no: what is missing, and the ETA)',
    'Target date: <date>          Changed since last update: yes / no',
    'Blockers: <none, or what and who is holding it>',
    '```',
    '',
    '*6. Who to @ — and when to attach instead*',
    '- *@Lowry* — exceptions to the release rules, WIP over the limit, schedule conflicts.',
    '- *@Adam* — BOM, routing, artwork, anything on QA hold.',
    '- *@Jake* — materials, inbound deliveries, the dock.',
    '- *@Matt*, *@Jean* (projects), *@Cristian* (ops) — packaging.',
    '- *@Alex* — Account Manager: status, and whether an order has cleared the release gate.',
    '',
    'Attach the document rather than describing it: POs, artwork, specs, COAs, packing lists, photos of a problem. Use the paperclip, and attach it in the MO\'s thread so it stays with that order.',
    'A document attached here is *not* an approval and does not create a payable — it is the copy we both work from.',
  ].join('\n');
}
