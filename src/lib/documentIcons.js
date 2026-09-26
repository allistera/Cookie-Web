// Document icon catalogue. A document's icon lives in its `emoji` field: either
// an emoji character (rendered with the OS emoji font) or `ms:<icon_name>`, a
// glyph from the self-hosted Material Symbols subset. scripts/fetch-icon-font.mjs
// adds every name listed here to the subset, so run `npm run fetch:icon-font`
// (and bump the revision in public/sw.js) after editing the list.
//
// Each entry is "<icon_name> | <extra search keywords>". The icon name with
// underscores as spaces doubles as the accessible label and is always
// searchable.

export const DOCUMENT_ICON_PREFIX = 'ms:'
// Mirrors the Worker's validation (cookie-web-tasks cleanEmoji).
const ICON_NAME_PATTERN = /^[a-z0-9_]{1,64}$/

const GROUPS = [
  {
    id: 'files',
    title: 'General & files',
    items: [
      'description | document file page doc',
      'article | document text post',
      'draft | document file',
      'note_alt | note memo',
      'sticky_note_2 | note memo postit',
      'edit_note | write notes',
      'folder | directory',
      'folder_open | directory',
      'topic | folder subject',
      'inventory_2 | box storage archive',
      'archive | box storage',
      'book | read',
      'menu_book | book read manual',
      'library_books | books library',
      'auto_stories | book read story',
      'bookmark | save',
      'bookmarks | saved',
      'collections_bookmark | saved collection',
      'checklist | todo list tasks',
      'task_alt | done complete tick',
      'list | bullets',
      'format_list_bulleted | list bullets',
      'assignment | clipboard task',
      'content_paste | clipboard',
      'label | tag',
      'sell | tag price',
      'push_pin | pin',
      'attach_file | attachment paperclip',
      'link | url chain',
      'table_chart | table spreadsheet',
      'grid_on | table grid spreadsheet',
      'dashboard | overview layout',
      'view_kanban | kanban board',
      'lightbulb | idea',
      'tips_and_updates | idea tip',
    ],
  },
  {
    id: 'work',
    title: 'Work',
    items: [
      'work | job briefcase office',
      'business_center | briefcase office job',
      'badge | id card employee',
      'groups | team people',
      'group | team people',
      'person | user profile',
      'diversity_3 | team people community',
      'handshake | deal agreement partner',
      'meeting_room | meeting door',
      'event | calendar date',
      'calendar_month | calendar date schedule',
      'schedule | clock time',
      'alarm | clock reminder',
      'timer | stopwatch',
      'hourglass_empty | wait time',
      'flag | milestone goal',
      'campaign | announcement megaphone marketing',
      'trending_up | growth chart',
      'insights | analytics stats',
      'analytics | chart stats',
      'bar_chart | chart stats graph',
      'pie_chart | chart stats graph',
      'query_stats | chart search',
      'leaderboard | ranking chart',
      'target | goal aim',
      'rocket_launch | launch startup ship',
      'gavel | legal law',
      'policy | legal security',
      'balance | legal scales',
      'apartment | building office',
      'domain | building company',
      'corporate_fare | building company',
    ],
  },
  {
    id: 'home',
    title: 'Home',
    items: [
      'home | house',
      'house | home',
      'cottage | house cabin',
      'bed | bedroom sleep',
      'chair | furniture',
      'weekend | sofa couch',
      'kitchen | fridge',
      'countertops | kitchen',
      'bathtub | bathroom bath',
      'shower | bathroom',
      'cleaning_services | clean chores',
      'local_laundry_service | laundry washing',
      'yard | garden',
      'grass | lawn garden',
      'garage | car',
      'construction | diy build',
      'handyman | tools repair diy',
      'build | tools repair wrench',
      'plumbing | pipes repair',
      'electrical_services | electric plug',
      'light | lamp',
      'pets | pet dog cat paw',
      'child_care | baby kids',
      'family_restroom | family kids',
    ],
  },
  {
    id: 'travel',
    title: 'Travel',
    items: [
      'flight | plane trip travel',
      'flight_takeoff | plane trip departure',
      'luggage | suitcase trip',
      'travel_explore | trip globe search',
      'map | trip route',
      'explore | compass trip',
      'public | globe world',
      'place | location pin',
      'location_on | place pin map',
      'hotel | bed stay',
      'beach_access | beach umbrella holiday',
      'pool | swimming',
      'directions_car | car drive',
      'train | rail',
      'directions_bus | bus',
      'directions_bike | bike bicycle cycling',
      'sailing | boat sea',
      'hiking | walk trail',
      'landscape | mountains',
      'camping | tent',
      'tour | flag trip',
    ],
  },
  {
    id: 'food',
    title: 'Food & drink',
    items: [
      'restaurant | food eat dining',
      'restaurant_menu | food menu',
      'local_cafe | coffee cafe',
      'coffee | cafe drink',
      'local_pizza | pizza food',
      'lunch_dining | burger food',
      'ramen_dining | noodles food',
      'bakery_dining | bread bakery',
      'cake | birthday dessert',
      'icecream | ice cream dessert',
      'local_bar | cocktail drink',
      'wine_bar | wine drink',
      'liquor | bottle drink',
      'nutrition | food apple healthy',
      'egg | breakfast',
      'set_meal | fish food',
      'fastfood | food',
      'cookie | biscuit',
      'local_grocery_store | groceries shopping',
      'shopping_cart | groceries shopping',
      'shopping_bag | shopping',
    ],
  },
  {
    id: 'nature',
    title: 'Nature & weather',
    items: [
      'eco | leaf green',
      'park | tree',
      'forest | trees woods',
      'nature | tree',
      'spa | flower wellness',
      'local_florist | flower',
      'potted_plant | plant',
      'compost | garden',
      'recycling | recycle',
      'water_drop | water rain',
      'sunny | sun weather',
      'wb_sunny | sun weather',
      'cloud | weather',
      'thunderstorm | storm weather',
      'ac_unit | snow cold winter',
      'bolt | lightning energy',
      'local_fire_department | fire flame',
      'nights_stay | moon night',
    ],
  },
  {
    id: 'tech',
    title: 'Tech',
    items: [
      'code | programming dev',
      'terminal | console shell command',
      'data_object | json code',
      'computer | desktop pc',
      'laptop | computer',
      'smartphone | phone mobile',
      'tablet_mac | tablet ipad',
      'keyboard | typing',
      'mouse | computer',
      'memory | chip hardware',
      'dns | server',
      'storage | server disk',
      'database | data sql',
      'cloud_upload | upload cloud',
      'api | integration',
      'bug_report | bug issue',
      'integration_instructions | code docs',
      'developer_mode | phone dev',
      'wifi | network internet',
      'router | network',
      'settings | gear config',
      'smart_toy | robot ai bot',
      'robot_2 | robot ai bot',
      'science | lab experiment',
      'biotech | microscope lab',
    ],
  },
  {
    id: 'money',
    title: 'Money',
    items: [
      'payments | money cash',
      'attach_money | dollar money',
      'savings | piggy bank money',
      'account_balance | bank',
      'account_balance_wallet | wallet money',
      'credit_card | card payment',
      'receipt_long | receipt invoice bill',
      'request_quote | invoice quote',
      'calculate | calculator maths',
      'price_check | price',
      'shopping_basket | shopping',
      'currency_exchange | money exchange',
      'monitoring | stocks chart',
    ],
  },
  {
    id: 'health',
    title: 'Health',
    items: [
      'favorite | heart love',
      'health_and_safety | health',
      'medical_services | medical doctor',
      'local_hospital | hospital medical',
      'medication | pills medicine',
      'vaccines | injection medical',
      'fitness_center | gym weights exercise',
      'directions_run | run exercise',
      'self_improvement | meditation yoga',
      'sports_gymnastics | exercise',
      'monitor_heart | heart rate',
      'psychology | mind brain',
      'psychiatry | mental health',
      'bedtime | sleep night',
    ],
  },
  {
    id: 'education',
    title: 'Education & hobbies',
    items: [
      'school | education study',
      'history_edu | writing quill history',
      'translate | language',
      'language | globe translate',
      'quiz | question test',
      'grade | star rating',
      'workspace_premium | award certificate',
      'emoji_events | trophy award',
      'functions | maths formula',
      'architecture | design drawing',
      'palette | art colours',
      'brush | paint art',
      'draw | pencil sketch',
      'photo_camera | camera photo',
      'music_note | music song',
      'movie | film video',
      'mic | microphone podcast',
      'headphones | music audio',
      'sports_esports | games gaming controller',
      'sports_soccer | football sport',
      'piano | music keyboard',
      'theater_comedy | theatre drama',
    ],
  },
  {
    id: 'symbols',
    title: 'Symbols',
    items: [
      'star | favourite',
      'check_circle | done complete',
      'help | question',
      'info | information',
      'warning | alert',
      'error | alert',
      'priority_high | important urgent',
      'lock | private secure',
      'key | password',
      'visibility | eye view',
      'shield | security',
      'verified | approved badge',
      'diamond | gem',
      'auto_awesome | sparkle magic',
      'celebration | party',
      'mood | smile happy',
      'thumb_up | like yes',
      'new_releases | new',
      'local_offer | tag deal',
      'all_inclusive | infinity',
      'extension | puzzle plugin',
      'category | shapes',
      'interests | shapes',
      'anchor | boat',
      'emoji_objects | lightbulb idea',
    ],
  },
]

function labelFor(name) {
  return name.replaceAll('_', ' ')
}

function parseItem(line) {
  const [head, extra = ''] = line.split('|')
  const name = head.trim()
  const label = labelFor(name)
  return {
    name,
    value: `${DOCUMENT_ICON_PREFIX}${name}`,
    label,
    keywords: `${label} ${name} ${extra.trim()}`.toLowerCase(),
  }
}

export const DOCUMENT_ICON_GROUPS = GROUPS.map((group) => ({
  id: group.id,
  title: group.title,
  items: group.items.map(parseItem),
}))

export const ALL_DOCUMENT_ICONS = DOCUMENT_ICON_GROUPS.flatMap((group) => group.items)

export const DOCUMENT_ICON_NAMES = ALL_DOCUMENT_ICONS.map((icon) => icon.name)

// Same contract as filterEmoji: every group for an empty query, otherwise one
// "Search results" group whose items match every whitespace-separated term.
export function filterDocumentIcons(query) {
  const terms = (query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return DOCUMENT_ICON_GROUPS
  const items = ALL_DOCUMENT_ICONS.filter((icon) =>
    terms.every((term) => icon.keywords.includes(term)),
  )
  return [{ id: 'results', title: 'Search results', items }]
}

// Splits a stored icon value into what to render: a Material Symbols glyph
// ({ symbol, label }), an emoji ({ emoji }), or null when there is nothing to
// show. A malformed `ms:` value is null rather than raw text.
export function parseDocumentIcon(value) {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  if (!trimmed.startsWith(DOCUMENT_ICON_PREFIX)) return { emoji: trimmed }
  const name = trimmed.slice(DOCUMENT_ICON_PREFIX.length)
  if (!ICON_NAME_PATTERN.test(name)) return null
  return { symbol: name, label: labelFor(name) }
}
