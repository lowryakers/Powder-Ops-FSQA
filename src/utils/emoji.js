// Emoji support for Comms: a shortcode → unicode map (covers Slack's common set,
// so imported messages that still contain :tada: etc. render as emoji), plus a
// grouped picker list for reactions and the composer.

export const SHORTCODES = {
  // people / faces
  smile: '😄', smiley: '😃', grinning: '😀', laughing: '😆', sweat_smile: '😅', joy: '😂', rofl: '🤣',
  relaxed: '☺️', blush: '😊', wink: '😉', slightly_smiling_face: '🙂', upside_down_face: '🙃',
  thinking_face: '🤔', neutral_face: '😐', expressionless: '😑', unamused: '😒', roll_eyes: '🙄',
  smirk: '😏', grimacing: '😬', flushed: '😳', sunglasses: '😎', star_struck: '🤩', partying_face: '🥳',
  cry: '😢', sob: '😭', disappointed: '😞', pensive: '😔', confused: '😕', worried: '😟', tired_face: '😫',
  weary: '😩', sleeping: '😴', mask: '😷', dizzy_face: '😵', astonished: '😲', open_mouth: '😮',
  scream: '😱', angry: '😠', rage: '😡', triumph: '😤', heart_eyes: '😍', kissing_heart: '😘',
  yum: '😋', stuck_out_tongue: '😛', stuck_out_tongue_winking_eye: '😜', money_mouth_face: '🤑',
  hugging_face: '🤗', shushing_face: '🤫', zipper_mouth_face: '🤐', nauseated_face: '🤢', sneezing_face: '🤧',
  cold_face: '🥶', hot_face: '🥵', woozy_face: '🥴', exploding_head: '🤯', cowboy_hat_face: '🤠',
  // hands / gestures
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', ok_hand: '👌', v: '✌️', crossed_fingers: '🤞',
  raised_hands: '🙌', clap: '👏', wave: '👋', pray: '🙏', muscle: '💪', point_up: '☝️', point_down: '👇',
  point_left: '👈', point_right: '👉', fist: '✊', facepunch: '👊', handshake: '🤝', writing_hand: '✍️',
  // hearts / symbols
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚', blue_heart: '💙',
  purple_heart: '💜', black_heart: '🖤', broken_heart: '💔', sparkling_heart: '💖', two_hearts: '💕',
  heartpulse: '💗', '100': '💯', bangbang: '‼️', question: '❓', exclamation: '❗', warning: '⚠️',
  x: '❌', o: '⭕', white_check_mark: '✅', heavy_check_mark: '✔️', ballot_box_with_check: '☑️',
  no_entry: '⛔', no_entry_sign: '🚫', star: '⭐', star2: '🌟', sparkles: '✨', zap: '⚡', boom: '💥',
  fire: '🔥', bulb: '💡', dizzy: '💫', anger: '💢',
  // celebration / objects
  tada: '🎉', confetti_ball: '🎊', balloon: '🎈', gift: '🎁', birthday: '🎂', cake: '🍰', trophy: '🏆',
  medal: '🏅', crown: '👑', bell: '🔔', mega: '📣', loudspeaker: '📢', pushpin: '📌', paperclip: '📎',
  memo: '📝', clipboard: '📋', calendar: '📅', date: '📆', chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉', bar_chart: '📊', lock: '🔒', unlock: '🔓', key: '🔑', wrench: '🔧',
  hammer: '🔨', gear: '⚙️', package: '📦', truck: '🚚', rocket: '🚀', hourglass: '⏳', alarm_clock: '⏰',
  watch: '⌚', phone: '📞', email: '📧', printer: '🖨️', computer: '💻', mag: '🔍', flashlight: '🔦',
  // food / nature
  coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', wine_glass: '🍷', pizza: '🍕', hamburger: '🍔',
  fries: '🍟', taco: '🌮', green_salad: '🥗', apple: '🍎', banana: '🍌', bread: '🍞', cheese: '🧀',
  cookie: '🍪', doughnut: '🍩', candy: '🍬', popcorn: '🍿', sun_with_face: '🌞', sunny: '☀️',
  cloud: '☁️', rain_cloud: '🌧️', snowflake: '❄️', umbrella: '☔', rainbow: '🌈', droplet: '💧',
  ocean: '🌊', deciduous_tree: '🌳', seedling: '🌱', four_leaf_clover: '🍀', rose: '🌹', sunflower: '🌻',
  dog: '🐶', cat: '🐱', // misc
  eyes: '👀', skull: '💀', ghost: '👻', poop: '💩', robot: '🤖', wave2: '🌊',
};

// Convert :shortcode: sequences in a string to emoji. Unknown codes are left
// as-is (so genuine ":00" times etc. are untouched).
export function replaceShortcodes(text) {
  if (!text || text.indexOf(':') === -1) return text;
  return text.replace(/:([a-z0-9_+-]+):/gi, (whole, code) => {
    const e = SHORTCODES[code] || SHORTCODES[code.toLowerCase()];
    return e || whole;
  });
}

// Grouped list for the picker UI.
export const PICKER_GROUPS = [
  { label: 'Smileys', emojis: ['😀', '😄', '😅', '😂', '🙂', '😉', '😊', '😍', '😘', '😎', '🤔', '😐', '🙄', '😴', '😢', '😭', '😡', '🥳', '🤩', '😷'] },
  { label: 'Gestures', emojis: ['👍', '👎', '👌', '✌️', '🤞', '🙌', '👏', '👋', '🙏', '💪', '👉', '👈', '☝️', '✊', '👊', '🤝'] },
  { label: 'Hearts', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💖', '💕', '💯'] },
  { label: 'Symbols', emojis: ['✅', '✔️', '☑️', '❌', '⭕', '⚠️', '❓', '❗', '⛔', '🚫', '⭐', '✨', '⚡', '🔥', '💥', '💡'] },
  { label: 'Objects', emojis: ['🎉', '🎊', '🎈', '🎁', '🎂', '🏆', '📣', '📢', '📌', '📝', '📋', '📅', '🔒', '🔑', '🔧', '📦', '🚚', '🚀', '⏰', '💻'] },
  { label: 'Food', emojis: ['☕', '🍺', '🍷', '🍕', '🍔', '🍟', '🌮', '🥗', '🍎', '🍞', '🧀', '🍪', '🍩', '🍿'] },
];

// Flat searchable index: emoji + its keyword(s).
export const EMOJI_INDEX = Object.entries(SHORTCODES).map(([name, emoji]) => ({ name, emoji }));
