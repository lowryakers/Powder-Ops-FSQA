// The Auditor View's training table and its CSV export, from ONE column list.
//
// They used to be two lists, and both read `person_name || user_name` — neither
// is a column on training_records (it is `employee_name`), so every person
// rendered as "—" and the exported CSV shipped a blank Person column on the one
// screen built to hand records to an auditor. Copied from the certifications
// section, where `person_name` is real. `scripts/check-auditor-training.mjs`
// asserts every column these read exists on the table or its joins.
//
// `completion_date` is the record's own; the imported matrix rows carry only
// `training_date`, which is the same fact for a one-day training. `course_title`
// is the joined course; an imported row with no course keeps its heading in
// `training_topic`.
export const TRAINING_COLUMNS = [
  { key: 'person', label: 'Person', value: r => r.employee_name || '' },
  { key: 'course', label: 'Course', value: r => r.course_title || r.training_topic || '' },
  { key: 'completed', label: 'Completed', value: r => (r.completion_date || r.training_date || '').slice(0, 10) },
  { key: 'score', label: 'Score', value: r => (r.score ?? '') },
  { key: 'trainer', label: 'Trainer', value: r => r.trainer || '', csvOnly: true },
];
