export const VIEW_TYPE_JOURNAL = 'md-journal-view';
export const PX_PER_MM = 96 / 25.4;
export const PAGEBREAK_LINE = '<!-- pagebreak -->';

export interface Pos {
  line: number;
  ch: number;
}

export const PAGE_SIZES = {
  a6: { label: 'A6 · pocket (105 × 148 mm)', w: 105, h: 148 },
  b6: { label: 'B6 (125 × 176 mm)', w: 125, h: 176 },
  a5: { label: 'A5 · classic journal (148 × 210 mm)', w: 148, h: 210 },
  'half-letter': { label: 'Half letter (5.5 × 8.5 in)', w: 139.7, h: 215.9 },
  b5: { label: 'B5 (176 × 250 mm)', w: 176, h: 250 },
  a4: { label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  custom: { label: 'Custom size', w: 0, h: 0 },
} as const;
export type PageSizeKey = keyof typeof PAGE_SIZES;

export const FONTS = {
  theme: { label: 'Theme font', css: 'var(--font-text)' },
  serif: { label: 'Book serif', css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif' },
  sans: { label: 'Sans serif', css: 'system-ui, "Segoe UI", "Helvetica Neue", Arial, sans-serif' },
  hand: { label: 'Handwriting', css: '"Segoe Print", "Bradley Hand", "Noteworthy", "Comic Sans MS", cursive' },
  mono: { label: 'Typewriter', css: '"Courier Prime", "American Typewriter", "Courier New", var(--font-monospace), monospace' },
  custom: { label: 'Custom…', css: '' },
} as const;
export type FontKey = keyof typeof FONTS;

export const PAPERS = { plain: 'Plain', ruled: 'Ruled', dotted: 'Dot grid', grid: 'Squared' } as const;
export type PaperKey = keyof typeof PAPERS;
export const TINTS = { theme: 'Theme colours', white: 'White', cream: 'Cream', sepia: 'Sepia', gray: 'Gray', night: 'Night' } as const;
export type TintKey = keyof typeof TINTS;
export const LAYOUTS = { screen: 'Theme view', journal: 'Journal pages (on paper)' } as const;
export type LayoutKey = keyof typeof LAYOUTS;
export const PAGE_MODES = { auto: 'Auto', single: 'One page', double: 'Two-page spread' } as const;
export type PageMode = keyof typeof PAGE_MODES;
export const OPEN_IN = { tab: 'New tab', current: 'Current tab', split: 'Split' } as const;
export const OPEN_AT = { end: 'The end, ready for a new entry', last: 'Where I left off' } as const;

export interface JournalSettings {
  layout: LayoutKey;          // 'screen' (the user's theme) | 'journal' (paper)
  screenMaxWidth: number;     // px — widest column in the theme view (0 = no limit)
  fixedPage: boolean;         // theme view: fixed text area per page, scaled to the window
  pageSize: PageSizeKey;
  customWidth: number;        // mm, when pageSize === 'custom'
  customHeight: number;       // mm
  pageMode: PageMode;
  margin: number;             // mm, on every side of the page
  fontFamily: FontKey;
  fontFamilyCustom: string;
  fontSize: number;           // px at 100 % zoom; the page scales to fit the window
  lineHeight: number;
  paper: PaperKey;
  tint: TintKey;
  hideSyntax: boolean;        // hide Markdown marks on lines you are not editing
  pageNumbers: boolean;
  headingNewPage: boolean;    // every top-level heading starts a new page
  animate: boolean;
  spellcheck: boolean;
  saveDelay: number;          // ms after the last keystroke
  journalFile: string;
  dateFormat: string;
  openIn: keyof typeof OPEN_IN;
  openAt: keyof typeof OPEN_AT;
  positions: Record<string, Pos>; // path -> where the caret was
}

export const DEFAULT_SETTINGS: JournalSettings = {
  layout: 'screen',
  screenMaxWidth: 760,
  fixedPage: false,
  pageSize: 'a5',
  customWidth: 148,
  customHeight: 210,
  pageMode: 'auto',
  margin: 14,
  fontFamily: 'serif',
  fontFamilyCustom: '',
  fontSize: 15,
  lineHeight: 1.6,
  paper: 'ruled',
  tint: 'cream',
  hideSyntax: true,
  pageNumbers: true,
  headingNewPage: false,
  animate: true,
  spellcheck: true,
  saveDelay: 700,
  journalFile: 'Journal.md',
  dateFormat: 'dddd, D MMMM YYYY',
  openIn: 'tab',
  openAt: 'end',
  positions: {},
};

type Key<T> = Extract<keyof T, string>;

function isKey<T extends object>(options: T, value: string): value is Key<T> {
  return Object.prototype.hasOwnProperty.call(options, value);
}

/* Narrows a string from a dropdown to one of an option map's keys. */
export function oneOf<T extends object>(options: T, value: string, fallback: Key<T>): Key<T> {
  return isKey(options, value) ? value : fallback;
}
