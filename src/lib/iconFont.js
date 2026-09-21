// Keep the Material Symbols subset off the logged-out critical path. The
// authenticated shell requests it once, immediately before icons are needed;
// iconFontSubset.spec.js keeps this list aligned with source usage.
//
// The subset is self-hosted (public/fonts/, precached by public/sw.js) rather
// than fetched from fonts.googleapis.com, so an installed PWA started offline
// still renders icons. After editing this list run `npm run fetch:icon-font`
// to regenerate the woff2 and its stylesheet from the same names.
export const MATERIAL_SYMBOL_NAMES = [
  'add',
  'add_reaction',
  'add_task',
  'archive',
  'arrow_back',
  'arrow_forward',
  'arrow_upward',
  'attach_file',
  'auto_awesome',
  'auto_fix_high',
  'bolt',
  'bookmark',
  'calendar_month',
  'chat_bubble',
  'check',
  'check_box',
  'check_box_outline_blank',
  'circle',
  'close',
  'cookie',
  'create_new_folder',
  'dark_mode',
  'delete',
  'description',
  'done_all',
  'download',
  'draft',
  'drag_indicator',
  'draw',
  'drive_file_move',
  'edit',
  'edit_square',
  'event_available',
  'expand_less',
  'expand_more',
  'filter_alt',
  'flag',
  'folder',
  'format_bold',
  'format_list_bulleted',
  'format_list_numbered',
  'format_quote',
  'forward',
  'horizontal_rule',
  'inbox',
  'interests',
  'keyboard_arrow_down',
  'keyboard_arrow_right',
  'keyboard_arrow_up',
  'label',
  'light_mode',
  'link',
  'logout',
  'mail',
  'mark_email_read',
  'mark_email_unread',
  'more_horiz',
  'note_add',
  'notification_add',
  'notifications',
  'notifications_active',
  'notifications_off',
  'open_in_new',
  'palette',
  'person',
  'picture_as_pdf',
  'reply',
  'reply_all',
  'report',
  'report_off',
  'rule',
  'schedule',
  'search',
  'sell',
  'send',
  'settings',
  'star',
  'star_border',
  'sync',
  'tab',
  'tag',
  'task_alt',
  'title',
  'today',
  'unfold_more',
  'unsubscribe',
  'upcoming',
  'visibility_off',
  'warning_amber',
]

// Written by scripts/fetch-icon-font.mjs; served same-origin and precached by
// public/sw.js, so this request works offline and adds no third-party origin
// to the render path.
export const MATERIAL_SYMBOLS_STYLESHEET_URL = '/fonts/material-symbols-outlined.css'

// Matches the @font-face in that stylesheet.
const MATERIAL_SYMBOLS_FONT = '24px "Material Symbols Outlined"'

export function loadMaterialSymbols(doc = document) {
  if (doc.head.querySelector('link[data-material-symbols]')) return
  doc.documentElement.dataset.materialSymbols = 'loading'
  const stylesheet = doc.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = MATERIAL_SYMBOLS_STYLESHEET_URL
  stylesheet.dataset.materialSymbols = ''
  stylesheet.addEventListener(
    'load',
    () => {
      void revealWhenGlyphsReady(doc)
    },
    { once: true },
  )
  stylesheet.addEventListener(
    'error',
    () => {
      doc.documentElement.dataset.materialSymbols = 'error'
    },
    { once: true },
  )
  // The generated stylesheet mirrors Google's and also declares size, colour,
  // line-height, and ligature settings on the icon class. Keep it before
  // application CSS so component-level rules retain the same cascade
  // precedence they had when the font lived in index.html.
  const applicationStyles = doc.head.querySelector('style, link[rel="stylesheet"]')
  if (applicationStyles) doc.head.insertBefore(stylesheet, applicationStyles)
  else doc.head.append(stylesheet)
}

// The stylesheet's load event only means the @font-face rule parsed. Wait for
// the woff2 itself before revealing icons: font-display: block would otherwise
// expire and paint raw ligature text ("calendar_month") in every control.
async function revealWhenGlyphsReady(doc) {
  try {
    const faces = await doc.fonts?.load?.(MATERIAL_SYMBOLS_FONT)
    if (faces?.length === 0) throw new Error('Material Symbols Outlined is not declared')
    doc.documentElement.dataset.materialSymbols = 'loaded'
  } catch {
    doc.documentElement.dataset.materialSymbols = 'error'
  }
}
