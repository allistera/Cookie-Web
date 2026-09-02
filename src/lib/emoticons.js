const EMOJI_REPLACEMENTS = [
  [/👍(?:🏻|🏼|🏽|🏾|🏿)?/gu, '+1'],
  [/👎(?:🏻|🏼|🏽|🏾|🏿)?/gu, '-1'],
  [/(?:❤️|❤|♥️|♥|💖|💕|💗|💓|💞|💘|💝)/gu, '<3'],
  [/💔/gu, '</3'],
  [/(?:😀|😃|😄|😁|😆|😂|🤣)/gu, ':D'],
  [/(?:😊|🙂|☺️|☺|😌)/gu, ':)'],
  [/(?:😢|😭|😞|😔|🙁|☹️|☹|😟)/gu, ':('],
  [/(?:😮|😯|😲|😱|🤯)/gu, ':O'],
  [/😉/gu, ';)'],
  [/(?:😛|😜|😝|🤪)/gu, ':P'],
  [/(?:😘|😗|😙|😚)/gu, ':*'],
  [/(?:😐|😑|😶)/gu, ':|'],
  [/(?:😕|🤔)/gu, ':/'],
  [/😎/gu, 'B)'],
  [/(?:😠|😡|🤬)/gu, '>:('],
  [/😈/gu, '>:)'],
  [/🎉/gu, '\\o/'],
]

// Converts common graphical emoji into portable ASCII emoticons. Unknown
// emoji deliberately remain intact so the composer never discards meaning.
export function convertEmojiToEmoticons(value) {
  let converted = String(value ?? '')
  for (const [emoji, emoticon] of EMOJI_REPLACEMENTS) {
    converted = converted.replace(emoji, emoticon)
  }
  return converted
}

// Converts only visible HTML text. Attributes such as href and title remain
// untouched, so an emoji in a URL cannot be corrupted at the send boundary.
export function convertEmojiInHtml(html) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(String(html), 'text/html')
  const walker = doc.createTreeWalker(doc.body, 4) // NodeFilter.SHOW_TEXT
  let node = walker.nextNode()
  while (node) {
    node.data = convertEmojiToEmoticons(node.data)
    node = walker.nextNode()
  }
  return doc.body.innerHTML
}
