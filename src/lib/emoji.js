// Emoji catalogue for the compose/reply picker. Kept as a curated, dependency-
// free list: each entry is "<emoji> <name> | <extra search keywords>". The
// name doubles as the accessible label and is always searchable.

const RECENT_KEY = 'cookie.recentEmoji'
export const RECENT_LIMIT = 16

const GROUPS = [
  {
    id: 'smileys',
    title: 'Smileys',
    items: [
      '😀 grinning face | smile happy',
      '😃 grinning face with big eyes | smile happy',
      '😄 grinning face with smiling eyes | smile happy laugh',
      '😁 beaming face with smiling eyes | grin',
      '😆 grinning squinting face | laugh haha',
      '😅 grinning face with sweat | phew nervous',
      '🤣 rolling on the floor laughing | rofl lol',
      '😂 face with tears of joy | lol laugh cry',
      '🙂 slightly smiling face | smile',
      '😉 winking face | wink',
      '😊 smiling face with smiling eyes | blush happy',
      '😇 smiling face with halo | angel innocent',
      '🥰 smiling face with hearts | love adore',
      '😍 smiling face with heart-eyes | love',
      '🤩 star-struck | wow excited',
      '😘 face blowing a kiss | kiss love',
      '😋 face savoring food | yum delicious',
      '😛 face with tongue | playful',
      '😜 winking face with tongue | playful silly',
      '🤪 zany face | crazy silly',
      '🤗 smiling face with open hands | hug',
      '🤔 thinking face | hmm think',
      '🤫 shushing face | quiet secret',
      '🤨 face with raised eyebrow | skeptical',
      '😐 neutral face | meh',
      '😶 face without mouth | silent speechless',
      '🙄 face with rolling eyes | eyeroll whatever',
      '😏 smirking face | smirk',
      '😬 grimacing face | awkward eek',
      '😌 relieved face | calm',
      '😔 pensive face | sad',
      '😴 sleeping face | zzz tired',
      '😷 face with medical mask | sick ill',
      '🤒 face with thermometer | sick ill fever',
      '🤯 exploding head | mind blown',
      '🥳 partying face | party celebrate',
      '😎 smiling face with sunglasses | cool',
      '🤓 nerd face | geek',
      '🧐 face with monocle | curious',
      '😕 confused face | puzzled',
      '😟 worried face | worried',
      '🙁 slightly frowning face | sad',
      '😮 face with open mouth | surprised wow',
      '😲 astonished face | shocked',
      '😳 flushed face | embarrassed',
      '🥺 pleading face | puppy eyes please',
      '😢 crying face | sad tear',
      '😭 loudly crying face | sob sad',
      '😱 face screaming in fear | scream',
      '😤 face with steam from nose | frustrated',
      '😡 enraged face | angry mad',
      '🤬 face with symbols on mouth | swearing angry',
      '🫠 melting face | melt',
      '🫡 saluting face | salute yes sir',
      '🫶 heart hands | love',
    ],
  },
  {
    id: 'gestures',
    title: 'Gestures & people',
    items: [
      '👍 thumbs up | yes ok like good',
      '👎 thumbs down | no dislike',
      '👌 ok hand | okay perfect',
      '🤌 pinched fingers | italian',
      '✌️ victory hand | peace',
      '🤞 crossed fingers | luck hope',
      '🤟 love-you gesture | love',
      '🤘 sign of the horns | rock',
      '🤙 call me hand | shaka',
      '👈 backhand index pointing left | left',
      '👉 backhand index pointing right | right',
      '👆 backhand index pointing up | up',
      '👇 backhand index pointing down | down',
      '☝️ index pointing up | one',
      '✋ raised hand | stop high five',
      '👋 waving hand | hello bye hi',
      '🙌 raising hands | hooray celebrate',
      '👏 clapping hands | clap applause bravo',
      '🙏 folded hands | please thanks pray',
      '🤝 handshake | deal agreement',
      '💪 flexed biceps | strong muscle',
      '✍️ writing hand | write',
      '🙋 person raising hand | question',
      '🤷 person shrugging | shrug dunno',
      '🤦 person facepalming | facepalm',
      '🧑‍💻 technologist | developer coding',
      '👀 eyes | look watching',
      '🧠 brain | smart think',
    ],
  },
  {
    id: 'hearts',
    title: 'Hearts & symbols',
    items: [
      '❤️ red heart | love',
      '🧡 orange heart | love',
      '💛 yellow heart | love',
      '💚 green heart | love',
      '💙 blue heart | love',
      '💜 purple heart | love',
      '🖤 black heart | love',
      '🤍 white heart | love',
      '💔 broken heart | sad',
      '💕 two hearts | love',
      '💖 sparkling heart | love',
      '💯 hundred points | 100 perfect',
      '✅ check mark button | done yes tick',
      '☑️ check box with check | done tick',
      '✔️ check mark | done yes tick',
      '❌ cross mark | no wrong',
      '❓ red question mark | question',
      '❗ red exclamation mark | important',
      '⚠️ warning | caution',
      '🚫 prohibited | no forbidden',
      '♻️ recycling symbol | recycle',
      '⭐ star | favorite',
      '🌟 glowing star | sparkle',
      '✨ sparkles | magic new shiny',
      '💥 collision | boom bang',
      '🔥 fire | hot lit',
      '⚡ high voltage | lightning fast',
      '💡 light bulb | idea',
      '🔔 bell | notification reminder',
      '🔕 bell with slash | mute silent',
      '➡️ right arrow | next',
      '⬅️ left arrow | back',
      '🔁 repeat button | loop',
      '🆕 new button | new',
      '🆗 ok button | okay',
      '🔝 top arrow | top',
    ],
  },
  {
    id: 'objects',
    title: 'Objects & work',
    items: [
      '📧 e-mail | email mail',
      '📩 envelope with arrow | inbox email',
      '📨 incoming envelope | email',
      '📬 open mailbox with raised flag | mail',
      '📎 paperclip | attachment',
      '📌 pushpin | pin',
      '📍 round pushpin | location',
      '📝 memo | note write',
      '📄 page facing up | document file',
      '📁 file folder | folder',
      '📂 open file folder | folder',
      '🗓️ spiral calendar | calendar date',
      '📅 calendar | date',
      '⏰ alarm clock | time reminder',
      '⏳ hourglass not done | waiting time',
      '⌛ hourglass done | time',
      '🕐 one o’clock | time clock',
      '📞 telephone receiver | call phone',
      '📱 mobile phone | phone',
      '💻 laptop | computer',
      '🖥️ desktop computer | computer',
      '⌨️ keyboard | typing',
      '🖱️ computer mouse | mouse',
      '🔗 link | url',
      '🔒 locked | secure private',
      '🔓 unlocked | open',
      '🔑 key | password',
      '🔍 magnifying glass tilted left | search find',
      '📊 bar chart | stats analytics',
      '📈 chart increasing | growth up',
      '📉 chart decreasing | down',
      '💰 money bag | cash',
      '💳 credit card | payment',
      '🛒 shopping cart | shop buy',
      '📦 package | delivery shipping box',
      '🚀 rocket | launch ship',
      '🛠️ hammer and wrench | tools fix',
      '⚙️ gear | settings',
      '🧪 test tube | testing experiment',
      '🐛 bug | issue',
      '🎯 bullseye | target goal',
      '🏆 trophy | win award',
      '🎓 graduation cap | learn',
      '💤 zzz | sleep',
      '🚧 construction | wip work in progress',
      '🗑️ wastebasket | trash delete',
    ],
  },
  {
    id: 'celebrations',
    title: 'Celebrations',
    items: [
      '🎉 party popper | celebrate congrats tada',
      '🎊 confetti ball | celebrate party',
      '🎈 balloon | party birthday',
      '🎂 birthday cake | birthday',
      '🎁 wrapped gift | present',
      '🥂 clinking glasses | cheers toast',
      '🍾 bottle with popping cork | champagne celebrate',
      '🍻 clinking beer mugs | cheers',
      '☕ hot beverage | coffee tea',
      '🍕 pizza | food',
      '🍰 shortcake | cake dessert',
      '🍪 cookie | biscuit',
      '🎵 musical note | music',
      '🎶 musical notes | music',
      '🎄 christmas tree | xmas holiday',
      '🎃 jack-o-lantern | halloween pumpkin',
      '🏖️ beach with umbrella | holiday vacation',
      '✈️ airplane | travel flight',
      '🚗 automobile | car drive',
      '🏠 house | home',
    ],
  },
  {
    id: 'nature',
    title: 'Nature',
    items: [
      '☀️ sun | sunny weather',
      '🌤️ sun behind small cloud | weather',
      '☁️ cloud | weather',
      '🌧️ cloud with rain | rain weather',
      '⛈️ cloud with lightning and rain | storm',
      '❄️ snowflake | snow cold winter',
      '🌈 rainbow | pride',
      '🌙 crescent moon | night',
      '🌍 globe showing Europe-Africa | earth world',
      '🌱 seedling | plant grow',
      '🌲 evergreen tree | tree',
      '🌸 cherry blossom | flower spring',
      '🌹 rose | flower love',
      '🌻 sunflower | flower',
      '🍀 four leaf clover | luck',
      '🐶 dog face | puppy',
      '🐱 cat face | kitten',
      '🐭 mouse face | mouse',
      '🦊 fox | fox',
      '🐻 bear | bear',
      '🐼 panda | panda',
      '🐨 koala | koala',
      '🦁 lion | lion',
      '🐮 cow face | cow',
      '🐷 pig face | pig',
      '🐸 frog | frog',
      '🐵 monkey face | monkey',
      '🐔 chicken | chicken',
      '🐧 penguin | penguin',
      '🦋 butterfly | butterfly',
      '🐝 honeybee | bee',
      '🐢 turtle | slow',
      '🦄 unicorn | magic',
      '🐙 octopus | octopus',
      '🦖 t-rex | dinosaur',
    ],
  },
]

function parseItem(line) {
  const [head, extra = ''] = line.split('|')
  const trimmed = head.trim()
  const space = trimmed.indexOf(' ')
  const char = trimmed.slice(0, space)
  const name = trimmed.slice(space + 1).trim()
  return { char, name, keywords: `${name} ${extra.trim()}`.toLowerCase() }
}

export const EMOJI_GROUPS = GROUPS.map((group) => ({
  id: group.id,
  title: group.title,
  items: group.items.map(parseItem),
}))

export const ALL_EMOJI = EMOJI_GROUPS.flatMap((group) => group.items)

const BY_CHAR = new Map(ALL_EMOJI.map((emoji) => [emoji.char, emoji]))

// Returns the groups to render for a query: every group when the query is
// empty, otherwise a single "Search results" group of matches (name or
// keyword contains every whitespace-separated term).
export function filterEmoji(query) {
  const terms = (query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return EMOJI_GROUPS
  const items = ALL_EMOJI.filter((emoji) => terms.every((term) => emoji.keywords.includes(term)))
  return [{ id: 'results', title: 'Search results', items }]
}

export function getRecentEmoji() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    if (!Array.isArray(stored)) return []
    return stored.map((char) => BY_CHAR.get(char)).filter(Boolean)
  } catch {
    return []
  }
}

export function rememberRecentEmoji(char) {
  if (!BY_CHAR.has(char)) return
  const next = [
    char,
    ...getRecentEmoji()
      .map((emoji) => emoji.char)
      .filter((c) => c !== char),
  ]
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_LIMIT)))
  } catch {
    // Recents are a convenience; a full or unavailable storage is not an error.
  }
}
