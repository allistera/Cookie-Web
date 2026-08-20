import { contentGridToWorkbookData } from './univerTableData'
import { buildUniverTheme } from './univerTheme'

const TOOLBOX_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/>
    <line x1="9" y1="3" x2="9" y2="21"/>
  </svg>`

// Every preset here is loaded together and lazily (see mountUniver): core
// (grid, rendering, formulas, number formatting), plus the feature set that
// makes this a real spreadsheet rather than a static grid — sort, filter,
// conditional formatting, data validation, find & replace, and hyperlinks.
// Real-time collaboration (thread comments) and drawing/images are left out:
// both need backend integration this block doesn't have yet, not just a
// client preset. Each preset also ships its own locale strings, which all
// have to be merged in (mountUniver) — without a preset's locale, its menu
// items render as raw i18n keys (e.g. "sheets-sort-ui.general.sort") instead
// of "Sort".
async function loadUniver() {
  const [
    presets,
    core,
    coreLocaleEn,
    sort,
    sortLocaleEn,
    filter,
    filterLocaleEn,
    conditionalFormatting,
    conditionalFormattingLocaleEn,
    dataValidation,
    dataValidationLocaleEn,
    findReplace,
    findReplaceLocaleEn,
    hyperLink,
    hyperLinkLocaleEn,
  ] = await Promise.all([
    import('@univerjs/presets'),
    import('@univerjs/preset-sheets-core'),
    import('@univerjs/preset-sheets-core/locales/en-GB'),
    import('@univerjs/preset-sheets-sort'),
    import('@univerjs/preset-sheets-sort/locales/en-GB'),
    import('@univerjs/preset-sheets-filter'),
    import('@univerjs/preset-sheets-filter/locales/en-GB'),
    import('@univerjs/preset-sheets-conditional-formatting'),
    import('@univerjs/preset-sheets-conditional-formatting/locales/en-GB'),
    import('@univerjs/preset-sheets-data-validation'),
    import('@univerjs/preset-sheets-data-validation/locales/en-GB'),
    import('@univerjs/preset-sheets-find-replace'),
    import('@univerjs/preset-sheets-find-replace/locales/en-GB'),
    import('@univerjs/preset-sheets-hyper-link'),
    import('@univerjs/preset-sheets-hyper-link/locales/en-GB'),
  ])
  await Promise.all([
    import('@univerjs/preset-sheets-core/lib/index.css'),
    import('@univerjs/preset-sheets-sort/lib/index.css'),
    import('@univerjs/preset-sheets-filter/lib/index.css'),
    import('@univerjs/preset-sheets-conditional-formatting/lib/index.css'),
    import('@univerjs/preset-sheets-data-validation/lib/index.css'),
    import('@univerjs/preset-sheets-find-replace/lib/index.css'),
    import('@univerjs/preset-sheets-hyper-link/lib/index.css'),
  ])
  return {
    presets,
    core,
    coreLocaleGb,
    sort,
    sortLocaleGb,
    filter,
    filterLocaleGb,
    conditionalFormatting,
    conditionalFormattingLocaleGb,
    dataValidation,
    dataValidationLocaleGb,
    findReplace,
    findReplaceLocaleGb,
    hyperLink,
    hyperLinkLocaleGb,
  }
}

export class UniverSheetTool {
  static get toolbox() {
    return { title: 'Table', icon: TOOLBOX_ICON }
  }

  constructor({ data, config }) {
    this.data = data ?? {}
    this.config = config ?? {}
    this.wrapper = null
    this.univer = null
    this.univerAPI = null
    this.changeFrame = null
    this.themeObserver = null
    this.calculating = false
    this.calculationSettled = Promise.resolve()
    this.formulaDisposables = []
  }

  render() {
    this.wrapper = document.createElement('div')
    this.wrapper.className = 'univer-sheet-block'
    this.wrapper.setAttribute('role', 'region')
    this.wrapper.setAttribute('aria-label', 'Table')
    // Univer owns cell navigation and editing entirely — without this,
    // Editor.js's own block-level handler (bound on the ancestor .ce-block)
    // intercepts Tab/Backspace/Delete/Enter/arrows/"/" first and acts on the
    // document instead of the sheet (e.g. Tab escapes the grid and starts
    // typing into the next document block). Same fix as kanbanBlockTool.js.
    this.wrapper.addEventListener('keydown', (event) => event.stopPropagation())

    const loading = document.createElement('div')
    loading.className = 'univer-sheet-block__loading'
    loading.textContent = 'Loading table…'
    this.wrapper.append(loading)

    this.mountUniver(loading)
    return this.wrapper
  }

  async mountUniver(loading) {
    try {
      const {
        presets,
        core,
        coreLocaleGb,
        sort,
        sortLocaleGb,
        filter,
        filterLocaleGb,
        conditionalFormatting,
        conditionalFormattingLocaleGb,
        dataValidation,
        dataValidationLocaleGb,
        findReplace,
        findReplaceLocaleGb,
        hyperLink,
        hyperLinkLocaleGb,
      } = await loadUniver()
      if (!this.wrapper?.isConnected) return

      const { createUniver, defaultTheme, LocaleType, mergeLocales } = presets

      const canvas = document.createElement('div')
      canvas.className = 'univer-sheet-block__canvas'
      loading.replaceWith(canvas)

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark'

      const { univer, univerAPI } = createUniver({
        theme: buildUniverTheme(defaultTheme),
        darkMode: isDark,
        locale: LocaleType.EN_GB,
        locales: {
          [LocaleType.EN_GB]: mergeLocales(
            coreLocaleGb.default,
            sortLocaleGb.default,
            filterLocaleGb.default,
            conditionalFormattingLocaleGb.default,
            dataValidationLocaleGb.default,
            findReplaceLocaleGb.default,
            hyperLinkLocaleGb.default,
          ),
        },
        presets: [
          // ribbonType: 'collapsed' keeps the toolbar to one compact row —
          // like 'simple', and unlike 'classic''s full multi-row ribbon,
          // which reads as too much chrome inside a document column — but
          // prefixes it with a tab pill (Start/Insert/Formulas/Data) and
          // shows only the active tab's items. 'simple' instead flattens
          // *every* tab into that single row, and the document column is
          // only 720px wide, so all but a dozen items collapsed into the "⋮"
          // overflow — a panel Univer sizes against the viewport, not the
          // block, so it spilled across the sidebar (ALL-28). main.css caps
          // that panel's width for whatever still collapses here.
          // footer (sheet tabs/stats bar/zoom) stays off: one sheet per
          // table block has no use for a sheet switcher, and the formula bar
          // above already covers the active-cell reference.
          core.UniverSheetsCorePreset({
            container: canvas,
            header: true,
            toolbar: true,
            ribbonType: 'collapsed',
            footer: false,
            formulaBar: true,
            contextMenu: true,
          }),
          sort.UniverSheetsSortPreset(),
          filter.UniverSheetsFilterPreset(),
          conditionalFormatting.UniverSheetsConditionalFormattingPreset(),
          dataValidation.UniverSheetsDataValidationPreset(),
          findReplace.UniverSheetsFindReplacePreset(),
          hyperLink.UniverSheetsHyperLinkPreset(),
        ],
      })

      this.univer = univer
      this.univerAPI = univerAPI

      // A brand-new insert (no prior workbook snapshot or legacy content) has
      // nowhere to put column titles but row 1 — freeze it by default so it
      // stays in view once the table grows. Existing tables keep whatever
      // freeze state they already have; this never overrides it.
      const isBlankInsert = !this.data?.workbook && !this.data?.content
      const workbookData = this.data?.workbook ?? contentGridToWorkbookData(this.data?.content)
      univerAPI.createWorkbook(workbookData)
      if (isBlankInsert) univerAPI.getActiveWorkbook()?.getActiveSheet()?.setFrozenRows(1)
      univerAPI.onCommandExecuted(() => this.scheduleDocumentSave())

      // Formula recalculation runs asynchronously, off the command that
      // triggered it — save() awaits calculationSettled so a fast edit
      // followed by autosave can't serialize a workbook where a dependent
      // cell's cached value is still stale relative to its formula/inputs.
      const formula = univerAPI.getFormula()
      let resolveSettled = () => {}
      this.formulaDisposables = [
        formula.calculationStart(() => {
          this.calculating = true
          this.calculationSettled = new Promise((resolve) => {
            resolveSettled = resolve
          })
        }),
        formula.calculationEnd(() => {
          this.calculating = false
          resolveSettled()
        }),
      ]

      this.themeObserver = new MutationObserver(() => {
        this.univerAPI?.toggleDarkMode(document.documentElement.getAttribute('data-theme') === 'dark')
      })
      this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

      // Playwright can't reach into a canvas-rendered grid via DOM locators;
      // e2e specs drive/assert sheet content through this instead.
      if (import.meta.env.MODE === 'e2e') this.wrapper.__univerAPI = univerAPI
    } catch (error) {
      console.error('Loading the table failed:', error)
      loading.classList.add('error')
      loading.textContent = 'Table could not be loaded.'
    }
  }

  scheduleDocumentSave() {
    if (this.changeFrame !== null) return
    this.changeFrame = requestAnimationFrame(() => {
      this.changeFrame = null
      this.config.onChange?.()
    })
  }

  async save() {
    if (this.calculating) await this.calculationSettled
    const workbook = this.univerAPI?.getActiveWorkbook()?.save()
    return workbook ? { workbook } : this.data
  }

  destroy() {
    if (this.changeFrame !== null) cancelAnimationFrame(this.changeFrame)
    this.changeFrame = null
    this.themeObserver?.disconnect()
    this.themeObserver = null
    for (const disposable of this.formulaDisposables) disposable.dispose()
    this.formulaDisposables = []
    this.univer?.dispose()
    this.univerAPI?.dispose()
    this.univer = null
    this.univerAPI = null
    this.wrapper = null
  }
}
