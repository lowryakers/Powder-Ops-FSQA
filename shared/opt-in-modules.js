// Modules NOBODY sees without an explicit grant — including admins.
//
// The admin rule everywhere else is "full access unless deliberately
// narrowed", and it is right for plant modules: an admin locked out of a log
// is a support call. These are different in kind — one person's private queue,
// not a plant record — and "every admin got Danny's payment list on deploy
// day" is the leak that proved the default wrong. One list, imported by the
// client's permissions rules AND by each module's own router gate, so the nav
// and the server cannot disagree about who is in.
// Empty since Danny's List was retired (D-215). The rule stays for the next private
// queue; adding one is an entry here and nothing else.
export const OPT_IN_MODULES = [];
export const OPT_IN_SET = new Set(OPT_IN_MODULES);
