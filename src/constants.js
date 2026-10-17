export const VIEW_TYPE_JOURNAL = 'md-journal-view';
export const PX_PER_MM = 96 / 25.4;
export const PAGEBREAK_LINE = '<!-- pagebreak -->';

export const PAGE_SIZES = {
  a6: { label: 'A6 · pocket (105 × 148 mm)', w: 105, h: 148 },
  b6: { label: 'B6 (125 × 176 mm)', w: 125, h: 176 },
  a5: { label: 'A5 · classic journal (148 × 210 mm)', w: 148, h: 210 },
  'half-letter': { label: 'Half letter (5.5 × 8.5 in)', w: 139.7, h: 215.9 },
  b5: { label: 'B5 (176 × 250 mm)', w: 176, h: 250 },
  a4: { label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  custom: { label: 'Custom size', w: 0, h: 0 },
};

export const FONTS = {
  theme: { label: 'Theme font', css: 'var(--font-text)' },
  serif: { label: 'Book serif', css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif' },
  sans: { label: 'Sans serif', css: 'system-ui, "Segoe UI", "Helvetica Neue", Arial, sans-serif' },
  hand: { label: 'Handwriting', css: '"Segoe Print", "Bradley Hand", "Noteworthy", "Comic Sans MS", cursive' },
  mono: { label: 'Typewriter', css: '"Courier Prime", "American Typewriter", "Courier New", var(--font-monospace), monospace' },
  custom: { label: 'Custom…', css: '' },
};

export const PAPERS = { plain: 'Plain', ruled: 'Ruled', dotted: 'Dot grid', grid: 'Squared' };
export const TINTS = { theme: 'Theme colours', white: 'White', cream: 'Cream', sepia: 'Sepia', gray: 'Gray', night: 'Night' };
export const LAYOUTS = { screen: 'Theme view', journal: 'Journal pages (on paper)' };

export const DEFAULT_SETTINGS = {
  layout: 'screen',       // 'screen' (the user's theme) | 'journal' (paper)
  screenMaxWidth: 760,    // px — widest column in the theme view (0 = no limit)
  fixedPage: false,       // theme view: fixed text area per page, scaled to the window
  pageSize: 'a5',
  customWidth: 148,       // mm, when pageSize === 'custom'
  customHeight: 210,      // mm
  pageMode: 'auto',       // 'auto' | 'single' | 'double'
  margin: 14,             // mm, on every side of the page
  fontFamily: 'serif',
  fontFamilyCustom: '',
  fontSize: 15,           // px at 100 % zoom; the page scales to fit the window
  lineHeight: 1.6,
  paper: 'ruled',
  tint: 'cream',
  hideSyntax: true,       // hide Markdown marks on lines you are not editing
  pageNumbers: true,
  headingNewPage: false,  // every top-level heading starts a new page
  animate: true,
  spellcheck: true,
  saveDelay: 700,         // ms after the last keystroke
  journalFile: 'Journal.md',
  dateFormat: 'dddd, D MMMM YYYY',
  openIn: 'tab',          // 'tab' | 'current' | 'split'
  openAt: 'end',          // 'end' | 'last'
  positions: {},          // path -> { line, ch } — where the caret was
};
