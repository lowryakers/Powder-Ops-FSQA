// Modules NOBODY sees without an explicit grant — including admins.
//
// The admin rule everywhere else is "full access unless deliberately
// narrowed", and it is right for plant modules: an admin locked out of a log
// is a support call. These are different in kind — one person's private queue,
// not a plant record — and "every admin got Danny's payment list on deploy
// day" is the leak that proved the default wrong. One list, imported by the
// client's permissions rules AND by each module's own router gate, so the nav
// and the server cannot disagree about who is in.
export const OPT_IN_MODULES = ['dannys-list'];
export const OPT_IN_SET = new Set(OPT_IN_MODULES);
