// Turns code pasted from IDEs, web pages and Markdown into a code block
// ({ code, language }) instead of letting it land as reformatted paragraphs.

import { PLAIN_LANGUAGE, normalizeCodeLanguage } from './codeHighlight'

// Language names seen in the wild (VS Code modes, highlight classes, fence
// info strings) mapped onto the code block's dropdown ids.
const LANGUAGE_ALIASES = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  javascriptreact: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  typescriptreact: 'typescript',
  py: 'python',
  python3: 'python',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  htm: 'html',
  xml: 'html',
  xhtml: 'html',
  svg: 'html',
  vue: 'html',
  svelte: 'html',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'c',
  kt: 'kotlin',
  kts: 'kotlin',
  jsonc: 'json',
  json5: 'json',
  scss: 'css',
  sass: 'css',
  less: 'css',
  mysql: 'sql',
  pgsql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  sqlite: 'sql',
  plsql: 'sql',
}

/** Maps a language hint from any source onto a supported language id. */
export function codeLanguageFromHint(hint) {
  const id = String(hint ?? '')
    .trim()
    .toLowerCase()
  return normalizeCodeLanguage(LANGUAGE_ALIASES[id] ?? id)
}

const CLASS_LANGUAGE =
  /(?:^|\s)(?:language|lang|highlight-source|highlight|brush)[-:]\s*([\w#+.-]+)/i

/** Reads a language from `language-x` / `lang-x` / `highlight-source-x` classes or data-lang. */
export function languageFromElement(element) {
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const hint =
      node.getAttribute('data-lang') ??
      node.getAttribute('data-language') ??
      node.getAttribute('class')?.match(CLASS_LANGUAGE)?.[1]
    const language = hint ? codeLanguageFromHint(hint) : PLAIN_LANGUAGE
    if (language !== PLAIN_LANGUAGE) return language
    const inner = node.querySelector?.(':scope > code')
    const innerHint = inner?.getAttribute('class')?.match(CLASS_LANGUAGE)?.[1]
    if (innerHint && codeLanguageFromHint(innerHint) !== PLAIN_LANGUAGE) {
      return codeLanguageFromHint(innerHint)
    }
  }
  return PLAIN_LANGUAGE
}

/** Text of a <pre>, keeping <br> line breaks that textContent would drop. */
export function preText(pre) {
  const copy = pre.cloneNode(true)
  for (const br of copy.querySelectorAll('br')) br.replaceWith('\n')
  return tidy(copy.textContent)
}

function tidy(code) {
  return String(code ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
}

const MONOSPACE = /monospace|menlo|monaco|consolas|courier|mono\b|jetbrains|fira code|source code/i

// Elements that carry real content, ignoring the <meta>/<style> wrappers
// browsers and IDEs add to copied HTML.
function contentElements(parent) {
  return [...parent.children].filter((node) => !['META', 'STYLE', 'LINK'].includes(node.tagName))
}

function hasOtherText(root, keep) {
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!keep.contains(node) && node.textContent.trim()) return true
  }
  return false
}

function fromHtml(html, plain) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  const pres = body.querySelectorAll('pre')
  // Exactly one <pre> and nothing else worth keeping: GitHub, Stack Overflow,
  // docs sites, JetBrains IDEs. Mixed prose + code is left to Editor.js.
  if (pres.length === 1 && !hasOtherText(body, pres[0])) {
    const code = preText(pres[0])
    return code.trim() ? { code, language: languageFromElement(pres[0]) } : null
  }
  if (pres.length) return null
  // VS Code, Xcode, Sublime and friends copy a monospace, whitespace-
  // preserving <div> of coloured spans. The plain-text flavour has the code.
  const [root, ...rest] = contentElements(body)
  if (!root || rest.length) return null
  const style = root.getAttribute('style') ?? ''
  if (/white-space:\s*pre/i.test(style) && MONOSPACE.test(style)) {
    const code = tidy(plain || root.textContent)
    return code.trim() ? { code, language: languageFromElement(root) } : null
  }
  return null
}

const FENCE = /^(`{3,}|~{3,})[ \t]*([\w#+.-]*)[^\n]*\n([\s\S]*?)\n?\1[ \t]*$/

/**
 * Recognises pasted code and returns `{ code, language }`, or null when the
 * clipboard holds ordinary text that Editor.js should paste as usual.
 *
 * @param {DataTransfer | null | undefined} clipboard
 */
export function readCodePaste(clipboard) {
  if (!clipboard) return null
  const plain = clipboard.getData('text/plain') ?? ''
  const html = clipboard.getData('text/html') ?? ''

  // VS Code tags its copies with the editor's language mode.
  const vscode = clipboard.getData('vscode-editor-data')
  if (vscode && plain.trim()) {
    let mode
    try {
      mode = JSON.parse(vscode)?.mode ?? ''
    } catch {
      mode = ''
    }
    // Copying a few words from a line is ordinary text, not a code block.
    if (plain.trim().includes('\n')) {
      return { code: tidy(plain), language: codeLanguageFromHint(mode) }
    }
  }

  const fenced = plain.trim().match(FENCE)
  if (fenced) return { code: tidy(fenced[3]), language: codeLanguageFromHint(fenced[2]) }

  if (html) return fromHtml(html, plain)
  return null
}

/**
 * Intercepts pastes into an ordinary text block before Editor.js sees them
 * and inserts recognised code as a code block: replacing the block when it
 * is empty, otherwise right after it.
 *
 * @param {{ editor: any, holder: HTMLElement }} options
 * @returns {() => void} detach
 */
export function attachCodePaste({ editor, holder }) {
  function onPaste(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement
    // Code blocks, tables and boards handle their own pastes.
    if (!target?.closest('.ce-paragraph')) return
    const pasted = readCodePaste(event.clipboardData)
    if (!pasted) return
    event.preventDefault()
    event.stopPropagation()

    const index = editor.blocks.getCurrentBlockIndex()
    const current = index >= 0 ? editor.blocks.getBlockByIndex(index) : null
    const replace = Boolean(current?.isEmpty)
    const at = replace ? index : index + 1
    editor.blocks.insert('code', pasted, undefined, at, true, replace)
  }
  // Capture phase: runs before Editor.js's own paste handler on its wrapper.
  holder.addEventListener('paste', onPaste, true)
  return () => holder.removeEventListener('paste', onPaste, true)
}
