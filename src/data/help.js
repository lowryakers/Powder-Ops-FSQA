// ONE HELP PAGE (D-397). "How do I…" guides and "What's new", as data.
//
// WHY DATA. A help page that is a wiki goes stale the first month and is then
// worse than none, because people trust it. So every guide carries what lets a
// check find the stale ones without Lowry reading them:
//   * `open`    — the screen it is about, as a nav/tab id. `check:help` fails
//                 when that id no longer exists in App.jsx.
//   * `checked` — the day somebody last walked the steps on the real screen.
//                 `check:help` fails a guide older than 180 days.
//   * `owner`   — WHO re-checks it (a team, never a person's name), so a stale
//                 guide has somebody to send it to who is not Lowry.
//
// RULES FOR WRITING ONE
//   * The title is the question a person actually asks, ending in "?".
//   * 3 to 7 steps. Name buttons exactly as the screen does. A step is a sentence,
//     or { who, title, body } when the steps pass between teams.
//   * A guide explains; it never decides. The server still enforces every
//     rule. If a guide and the app disagree, the app is right and the guide
//     is fixed.
//   * Floor guides (`es`) carry plant Spanish beside the English.
//   * It is NOT a controlled document. An SOP is the procedure; a guide is
//     where the button is. Link the SOP in `sop` where one exists.
//
// `module` decides who sees the guide: the same nav rule the sidebar uses
// (navItemVisible). Leave it out and everybody who works here sees it.
//
// WHAT'S NEW: one entry per change people will notice, written in the PR that
// ships it. `d` is the decision number in docs/v2/decisions.md, which the check
// also confirms exists. Newest first.

export const HELP_AUDIENCES = {
  everyone: 'Everyone',
  floor: 'Floor',
  supervisors: 'Supervisors',
  qa: 'QA',
  doc_control: 'Document Control',
  office: 'Office',
  admin: 'Admins',
};

export const GUIDES = [
  /* ── Everyone / the floor ─────────────────────────────────────────── */
  {
    id: 'complete-a-task',
    q: 'How do I complete a task on my phone?',
    for: 'floor', owner: 'Supervisors', checked: '2026-11-25',
    open: { tab: 'operator' },
    keywords: 'operator view my tasks done finish complete card overdue',
    steps: [
      'Open Operator View ("My Tasks" on a phone).',
      'Tap the task card. Overdue work is at the top.',
      'Tick every step you did. On food-contact work every step must be ticked.',
      'Enter any readings it asks for, then tap Mark Complete.',
      'If something could not be done, tap Report an issue instead of leaving a box empty.',
    ],
    es: {
      q: '¿Cómo completo una tarea en mi teléfono?',
      steps: [
        'Abra Operator View ("Mis tareas" en el teléfono).',
        'Toque la tarjeta de la tarea. Lo atrasado está arriba.',
        'Marque cada paso que hizo. En trabajo con contacto con alimentos, todos los pasos deben marcarse.',
        'Escriba las lecturas que pida y toque Marcar Completa.',
        'Si algo no se pudo hacer, toque Reportar un problema en vez de dejar una casilla vacía.',
      ],
    },
  },
  {
    id: 'raise-a-concern',
    q: 'How do I raise a food safety concern?',
    for: 'everyone', owner: 'QA', checked: '2026-11-25',
    open: { tab: 'operator' },
    keywords: 'concern speak up anonymous culture report gmp sanitation safety',
    steps: [
      'Open Operator View.',
      'Tap Raise a concern.',
      'Say what you saw and where. A photo helps.',
      'Send it. QA reads every one.',
    ],
    es: {
      q: '¿Cómo reporto una inquietud de inocuidad?',
      steps: [
        'Abra Operator View.',
        'Toque Reportar una inquietud.',
        'Diga qué vio y dónde. Una foto ayuda.',
        'Envíela. QA lee todas.',
      ],
    },
  },
  {
    id: 'daily-scale-check',
    q: 'How do I run the daily scale check?',
    for: 'floor', owner: 'QA', checked: '2026-11-25',
    open: { tab: 'form-scale' }, sop: 'FORM 417-01 to 417-05',
    keywords: 'scale verification weights three point calibration 417 daily',
    steps: [
      'On Operator View, tap Run the check on the scale card (or open Scale Verification).',
      'Pick the scale.',
      'Place each certified weight where the picture shows and type the reading.',
      'Submit. A reading outside tolerance fails the check on its own.',
      'A failed check: stop using the scale and tell QA.',
    ],
    es: {
      q: '¿Cómo hago la verificación diaria de la báscula?',
      steps: [
        'En Operator View, toque Hacer la verificación en la tarjeta de la báscula (o abra Scale Verification).',
        'Elija la báscula.',
        'Ponga cada pesa certificada donde muestra el dibujo y escriba la lectura.',
        'Envíe. Una lectura fuera de tolerancia reprueba la verificación sola.',
        'Si reprueba: deje de usar la báscula y avise a QA.',
      ],
    },
  },
  {
    id: 'sign-out-an-item',
    q: 'How do I sign out a tool, knife or chemical?',
    for: 'floor', owner: 'QA', checked: '2026-11-25',
    open: { tab: 'form-maintenance' }, sop: 'FORM 703-01 / 440-02',
    keywords: 'sign out check out tool chemical knife blade return used up',
    steps: [
      'Open Sign Out an Item (or Knife Sign In/Out for blades).',
      'Pick the item. A chemical asks what it will be used on.',
      'Submit. It now shows under Out now.',
      'When it comes back, tap Return in the sidebar. Ran out? Pick Used up.',
    ],
    es: {
      q: '¿Cómo saco una herramienta, cuchillo o químico?',
      steps: [
        'Abra Sign Out an Item (o Knife Sign In/Out para navajas).',
        'Elija el artículo. Un químico pregunta en qué se va a usar.',
        'Envíe. Ahora aparece en Out now.',
        'Cuando regrese, toque Return en el menú. ¿Se acabó? Elija Used up.',
      ],
    },
  },
  {
    id: 'start-a-run',
    q: 'How do I start a production run?',
    for: 'floor', owner: 'Supervisors', checked: '2026-11-25',
    open: { tab: 'operator' },
    keywords: 'run start mo mrpeasy pre-op preop room production',
    steps: [
      'On Operator View, open "Starting an MO in MRPEasy?" (or Production Log → Runs).',
      'Pick the room and type the MO.',
      'Tap Start run.',
      'If the room has no passing Pre-Op since its last run, a Pre-Op clean task is raised for Cleaning.',
    ],
    es: {
      q: '¿Cómo empiezo una corrida de producción?',
      steps: [
        'En Operator View, abra "¿Empezando una MO en MRPEasy?" (o Production Log → Runs).',
        'Elija el cuarto y escriba la MO.',
        'Toque Iniciar corrida.',
        'Si el cuarto no tiene un Pre-Op aprobado desde su última corrida, se crea una tarea de limpieza Pre-Op.',
      ],
    },
  },
  {
    id: 'failed-xray',
    q: 'An X-ray or metal detector check failed. What do I do?',
    for: 'floor', owner: 'QA', checked: '2026-11-25',
    open: { tab: 'operator' },
    keywords: 'xray x-ray metal detector failed hold lot keychain',
    steps: [
      'Keep the check log in Keychain as usual.',
      'On Operator View, tap Log a failed check.',
      'Type the lot and what happened.',
      'Submit. The lot goes On Hold and QA decides what happens to it.',
    ],
    es: {
      q: 'Falló la revisión de rayos X o detector de metal. ¿Qué hago?',
      steps: [
        'Siga registrando la revisión en Keychain como siempre.',
        'En Operator View, toque Registrar una revisión fallida.',
        'Escriba el lote y lo que pasó.',
        'Envíe. El lote queda En espera y QA decide qué hacer.',
      ],
    },
  },
  {
    id: 'password-to-sign',
    q: 'Why does ReadyDoc ask for my password when I sign?',
    for: 'everyone', owner: 'QA', checked: '2026-11-25',
    keywords: 'signature password sign approve part 11 electronic signature',
    steps: [
      'A signature says that YOU reviewed this record now. Your password proves it is you, at that moment.',
      'Type your own password. It is never stored with the record.',
      'The first signature after signing in also asks for your name.',
      'Five wrong passwords lock signing for five minutes.',
    ],
    es: {
      q: '¿Por qué ReadyDoc pide mi contraseña al firmar?',
      steps: [
        'Una firma dice que USTED revisó este registro ahora. La contraseña prueba que es usted, en ese momento.',
        'Escriba su propia contraseña. Nunca se guarda con el registro.',
        'La primera firma después de entrar también pide su nombre.',
        'Cinco contraseñas equivocadas bloquean las firmas por cinco minutos.',
      ],
    },
  },
  {
    id: 'install-on-phone',
    q: 'How do I put ReadyDoc on my phone’s home screen?',
    for: 'everyone', owner: 'Office', checked: '2026-11-25',
    open: { href: '/install' },
    keywords: 'install app home screen phone icon add to home screen',
    steps: [
      'Open app.powder-ops.com/install on the phone.',
      'iPhone: tap Share, then Add to Home Screen.',
      'Android: tap the menu (⋮), then Install app.',
      'Open ReadyDoc from the new icon and sign in.',
    ],
    es: {
      q: '¿Cómo pongo ReadyDoc en la pantalla de inicio del teléfono?',
      steps: [
        'Abra app.powder-ops.com/install en el teléfono.',
        'iPhone: toque Compartir y luego Agregar a inicio.',
        'Android: toque el menú (⋮) y luego Instalar app.',
        'Abra ReadyDoc desde el ícono nuevo y entre.',
      ],
    },
  },

  {
    id: 'drop-a-coc',
    q: 'How do I drop a COC at the dock?',
    for: 'floor', owner: 'Purchasing', checked: '2026-11-25',
    module: 'coc-drop', open: { tab: 'coc-drop' },
    keywords: 'coc coa certificate compliance analysis photo dock delivery po scan email drop',
    steps: [
      'Open ReadyDoc and tap COC Drop (under Warehouse).',
      'Tap Take a photo of the COC for each page, or Choose a photo or PDF.',
      'Type the PO number if you know it, then tap Drop it.',
      'You are done. You do not need to scan or email it. Procurement matches it to the PO and files it.',
    ],
    es: {
      q: '¿Cómo entrego un COC en el andén?',
      steps: [
        'Abra ReadyDoc y toque COC Drop (en Warehouse).',
        'Toque “Take a photo of the COC” por cada página, o “Choose a photo or PDF”.',
        'Escriba el número de PO si lo sabe y toque “Drop it”.',
        'Listo. No tiene que escanearlo ni mandarlo por correo. Compras lo une al PO y lo archiva.',
      ],
    },
  },

  /* ── Supervisors and QA ───────────────────────────────────────────── */
  {
    id: 'who-sees-a-task',
    q: 'Who sees a recurring task, and how do I show it to one more person?',
    for: 'supervisors', owner: 'QA', checked: '2026-11-25',
    module: 'pm', open: { tab: 'pm-schedules' },
    keywords: 'recurring schedule also show to owner assign person team cover temp humidity friday who sees task route',
    steps: [
      'A recurring task belongs to a TEAM. Everyone in that department sees it. You usually do not need to name a person.',
      'If the person is not seeing it, check their department in Settings → Users first.',
      'To show it to someone outside the team (say, a person who covers it on Fridays): Task Center → Recurring Schedules, open the schedule, click Edit.',
      'Pick them under Also show to (optional) and save. It shows on their list every day it is due. A quality schedule has the same box.',
      'The team still owns the task; whoever completes a card first closes it for everyone.',
    ],
  },
  {
    id: 'correct-scale-room',
    q: 'A scale check has the wrong room. How do I correct it?',
    for: 'qa', owner: 'QA', checked: '2026-11-25',
    module: 'calibration', open: { tab: 'calibration', view: 'scale-verification' },
    keywords: 'scale verification wrong room correct edit verified revoke',
    steps: [
      'Calibration → Scale Verification. Click the check to open it.',
      'If it is already verified, click Revoke verification first. A signed check cannot change.',
      'Click Correct room, pick the right room and say why.',
      'Click Verify again and sign with your password.',
      'The old and new room and your reason are kept in the record’s history.',
    ],
  },
  {
    id: 'qa-review-sign',
    q: 'How do I sign a pile of records at once?',
    for: 'qa', owner: 'QA', checked: '2026-11-25',
    module: 'qa-review', open: { tab: 'qa-review' },
    keywords: 'qa review sign batch signature production entries sanitation sign-off queue',
    steps: [
      'Open QA Review. Each pile shows how many are waiting, oldest first.',
      'Pick a pile, tick the records you have read, then sign.',
      'Type your password once for the whole batch.',
      'A row that needs a closer look has no Sign button. Open it in its own screen.',
    ],
  },
  {
    id: 'correct-a-signed-record',
    q: 'I signed something with a mistake in it. How do I fix it?',
    for: 'everyone', owner: 'QA', checked: '2026-11-25',
    keywords: 'correct mistake wrong signed revoke edit change record',
    steps: [
      'A signed record is closed so nobody changes it under your name.',
      'Open the record and revoke YOUR signature (you or an admin can).',
      'Correct the record.',
      'Sign it again with your password. All three steps are kept in the history.',
    ],
  },
  {
    id: 'record-training',
    q: 'How do I record training for one person or a group?',
    for: 'supervisors', owner: 'QA', checked: '2026-11-25',
    module: 'training', open: { tab: 'training' },
    keywords: 'training record log completion group session competence trainer',
    steps: [
      'Training → Log Completion.',
      'Pick the course and the person. Several names make it a group session.',
      'Say how they were trained and in which language.',
      'Tick that they understand it (or attach a passed quiz). You sign that with your password.',
      'You cannot sign your own competence. Someone else records yours.',
    ],
  },
  {
    id: 'look-up-a-lot',
    q: 'How do I find everything about a lot, a machine or a person?',
    for: 'everyone', owner: 'QA', checked: '2026-11-25',
    module: 'records', open: { tab: 'records' },
    keywords: 'lookup lot batch trace recall machine equipment person everything',
    steps: [
      'Open Look up records.',
      'Type a lot, pick a machine, or pick a person.',
      'Every record you can open comes back, by kind.',
      'Anything not searched is named at the bottom, so you know what the list does not cover.',
    ],
  },
  {
    id: 'log-a-retain',
    q: 'How do I log a new retain sample?',
    for: 'qa', owner: 'QA', checked: '2026-11-25',
    module: 'retention-samples', open: { tab: 'retention-samples' },
    keywords: 'retain retention sample box lab pull',
    steps: [
      'Open Retention Samples.',
      'Click Log a pull.',
      'Pick the box, then type the item, lot and how many went to the lab and how many were kept.',
      'Save. A retain is never deleted; a wrong one is corrected.',
    ],
  },

  {
    id: 'pick-check',
    q: 'How do I file a FORM 100-01 pick check?',
    for: 'qa', owner: 'QA', checked: '2026-11-25',
    module: 'production-log', open: { tab: 'production-log', view: 'picks' }, sop: 'FORM 100-01 V1',
    keywords: 'pick check material verification form 100-01 mo pick list warehouse',
    steps: [
      'Production Log → Pick checks → new pick check.',
      'Type the MO and answer each of the five questions against the Pick List: Yes, No or N/A.',
      'A No needs a note, and the issue goes in the issues table for the Warehouse Team.',
      'The QA lead signs with their password. It cannot be signed until every question is answered.',
    ],
  },

  /* ── Receiving and suppliers ──────────────────────────────────────── */
  {
    id: 'file-coc-before-truck',
    q: 'How do I file a supplier’s COC / COA before the truck arrives?',
    for: 'qa', owner: 'QA', checked: '2026-11-25',
    module: 'suppliers', open: { tab: 'suppliers' },
    keywords: 'coc coa certificate compliance conformance analysis po part lot delivery',
    steps: [
      'Suppliers → open the supplier.',
      'Upload the file as "Certificate of compliance / conformance".',
      'Type the PO, the part number and the lot.',
      'Save. The dock is told in the receiving channel, and the receiving inspection offers it first when the PO matches.',
    ],
  },
  {
    id: 'incoming-sampling',
    q: 'How do I file the incoming sampling after a receiving inspection?',
    for: 'qa', owner: 'QA', checked: '2026-11-25',
    module: 'receiving-log', open: { tab: 'receiving-log' }, sop: 'SOP 402 V3',
    keywords: 'incoming sampling sample containers receiving raw material sop 402',
    steps: [
      'Receiving Log → open the signed inspection.',
      'Click Sample on the line you are sampling.',
      'Enter how many containers arrived. ReadyDoc says how many to sample.',
      'Work the steps, record the result, and sign with your password.',
    ],
  },

  {
    id: 'qualify-a-supplier',
    q: 'How does a supplier get qualified?',
    for: 'office', owner: 'Purchasing', checked: '2026-11-25',
    module: 'suppliers', open: { tab: 'suppliers' }, sop: 'SOP 404 V4',
    keywords: 'supplier qualify qualification approve questionnaire gmp gfsi certificate letter of guarantee banned purchasing',
    // Step objects ({ who, title, body }) are also what the Suppliers screen's
    // "How this works" card shows, so the two cannot disagree.
    steps: [
      {
        who: 'Purchasing',
        title: 'Set the supplier up',
        body: 'Open the supplier and press Edit details. Pick its Type (raw material, packaging, and so on) and tick “We still buy from this supplier” if we do. The type decides which documents they owe. A supplier not on the list yet is added with Add a supplier at the top of the page.',
      },
      {
        who: 'Purchasing',
        title: 'Send the questionnaire',
        body: 'Press Send questionnaire link and send the link to the supplier. They fill in and sign FORM 404-1 online, and it files itself on the supplier.',
      },
      {
        who: 'Purchasing',
        title: 'Collect their documents',
        body: 'Raw material and packaging suppliers must have a current third-party audit certificate: a GMP certificate or a GFSI certificate (SQF, BRCGS, FSSC 22000 or IFS). Use Attach certificate, pick which one it is, and enter its expiry date. Packaging and food-contact suppliers also need a letter of guarantee with its renewal date. Attach anything else (spec, COA, allergen statement) with Attach documents and pick what it is.',
      },
      {
        who: 'Purchasing',
        title: 'List what we buy from them',
        body: 'Under Ingredients, press Add an ingredient for each material, with its part number.',
      },
      {
        who: 'Quality',
        title: 'Check and decide',
        body: 'Quality checks each ingredient against the banned-substance lists, then records the decision: approved, conditional or not approved. Approval waits for the GMP or GFSI certificate and the banned-list check.',
      },
      {
        who: 'Purchasing',
        title: 'Keep it current',
        body: 'The Needs attention tab lists missing and expiring documents. Ask the supplier for the new copy before the old one runs out. Each approved supplier gets a review task once a year.',
      },
    ],
  },
  {
    id: 'new-product-to-print',
    q: 'How does a new product get from formula to print?',
    for: 'office', owner: 'Ops', checked: '2026-11-25',
    module: 'products', open: { tab: 'products', view: 'new-product' },
    keywords: 'new product sku gtin nutrition panel artwork shopify shiphero packaging po flow pipeline stage',
    steps: [
      'The formula is final and the fill weight confirmed.',
      'Ops creates the SKU in Products and assigns the GTIN from the GS1 site.',
      'The nutrition panel is approved, with the formula it was computed from.',
      'Shopify and ShipHero are set up and ticked off on the product.',
      'Artwork is released, then the packaging PO is placed.',
      'Products → Pipeline shows where every product is; New Product Creation lists all nine gates and who owns each.',
    ],
  },

  /* ── Document Control ─────────────────────────────────────────────── */
  {
    id: 'revise-an-sop',
    q: 'How do I put out a new revision of an SOP?',
    for: 'doc_control', owner: 'Document Control', checked: '2026-11-25',
    module: 'document-control', open: { tab: 'document-control' },
    keywords: 'sop revision new version approve qa review draft document',
    steps: [
      'Controlled Documents → open the SOP → start a new revision. ReadyDoc offers the next V number.',
      'Edit the draft. The approved one stays in force until the new one is approved.',
      'A QA supervisor reviews it with their password.',
      'Approve it with your password. The old revision is kept, and anyone owed retraining is listed once the course is marked updated.',
    ],
  },
  {
    id: 'change-a-limit',
    q: 'How do I change a limit, like an ATP or temperature limit?',
    for: 'doc_control', owner: 'Document Control', checked: '2026-11-25',
    module: 'controlled-changes', open: { tab: 'controlled-changes' },
    keywords: 'limit controlled value atp temperature humidity tolerance change approve',
    steps: [
      'Controlled Changes → find the value → Change.',
      'Type the new value and the reason.',
      'A QA supervisor reviews it, then Document Control approves it — two different people, both with a password.',
      'The app grades against the new value from that moment. Old records keep the limit they were graded against.',
    ],
  },
  {
    id: 'where-is-a-name-used',
    q: 'Where is a chemical, machine or title still written after a rename?',
    for: 'doc_control', owner: 'Document Control', checked: '2026-11-25',
    module: 'doc-review', open: { tab: 'doc-review' },
    keywords: 'rename name used where search chemical machine title',
    steps: [
      'Doc Control Review → Where is a name used?',
      'Type the old name.',
      'Every place it is still written is listed, with who changes it.',
      'Tasks, schedules and lists can be renamed from there. Filed records and documents never are.',
    ],
  },

  /* ── Office and admins ────────────────────────────────────────────── */
  {
    id: 'give-module-access',
    q: 'How do I give someone access to a screen?',
    for: 'admin', owner: 'Admins', checked: '2026-11-25',
    module: 'settings', open: { tab: 'settings', section: 'users' },
    keywords: 'access permission module grant view edit settings user',
    steps: [
      'Settings → Users → open the person.',
      'Under Module Access, set the screen to View or Edit.',
      'Save. "What they can open" on the record shows every screen and why.',
      'Every employee already has Messages and Operator View.',
    ],
  },
  {
    id: 'reset-a-password',
    q: 'Someone forgot their password. What do I do?',
    for: 'admin', owner: 'Admins', checked: '2026-11-25',
    module: 'settings', open: { tab: 'settings', section: 'users' },
    keywords: 'password reset forgot locked out temporary',
    steps: [
      'Settings → Users → open the person → Reset password.',
      'Give them the temporary password. It lasts three days.',
      'They sign in and must choose a new one before they can do anything else.',
      'A temporary password cannot sign records.',
    ],
  },
  {
    id: 'receiving-alert-channel',
    q: 'Where do the "COC filed" alerts for the dock post?',
    for: 'admin', owner: 'Admins', checked: '2026-11-25',
    module: 'settings', open: { tab: 'settings', section: 'readybot' },
    keywords: 'receiving alert channel coc coa readybot dock notification',
    steps: [
      'Settings → ReadyBot messages.',
      'Find the receiving alert and pick the channel (normally #receiving--shipping).',
      'Save. Nothing posts until a channel is chosen.',
    ],
  },
  {
    id: 'bot-add-suppliers',
    q: 'How do I let the Procurement bot add suppliers?',
    for: 'admin', owner: 'Admins', checked: '2026-11-25',
    module: 'settings', open: { tab: 'settings', section: 'users' },
    keywords: 'bot token procurement supplier add grant suppliers-edit module edit coc drop',
    steps: [
      'Settings → Users → the Procurement bot’s account → set Suppliers (and COC Drop) to Edit. Or tick suppliers-edit on its token in Settings → Bot API tokens.',
      'Either one works at once; setting the module back to View closes it again.',
      'The bot can now add a supplier. It starts Not qualified; qualifying it stays a person’s job.',
    ],
  },
];

// Newest first. Written in the PR that ships the change.
export const WHATS_NEW = [
  { date: '2026-11-25', d: 'D-400', module: 'settings', open: { tab: 'settings', section: 'users' },
    title: 'A bot works Suppliers, COC Drop and COA intake when its account has Edit',
    body: 'Set the bot account to Edit on Suppliers, COC Drop or COA in Settings → Users and its write token works there at once; View or off closes it. Approving, signing and deleting stay a person\'s.' },
  { date: '2026-11-25', d: 'D-399', module: 'pm', open: { tab: 'pm-schedules' },
    title: '"Owner" on a recurring task is now "Also show to"',
    body: 'Same box, clearer name: the team still owns the task, and the person picked also sees it on their list. On Recurring Schedules and Quality Schedules.' },
  { date: '2026-11-25', d: 'D-398', module: 'coc-drop', open: { tab: 'coc-drop' },
    title: 'COC Drop: photograph a COC at the dock',
    body: 'Warehouse → COC Drop. Take a photo of each page (or choose the PDF); no scanning or email. Quality and Purchasing match it to the PO and file it into the supplier library.' },
  { date: '2026-11-25', d: 'D-397', open: { tab: 'help' },
    title: 'Help: one page for how-tos and what’s new',
    body: 'Short guides for the screens you can open, in English and Spanish for the floor. Search it from the search box, or the ⓘ beside a page title.' },
  { date: '2026-11-25', d: 'D-396', module: 'calibration', open: { tab: 'calibration', view: 'scale-verification' },
    title: 'A scale check filed under the wrong room can be corrected',
    body: 'Open the check, revoke the verification if it was verified, then Correct room with a reason. The old room and the reason stay in its history.' },
  { date: '2026-11-25', d: 'D-395', module: 'production-log', open: { tab: 'production-log', view: 'picks' },
    title: 'FORM 100-01 pick checks are filed in ReadyDoc',
    body: 'Production Log → Pick checks: one sheet per pick. The QA lead answers the five questions against the Pick List and signs with a password.' },
  { date: '2026-11-25', d: 'D-394', module: 'receiving-log', open: { tab: 'receiving-log' },
    title: 'Incoming sampling is filed in ReadyDoc',
    body: 'After a receiving inspection is signed, click Sample on a line to file the sampling record SOP 402 V3 asks for. It tells you how many containers to open.' },
  { date: '2026-11-25', d: 'D-393', module: 'suppliers', open: { tab: 'suppliers' },
    title: 'The Procurement bot can add a supplier',
    body: 'With the suppliers-edit tick on its token. A supplier it adds starts Not qualified and shows "Added by bot"; a person still qualifies it.' },
  { date: '2026-11-25', d: 'D-392', module: 'receiving-log', open: { tab: 'receiving-log' },
    title: 'The dock is told when a COC / COA is filed with its PO',
    body: 'ReadyBot posts once in the receiving channel an admin picks in Settings → ReadyBot messages.' },
  { date: '2026-11-25', d: 'D-391', module: 'suppliers', open: { tab: 'suppliers' },
    title: 'File a delivery’s COC / COA before the truck',
    body: 'Upload it on the supplier with the PO, part and lot. The receiving inspection offers matching certificates first.' },
  { date: '2026-11-24', d: 'D-390', module: 'retention-samples', open: { tab: 'retention-samples' },
    title: 'New retains are logged in ReadyDoc',
    body: 'Retention Samples → Log a pull. A retain record is never deleted; a wrong one is corrected.' },
  { date: '2026-11-24', d: 'D-389', module: 'operator', open: { tab: 'operator' },
    title: 'A failed X-ray or metal-detector check puts the lot on hold',
    body: 'Log a failed check on the Operator View. The check log itself stays in Keychain.' },
  { date: '2026-11-24', d: 'D-387', module: 'operator', open: { tab: 'operator' },
    title: 'Start a run from the Operator View',
    body: '"Starting an MO in MRPEasy?" opens a run in ReadyDoc and asks for the room’s Pre-Op.' },
  { date: '2026-11-24', d: 'D-385', module: 'receiving-log', open: { tab: 'receiving-log' },
    title: 'Shipping and receiving sign-offs ask for your password',
    body: 'Signing off a shipping or receiving inspection, and approving a disposal, now ask for your password like every other signature.' },
  { date: '2026-11-23', d: 'D-375', module: 'records', open: { tab: 'records' },
    title: 'Look up records: one screen for a lot, a machine or a person',
    body: 'Every record you can open, in one search. It says which kinds of record it did not search.' },
  { date: '2026-11-23', d: 'D-368', module: 'quality-schedules', open: { tab: 'quality-schedules' },
    title: 'A quality schedule can name an owner',
    body: 'Like recurring maintenance tasks, a quality schedule can show for one named person as well as the team.' },
  { date: '2026-11-17', d: 'D-357', module: 'employees', open: { tab: 'employees' },
    title: 'Employees is one entry',
    body: 'People, Onboarding, Time Tracking, Pay Tracking and Policies are tabs under Employees.' },
  { date: '2026-11-17', d: 'D-356',
    title: 'HR in Messages',
    body: 'Every employee has a private "HR" conversation in Messages, read by the HR team and nobody else.' },
  { date: '2026-11-17', d: 'D-352', module: 'training', open: { tab: 'training' },
    title: 'Training has one way in',
    body: 'Several names on Log Completion make a group session. A phone opens Training on three buttons.' },
  { date: '2026-11-13', d: 'D-349', module: 'sanitation', open: { tab: 'sanitation' },
    title: 'A clean names its chemical',
    body: 'Completing a cleaning task asks which chemical was used, or "No chemical used".' },
];

// Which guides a person sees. `canOpen(tabId)` is the app's own nav rule.
export function guidesFor(canOpen) {
  return GUIDES.filter(g => !g.module || canOpen(g.module));
}
export function newsFor(canOpen) {
  return WHATS_NEW.filter(n => !n.module || canOpen(n.module));
}

// A step is a sentence, or { who, title, body } where who does it matters.
export function stepText(s) {
  return typeof s === 'string' ? s : [s.who, s.title, s.body].filter(Boolean).join(' ');
}

// Plain-text match over the question, steps, keywords and Spanish.
export function matchesHelp(entry, term) {
  const t = (term || '').trim().toLowerCase();
  if (!t) return true;
  const hay = [entry.q, entry.title, entry.body, entry.keywords, ...(entry.steps || []).map(stepText),
    entry.es?.q, ...(entry.es?.steps || []).map(stepText)].filter(Boolean).join(' ').toLowerCase();
  return t.split(/\s+/).every(w => hay.includes(w));
}

// The guides about one screen, for the ⓘ beside a page title.
export function guidesForModule(moduleId) {
  return GUIDES.filter(g => g.module === moduleId || g.open?.tab === moduleId);
}

// "Open it": the same app-navigate event every in-app link uses.
export function openHelpTarget(open) {
  if (!open) return;
  if (open.href) { window.location.href = open.href; return; }
  window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: open.tab, view: open.view, section: open.section } }));
}

// Open the Help page on one guide (from the ⓘ or the search palette).
export function openGuide(id) {
  window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'help', view: id } }));
  window.dispatchEvent(new CustomEvent('help-open', { detail: { id } }));
}
