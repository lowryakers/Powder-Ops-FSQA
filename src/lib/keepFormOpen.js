// A click on the dim area around a form must not throw the form away (D-299).
//
// Over a hundred pop-ups close when the dim backdrop is clicked
// (`<div className="fixed inset-0 bg-black/… " onClick={onClose}>`). That is right
// for something you only read, and wrong for a form: Adam filled most of a
// Flavor Approval, clicked just outside the card, and lost all of it. A text
// selection that starts in a box and ends outside the card lands its click on
// the backdrop too.
//
// ONE RULE, IN ONE PLACE, for every pop-up: when the click lands on the backdrop
// ITSELF and the pop-up holds a form field, the click is stopped before React
// sees it. X, Cancel and Save are untouched; a pop-up with nothing to type in
// still closes on an outside click. Installed once in main.jsx — a window
// capture listener runs before React's root listener, so stopping it there means
// the backdrop's onClick never fires.
export const FIELD_SELECTOR = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select';

export function isDimBackdrop(el) {
  if (!el || el.nodeType !== 1) return false;
  const c = typeof el.className === 'string' ? el.className : '';
  return /\bfixed\b/.test(c) && /\binset-0\b/.test(c) && /\bbg-black\/\d+/.test(c);
}

export function shouldKeepOpen(target) {
  return isDimBackdrop(target) && !!target.querySelector(FIELD_SELECTOR);
}

export function installKeepFormOpen(win = window) {
  if (win.__keepFormOpen) return;
  win.__keepFormOpen = true;
  win.addEventListener('click', (e) => {
    if (!shouldKeepOpen(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    // Say why nothing happened: a brief pulse on the card.
    const card = e.target.firstElementChild;
    if (card?.animate) card.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.01)' }, { transform: 'scale(1)' }], { duration: 180 });
  }, true);
}
