// Syntax highlighting for document code blocks. highlight.js and each grammar
// are loaded on first use, so a document only pays for the languages it shows.

export const PLAIN_LANGUAGE = 'plaintext'

// The "/" code block's language dropdown, in display order. `hljs` is the
// grammar module under highlight.js/lib/languages when it differs from the id.
export const CODE_LANGUAGES = [
  { id: PLAIN_LANGUAGE, label: 'Plain text' },
  { id: 'bash', label: 'Bash' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'css', label: 'CSS' },
  { id: 'go', label: 'Go' },
  { id: 'html', label: 'HTML', hljs: 'xml' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'php', label: 'PHP' },
  { id: 'python', label: 'Python' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'yaml', label: 'YAML' },
]

const LANGUAGE_IDS = new Set(CODE_LANGUAGES.map((language) => language.id))

// Static import paths so Vite can bundle each grammar into the lazy chunk.
const GRAMMARS = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  go: () => import('highlight.js/lib/languages/go'),
  xml: () => import('highlight.js/lib/languages/xml'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  php: () => import('highlight.js/lib/languages/php'),
  python: () => import('highlight.js/lib/languages/python'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
}

// Grammars that highlight embedded code through another grammar. hljs quietly
// shows a missing sub-language as plain text, so these load together.
const GRAMMAR_DEPS = {
  xml: ['css', 'javascript'],
}

/** Maps any stored value onto a dropdown language, falling back to plain text. */
export function normalizeCodeLanguage(value) {
  const id = String(value ?? '')
    .trim()
    .toLowerCase()
  return LANGUAGE_IDS.has(id) ? id : PLAIN_LANGUAGE
}

export function escapeCode(code) {
  return String(code ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

let highlighter = null
let core = null
const grammarLoads = new Map()

// The highlight.js grammar name for a stored language, or null for plain text.
function grammarName(language) {
  const id = normalizeCodeLanguage(language)
  if (id === PLAIN_LANGUAGE) return null
  return CODE_LANGUAGES.find((entry) => entry.id === id)?.hljs ?? id
}

function loadCore() {
  core ??= import('highlight.js/lib/core')
    .then((module) => module.default)
    .catch((error) => {
      core = null
      throw error
    })
  return core
}

/**
 * Loads the highlight.js core plus only the grammar `language` needs, so a
 * document with one Python block never downloads the other grammars. Resolves
 * to the same instance for every caller; a failed load is retried on the next
 * call.
 */
export function loadHighlighter(language = PLAIN_LANGUAGE) {
  const name = grammarName(language)
  return (name ? loadGrammar(name) : loadCore()).then(remember)
}

// Loads and registers one grammar plus any it embeds, once per name.
function loadGrammar(name) {
  let load = grammarLoads.get(name)
  if (!load) {
    const deps = GRAMMAR_DEPS[name] ?? []
    load = Promise.all([loadCore(), GRAMMARS[name](), ...deps.map(loadGrammar)])
      .then(([hljs, grammar]) => {
        hljs.registerLanguage(name, grammar.default)
        return hljs
      })
      .catch((error) => {
        grammarLoads.delete(name)
        throw error
      })
    grammarLoads.set(name, load)
  }
  return load
}

function remember(hljs) {
  highlighter = hljs
  return hljs
}

/**
 * Highlighted HTML for `code`, or escaped text when the language is plain or
 * its grammar has not loaded yet (see loadHighlighter).
 */
export function highlightCode(code, language) {
  const grammar = grammarName(language)
  if (!grammar || !highlighter?.getLanguage(grammar)) return escapeCode(code)
  try {
    return highlighter.highlight(String(code ?? ''), { language: grammar, ignoreIllegals: true })
      .value
  } catch {
    return escapeCode(code)
  }
}
