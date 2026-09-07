// Keep the Google-hosted Material Symbols subset off the logged-out critical
// path. The authenticated shell requests it once, immediately before icons are
// needed; iconFontSubset.spec.js keeps this list aligned with source usage.
export const MATERIAL_SYMBOL_NAMES = [
  'add',
  'add_reaction',
  'add_task',
  'arrow_back',
  'arrow_forward',
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

const MATERIAL_SYMBOLS_URL =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:' +
  'opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=' +
  `${MATERIAL_SYMBOL_NAMES.join(',')}&display=block`

export function loadMaterialSymbols(doc = document) {
  if (doc.head.querySelector('link[data-material-symbols]')) return
  doc.documentElement.dataset.materialSymbols = 'loading'
  const stylesheet = doc.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = MATERIAL_SYMBOLS_URL
  stylesheet.dataset.materialSymbols = ''
  stylesheet.addEventListener(
    'load',
    () => {
      doc.documentElement.dataset.materialSymbols = 'loaded'
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
  // The Google stylesheet also declares size, colour, and line-height on the
  // icon class. Keep it before application CSS so component-level rules retain
  // the same cascade precedence they had when the font lived in index.html.
  const applicationStyles = doc.head.querySelector('style, link[rel="stylesheet"]')
  if (applicationStyles) doc.head.insertBefore(stylesheet, applicationStyles)
  else doc.head.append(stylesheet)
}
