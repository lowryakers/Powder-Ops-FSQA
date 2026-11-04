// One spelling of an item code (D-310). CTLA paste-ins and spreadsheet imports
// carry tabs, non-breaking spaces and trailing blanks, and "100245\t" is then a
// second item with no plan. Inner runs of whitespace become one space; the ends
// are trimmed. Nothing else changes — case and punctuation are the code.
export function cleanItemNumber(v) {
  return String(v ?? '').replace(/[\s\u00a0\u200b]+/g, ' ').trim();
}
