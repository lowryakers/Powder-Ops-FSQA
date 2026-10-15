// What a person can open in the app, and why (D-187).
//
// The sidebar's rules live in App.jsx beside the nav they describe. Settings is
// a lazily loaded screen that must show the SAME answer, and importing App.jsx
// from it would be circular — so App registers its function here at load and
// Settings asks through it. One rule, two readers.
let impl = null;
export const registerNavAccess = (fn) => { impl = fn; };
export const navAccessFor = (user) => (impl ? impl(user) : []);
