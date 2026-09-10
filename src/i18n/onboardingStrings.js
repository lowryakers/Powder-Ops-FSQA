/**
 * The new hire's wizard, in English and Spanish.
 *
 * WHY THE W-4 AND THE I-9 ARE NOT IN HERE. They are federal forms, and their
 * questions and their perjury statements are the words being signed. A
 * translated attestation is not the statement anybody signed, which is the same
 * refusal `i18n/operatorStrings.js` records for the forklift test: the plant's
 * own wording or nothing, never machine translation. Those two steps render in
 * English in both languages and say why (`formsEnglish`). Everything the plant
 * itself is asking — who you are, how we reach you, where your pay goes — is
 * translated, because that is where somebody gets stuck.
 *
 * The Spanish is written for this workforce, not transliterated from the
 * English: "número de ruta" rather than a literal "número de encaminamiento".
 *
 * Adding a string means adding it to BOTH objects. `t()` falls back to English
 * on a missing key rather than rendering the key itself — a screen with a bare
 * `deposit.title` on it is worse than one English line in a Spanish page.
 */

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

const en = {
  loading: 'Loading…',
  brand: 'POWDER OPS · ReadyDoc',
  langPrompt: 'Choose your language',

  'welcome.title': 'Welcome to Powder Ops',
  'welcome.intro': 'This takes about fifteen minutes and saves as you go — you can come back to this link anytime before your first day. Have your Social Security number, your bank details, and your ID documents (passport, or driver’s license plus Social Security card) to hand.',
  'welcome.appTitle': 'The plant runs on ReadyDoc — this app.',
  'welcome.appMessages': 'Messages is how the team talks: your channels, direct messages, and announcements, in English and Spanish. Your phone gets notifications the moment someone needs you.',
  'welcome.appWork': 'Your work lives here too — the tasks assigned to you, the forms you’ll fill in on the floor, and your training. Everything you’ll need is one app, and you’ll get your sign-in on day one.',
  'welcome.startingAs': 'Starting as',
  'welcome.on': 'on',
  'welcome.go': 'Let’s go',

  'personal.title': 'About you',
  'personal.first': 'First name *',
  'personal.last': 'Last name *',
  'personal.middle': 'Middle name',
  'personal.preferred': 'Goes by',
  'personal.phone': 'Phone *',
  'personal.email': 'Email',
  'personal.dob': 'Date of birth *',
  'personal.gender': 'Gender *',
  'personal.genderHint': 'For insurance and compliance reporting.',
  'personal.choose': 'Choose…',
  'personal.female': 'Female',
  'personal.male': 'Male',
  'personal.ssn': 'Social Security number *',
  'personal.ssnOnFile': ' (on file ••••)',
  'personal.ssnSaved': 'Saved — retype to change',
  'personal.address1': 'Home address *',
  'personal.address2': 'Apt / unit',
  'personal.city': 'City *',
  'personal.state': 'State *',
  'personal.zip': 'ZIP *',
  'personal.officeCollects': 'The office will collect your Social Security number and banking details with you directly.',

  'emergency.title': 'Emergency contact',
  'emergency.name': 'Name',
  'emergency.phone': 'Phone',
  'emergency.relationship': 'Relationship',

  'deposit.title': 'How you’ll be paid',
  'deposit.directOnly': 'Powder Ops pays by direct deposit — straight into your bank account on payday. There is no paper cheque, so the details below are how you get paid.',
  'deposit.bank': 'Bank name',
  'deposit.routing': 'Routing number *',
  'deposit.routingOnFile': ' (on file)',
  'deposit.routingHint': '9 digits',
  'deposit.account': 'Account number *',
  'deposit.accountType': 'Account type *',
  'deposit.checking': 'Checking',
  'deposit.savings': 'Savings',
  'deposit.saved': 'Saved — retype to change',
  'deposit.voidedTitle': 'A photo of a voided check (recommended)',
  'deposit.voidedHint': 'The office checks the numbers above against it. Write VOID across a blank check and photograph the front.',
  'deposit.voidedTitleReq': 'A photo of a voided check *',
  'deposit.voidedHintReq': 'Your bank details are not typed in here. The office sets up your direct deposit from the check: write VOID across a blank check and photograph the front.',

  formsEnglish: 'The next two steps are the federal W-4 and I-9. They stay in English because those are the exact words you are signing — a translation would not be the form. Ask the office if anything on them is unclear; they will go through it with you.',

  'photos.remove': 'Remove',
  'photos.take': 'Take a photo',
  'photos.takeAnother': 'Take another photo',
  'photos.choose': 'Choose from photos',
  'photos.unavailable': 'Photo upload is not available right now — bring the documents on your first day.',

  'nav.back': 'Back',
  'nav.next': 'Save & continue',
  'nav.saving': 'Saving…',

  'done.title': 'You’re all set',
  'done.body': 'The office has your information and your signed forms. Bring the original ID documents you photographed on your first day — the office has to see them in person.',
  'done.installTitle': 'One last thing: put ReadyDoc on your phone',
  'done.installWhy': 'ReadyDoc is where the team talks and where your tasks and training live. Add it to your home screen now and it will be waiting for you. Your sign-in comes on your first day.',
  'done.installButton': 'Add ReadyDoc to my phone',
  'done.installIos': 'On iPhone: open this page in Safari, tap the Share button at the bottom, then Add to Home Screen.',
  'done.installAndroid': 'On Android: tap the ⋮ menu at the top right, then Install app or Add to Home screen.',
  'done.installDone': 'Added. Look for the ReadyDoc icon on your home screen.',
  'done.notifications': 'Notifications get switched on inside the app once you sign in on day one — the app will ask you then.',
  'done.openLink': 'Or open it here:',
};

const es = {
  loading: 'Cargando…',
  brand: 'POWDER OPS · ReadyDoc',
  langPrompt: 'Elige tu idioma',

  'welcome.title': 'Bienvenido a Powder Ops',
  'welcome.intro': 'Esto toma unos quince minutos y se va guardando solo — puedes volver a este enlace cuando quieras antes de tu primer día. Ten a la mano tu número de Seguro Social, los datos de tu banco y tus documentos de identidad (pasaporte, o licencia de manejo junto con la tarjeta de Seguro Social).',
  'welcome.appTitle': 'La planta trabaja con ReadyDoc — esta aplicación.',
  'welcome.appMessages': 'Mensajes es donde se comunica el equipo: tus canales, mensajes directos y avisos, en inglés y español. Tu teléfono te avisa en cuanto alguien te necesita.',
  'welcome.appWork': 'Tu trabajo también está aquí — las tareas que te asignan, las formas que llenas en el piso y tu capacitación. Todo en una sola aplicación, y tu acceso te lo damos el primer día.',
  'welcome.startingAs': 'Empiezas como',
  'welcome.on': 'el',
  'welcome.go': 'Empezar',

  'personal.title': 'Sobre ti',
  'personal.first': 'Nombre *',
  'personal.last': 'Apellidos *',
  'personal.middle': 'Segundo nombre',
  'personal.preferred': 'Cómo te dicen',
  'personal.phone': 'Teléfono *',
  'personal.email': 'Correo electrónico',
  'personal.dob': 'Fecha de nacimiento *',
  'personal.gender': 'Sexo *',
  'personal.genderHint': 'Para el seguro y los reportes de cumplimiento.',
  'personal.choose': 'Elige…',
  'personal.female': 'Femenino',
  'personal.male': 'Masculino',
  'personal.ssn': 'Número de Seguro Social *',
  'personal.ssnOnFile': ' (guardado ••••)',
  'personal.ssnSaved': 'Guardado — escríbelo de nuevo para cambiarlo',
  'personal.address1': 'Domicilio *',
  'personal.address2': 'Departamento / unidad',
  'personal.city': 'Ciudad *',
  'personal.state': 'Estado *',
  'personal.zip': 'Código postal *',
  'personal.officeCollects': 'La oficina te pedirá tu número de Seguro Social y los datos del banco en persona.',

  'emergency.title': 'Contacto de emergencia',
  'emergency.name': 'Nombre',
  'emergency.phone': 'Teléfono',
  'emergency.relationship': 'Parentesco',

  'deposit.title': 'Cómo te vamos a pagar',
  'deposit.directOnly': 'Powder Ops paga por depósito directo — el dinero entra a tu cuenta el día de pago. No hay cheque de papel, así que estos datos son la forma en que te pagamos.',
  'deposit.bank': 'Nombre del banco',
  'deposit.routing': 'Número de ruta (routing) *',
  'deposit.routingOnFile': ' (guardado)',
  'deposit.routingHint': '9 dígitos',
  'deposit.account': 'Número de cuenta *',
  'deposit.accountType': 'Tipo de cuenta *',
  'deposit.checking': 'Cheques',
  'deposit.savings': 'Ahorros',
  'deposit.saved': 'Guardado — escríbelo de nuevo para cambiarlo',
  'deposit.voidedTitle': 'Foto de un cheque cancelado (recomendado)',
  'deposit.voidedHint': 'La oficina compara los números de arriba con el cheque. Escribe VOID sobre un cheque en blanco y toma la foto del frente.',
  'deposit.voidedTitleReq': 'Foto de un cheque cancelado *',
  'deposit.voidedHintReq': 'Aquí no se escriben los datos de tu banco. La oficina arma tu depósito directo con el cheque: escribe VOID sobre un cheque en blanco y toma la foto del frente.',

  formsEnglish: 'Los siguientes dos pasos son las formas federales W-4 e I-9. Van en inglés porque ésas son exactamente las palabras que estás firmando — una traducción ya no sería la forma. Si algo no te queda claro, pregunta en la oficina y lo revisan contigo.',

  'photos.remove': 'Quitar',
  'photos.take': 'Tomar foto',
  'photos.takeAnother': 'Tomar otra foto',
  'photos.choose': 'Escoger de mis fotos',
  'photos.unavailable': 'Ahorita no se pueden subir fotos — trae los documentos tu primer día.',

  'nav.back': 'Atrás',
  'nav.next': 'Guardar y seguir',
  'nav.saving': 'Guardando…',

  'done.title': 'Ya quedó todo',
  'done.body': 'La oficina ya tiene tu información y tus formas firmadas. Trae los documentos de identidad originales que fotografiaste tu primer día — la oficina tiene que verlos en persona.',
  'done.installTitle': 'Una última cosa: instala ReadyDoc en tu teléfono',
  'done.installWhy': 'ReadyDoc es donde se comunica el equipo y donde están tus tareas y tu capacitación. Agrégalo a tu pantalla de inicio ahora y ahí te va a estar esperando. Tu acceso te lo damos el primer día.',
  'done.installButton': 'Agregar ReadyDoc a mi teléfono',
  'done.installIos': 'En iPhone: abre esta página en Safari, toca el botón Compartir abajo y luego Agregar a inicio.',
  'done.installAndroid': 'En Android: toca el menú ⋮ arriba a la derecha y luego Instalar aplicación o Agregar a pantalla principal.',
  'done.installDone': 'Listo. Busca el ícono de ReadyDoc en tu pantalla de inicio.',
  'done.notifications': 'Las notificaciones se activan dentro de la aplicación cuando entres tu primer día — ahí mismo te las va a pedir.',
  'done.openLink': 'O ábrelo aquí:',
};

const TABLES = { en, es };

/** Look one string up. Falls back to English, then to the key. */
export function tr(lang, key) {
  const table = TABLES[lang] || en;
  return table[key] ?? en[key] ?? key;
}

/** A bound lookup for a component that already knows its language. */
export function translator(lang) {
  return (key) => tr(lang, key);
}
