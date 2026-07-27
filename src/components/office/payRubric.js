// The pay increase rubric, as written in the Pay Tracking workbook.
//
// It lives in the client because it is static text: keeping it here means the
// page's EN/ES toggle translates it like everything else, with no round trip
// and no second Spanish copy to keep in sync with the English one.

export const CHARACTERISTICS = [
  {
    key: 'team',
    title: 'WE WORK AS A TEAM',
    subtitle: 'shared goals and mutual respect',
    levels: {
      1: 'Works in isolation, creates friction, or prioritizes personal convenience over the team',
      2: 'Cooperates well, respects teammates, contributes to shared goals without being prompted',
      3: 'Actively sets up the next person for success, strengthens the team around them, elevates others',
    },
  },
  {
    key: 'snipers',
    title: 'WE OPERATE LIKE SNIPERS',
    subtitle: 'gather info and act with precision',
    levels: {
      1: 'Acts without thinking, rushes through tasks, makes avoidable errors, or over-complicates simple problems',
      2: 'Gathers enough information before acting, applies common sense, produces reliable work',
      3: 'Is ELITE. Assesses the situation, acts decisively, and gets it right with minimal waste or rework',
    },
  },
  {
    key: 'common_sense',
    title: 'WE USE COMMON SENSE',
    subtitle: 'we let purpose drive process — not the other way around',
    levels: {
      1: 'Follows process blindly even when it’s clearly not working, defaults to "this is how we’ve always done it," or waits to be told rather than thinking for themselves',
      2: 'Recognizes when a process isn’t serving its purpose, raises the issue, and adapts their approach when given direction',
      3: 'Proactively identifies when process conflicts with purpose and drives smarter solutions — without losing sight of the goal',
    },
  },
  {
    key: 'productivity',
    title: 'WE VALUE PRODUCTIVITY vs. ACTIVITY',
    subtitle: 'we measure output — not effort alone',
    levels: {
      1: 'Does the minimum, confuses being busy with being productive, or cuts corners',
      2: 'Completes their role fully, reliably, and to a good standard',
      3: 'Thinks like a cathedral builder. Understands the bigger purpose, pursues mastery, and continuously raises their own bar',
    },
  },
  {
    key: 'hard_things',
    title: 'WE ARE WILLING TO DO HARD THINGS vs. DOING THINGS ‘THE HARD WAY’',
    subtitle: 'we don’t make things harder than they need to be',
    levels: {
      1: 'Avoids difficult tasks, makes excuses, defaults to the path of least resistance, or creates unnecessary complexity that confuses effort with output',
      2: 'Takes on challenging work when asked without complaint',
      3: 'Voluntarily steps into hard situations, solves problems others walk past, and simplifies where others overcomplicate — always asking "what’s the most effective path to the outcome?"',
    },
  },
  {
    key: 'attendance',
    title: 'TIME & ATTENDANCE',
    subtitle: 'a score of 1 here triggers a review conversation regardless of the total',
    // The workbook singles this one out, and in a spreadsheet that footnote is
    // easy to read past. Flagged so the UI can raise it as its own alert.
    hardFlagAtOne: true,
    levels: {
      1: 'Frequently late, no-shows, or calls out with little notice, leaves the team short and creates a burden for others',
      2: 'Consistently on time, provides advance notice when issues arise, meets their scheduling commitments',
      3: 'Never a question mark. Shows up early or ready, covers gaps proactively, and treats their reliability as a standard they hold themselves to',
    },
  },
];

export const MAX_SCORE = CHARACTERISTICS.length * 3;

// Score → outcome. Bands are inclusive of `min`, read highest-first.
export const BANDS = [
  { min: 15, performance: 'Strong, consistent performer', increase: 2.0, label: '$2.00 / hour', approx: '~11% increase', tone: 'bg-green-100 text-green-800 border-green-300' },
  { min: 10, performance: 'Solid, meets expectations', increase: 1.5, label: '$1.50 / hour', approx: '~8.5% increase', tone: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  { min: 6, performance: 'Inconsistent or needs improvement', increase: 1.0, label: '$1.00 / hour', approx: '~5.5% increase', tone: 'bg-amber-100 text-amber-900 border-amber-300' },
  { min: 0, performance: 'Significant concerns', increase: 0, label: 'Hold — address before increase', approx: '', tone: 'bg-red-100 text-red-800 border-red-300' },
];

export const bandFor = (total) => BANDS.find(b => total >= b.min) || BANDS[BANDS.length - 1];

export const VISION = {
  heading: 'WHO WE STRIVE TO BE',
  points: [
    'ELITE (the best trained, highest skilled, most efficient)',
    'WE SET UP THE "NEXT-IN-LINE" FOR SUCCESS',
    'CATHEDRAL BUILDERS vs. BRICK LAYERS',
  ],
  statement: 'We are cathedral builders who operate like snipers — elite in our skills, precise in our execution, always working toward something larger than the task in front of us.',
};

export const CORE_VALUES = {
  heading: 'PRINCIPLES THAT GUIDE US',
  values: CHARACTERISTICS.slice(0, 5).map(c => ({ title: c.title, subtitle: c.subtitle })),
};
