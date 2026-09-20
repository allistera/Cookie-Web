// The eight colours a task label or email category can take. Shared so a
// task label and a category pill read as the same family.
export const LABEL_PALETTE = [
  '#e5484d',
  '#e58f1a',
  '#2f9e44',
  '#1a73e8',
  '#7048e8',
  '#d6409f',
  '#0ca678',
  '#64748b',
]

// What a label gets when it is typed onto a task rather than created in
// the sidebar. Last in the palette so it always has a swatch.
export const DEFAULT_LABEL_COLOR = LABEL_PALETTE[7]
