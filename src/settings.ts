import {
  Modal, PluginSettingTab, Setting, requireApiVersion,
  type App, type SettingDefinition, type SettingDefinitionItem,
} from 'obsidian';
import {
  DEFAULT_SETTINGS, FONTS, LAYOUTS, OPEN_AT, OPEN_IN, PAGE_SIZES, PAPERS, TINTS, oneOf, type JournalSettings,
} from './constants';
import type MdJournalPlugin from './main';

/*
 * Every setting is declared once, below. The same list renders the settings tab
 * the old way (Obsidian 1.10–1.12, and the appearance modal) and as declarative
 * definitions (Obsidian 1.13+, which also makes the settings searchable).
 */

type KeysOf<V> = { [K in keyof JournalSettings]: JournalSettings[K] extends V ? K : never }[keyof JournalSettings];
type BoolKey = KeysOf<boolean>;
type NumKey = KeysOf<number>;
type StrKey = KeysOf<string>;

interface BaseSpec {
  name: string;
  desc?: string;
  visible?: (s: JournalSettings) => boolean;
  rerender?: boolean; // other settings appear or disappear when this one changes
}
type Spec = BaseSpec & (
  | { kind: 'toggle'; key: BoolKey }
  | { kind: 'dropdown'; key: StrKey; options: Record<string, string> }
  | { kind: 'slider'; key: NumKey; min: number; max: number; step: number }
  | { kind: 'number'; key: NumKey; min: number; max: number; placeholder: string }
  | { kind: 'text'; key: StrKey; placeholder: string }
);

const optionLabels = (o: Record<string, { label: string }>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.label]));

const journal = (s: JournalSettings): boolean => s.layout === 'journal';
const theme = (s: JournalSettings): boolean => s.layout === 'screen';
const fixedSize = (s: JournalSettings): boolean => journal(s) || s.fixedPage;

const JOURNAL_SPECS: Spec[] = [
  { kind: 'text', key: 'journalFile', name: 'Journal note', desc: 'The note that the ribbon button opens. It is created if it does not exist.', placeholder: 'Journal.md' },
  { kind: 'dropdown', key: 'openAt', name: 'Open at', desc: 'Where the caret goes when a note opens as a journal.', options: { ...OPEN_AT } },
  { kind: 'dropdown', key: 'openIn', name: 'Open in', options: { ...OPEN_IN } },
  { kind: 'text', key: 'dateFormat', name: 'Date heading format', desc: 'Format of the date that the insert date heading command adds.', placeholder: DEFAULT_SETTINGS.dateFormat },
  { kind: 'toggle', key: 'spellcheck', name: 'Spellcheck' },
  { kind: 'toggle', key: 'animate', name: 'Page-turn animation' },
];

const PAGE_SPECS: Spec[] = [
  { kind: 'dropdown', key: 'layout', name: 'Layout', desc: 'The theme view uses your normal theme. Journal pages are a fixed size, on paper.', options: { ...LAYOUTS }, rerender: true },
  { kind: 'dropdown', key: 'pageMode', name: 'Columns', desc: 'Auto shows two columns when the pane is wide enough.', options: { auto: 'Auto', single: 'One column', double: 'Two columns' }, visible: theme },
  { kind: 'dropdown', key: 'pageMode', name: 'Pages', desc: 'Auto shows an open book (two pages) when the window is wide enough.', options: { auto: 'Auto', single: 'One page', double: 'Two-page spread' }, visible: journal },
  {
    kind: 'toggle', key: 'fixedPage', name: 'Fixed page', visible: theme, rerender: true,
    desc: 'Every page holds the same amount of text whatever the window size: the page is scaled to fit instead of re-flowing, so page breaks stay put.',
  },
  { kind: 'slider', key: 'screenMaxWidth', name: 'Max column width', desc: 'In pixels; 0 lets the columns fill the pane.', min: 0, max: 1400, step: 20, visible: (s) => theme(s) && !s.fixedPage },
  {
    kind: 'dropdown', key: 'pageSize', name: 'Page size', options: optionLabels(PAGE_SIZES), visible: fixedSize, rerender: true,
    desc: 'The page keeps this size whatever the window: it is scaled to fit, so the text never re-flows.',
  },
  { kind: 'number', key: 'customWidth', name: 'Page width', desc: 'In millimetres.', min: 50, max: 420, placeholder: '148', visible: (s) => fixedSize(s) && s.pageSize === 'custom' },
  { kind: 'number', key: 'customHeight', name: 'Page height', desc: 'In millimetres.', min: 50, max: 600, placeholder: '210', visible: (s) => fixedSize(s) && s.pageSize === 'custom' },
  { kind: 'slider', key: 'margin', name: 'Margins', desc: 'Millimetres around the text on each page.', min: 4, max: 30, step: 1, visible: fixedSize },
  { kind: 'dropdown', key: 'paper', name: 'Paper', options: { ...PAPERS }, visible: journal },
  { kind: 'dropdown', key: 'tint', name: 'Paper colour', options: { ...TINTS }, visible: journal },
  { kind: 'dropdown', key: 'fontFamily', name: 'Font', options: optionLabels(FONTS), visible: journal, rerender: true },
  { kind: 'text', key: 'fontFamilyCustom', name: 'Custom font', desc: 'Any font family list that CSS accepts.', placeholder: 'Georgia, serif', visible: (s) => journal(s) && s.fontFamily === 'custom' },
  { kind: 'slider', key: 'fontSize', name: 'Font size', desc: 'In pixels on an unscaled page.', min: 10, max: 28, step: 1, visible: journal },
  { kind: 'slider', key: 'lineHeight', name: 'Line spacing', min: 1.2, max: 2.4, step: 0.05 },
  { kind: 'toggle', key: 'hideSyntax', name: 'Hide Markdown marks', desc: 'Show bold, headings and links as formatting, and their marks only on the line you are writing.' },
  { kind: 'toggle', key: 'pageNumbers', name: 'Page numbers', visible: journal },
  { kind: 'toggle', key: 'headingNewPage', name: 'New page for each top-level heading', desc: 'Every top-level heading starts on a fresh page: one entry per page.' },
];

const ALL_SPECS = [...JOURNAL_SPECS, ...PAGE_SPECS];

/* Validates a value from either renderer and writes it into the settings. */
function writeSpec(s: JournalSettings, spec: Spec, value: unknown): boolean {
  switch (spec.kind) {
    case 'toggle':
      if (typeof value !== 'boolean') return false;
      Reflect.set(s, spec.key, value);
      return true;
    case 'slider':
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) return false;
      Reflect.set(s, spec.key, n);
      return true;
    }
    case 'dropdown': {
      if (typeof value !== 'string') return false;
      Reflect.set(s, spec.key, oneOf(spec.options, value, s[spec.key]));
      return true;
    }
    case 'text': {
      if (typeof value !== 'string') return false;
      const fallback = DEFAULT_SETTINGS[spec.key];
      Reflect.set(s, spec.key, spec.key === 'fontFamilyCustom' ? value : value.trim() || fallback);
      return true;
    }
  }
}

function readSpec(s: JournalSettings, spec: Spec): boolean | number | string {
  return s[spec.key];
}

/* Renders specs with the classic Setting API. */
function renderSpecs(el: HTMLElement, plugin: MdJournalPlugin, specs: Spec[], redisplay: () => void): void {
  const s = plugin.config;
  const change = async (spec: Spec, value: unknown): Promise<void> => {
    if (!writeSpec(s, spec, value)) return;
    await plugin.saveSettings();
    plugin.refreshViews();
    if (spec.rerender) redisplay();
  };
  for (const spec of specs) {
    if (spec.visible && !spec.visible(s)) continue;
    const row = new Setting(el).setName(spec.name);
    if (spec.desc) row.setDesc(spec.desc);
    switch (spec.kind) {
      case 'toggle':
        row.addToggle((t) => t.setValue(s[spec.key]).onChange((v) => { void change(spec, v); }));
        break;
      case 'dropdown':
        row.addDropdown((d) => d.addOptions(spec.options).setValue(s[spec.key]).onChange((v) => { void change(spec, v); }));
        break;
      case 'slider':
        row.addSlider((sl) => sl.setLimits(spec.min, spec.max, spec.step).setValue(s[spec.key]).onChange((v) => { void change(spec, v); }));
        break;
      case 'number':
      case 'text':
        row.addText((t) => t.setPlaceholder(spec.placeholder).setValue(String(s[spec.key])).onChange((v) => { void change(spec, v); }));
        break;
    }
  }
}

/* The same specs as declarative definitions (Obsidian 1.13+). */
function toDefinition(spec: Spec, s: JournalSettings): SettingDefinition {
  const base = { name: spec.name, desc: spec.desc, visible: spec.visible ? (): boolean => spec.visible?.(s) ?? true : undefined };
  switch (spec.kind) {
    case 'toggle':
      return { ...base, control: { type: 'toggle', key: spec.key, defaultValue: DEFAULT_SETTINGS[spec.key] } };
    case 'dropdown':
      return { ...base, control: { type: 'dropdown', key: spec.key, options: spec.options, defaultValue: DEFAULT_SETTINGS[spec.key] } };
    case 'slider':
      return { ...base, control: { type: 'slider', key: spec.key, min: spec.min, max: spec.max, step: spec.step, defaultValue: DEFAULT_SETTINGS[spec.key] } };
    case 'number':
      return { ...base, control: { type: 'number', key: spec.key, min: spec.min, max: spec.max, placeholder: spec.placeholder } };
    case 'text':
      return { ...base, control: { type: 'text', key: spec.key, placeholder: spec.placeholder } };
  }
}

export class AppearanceModal extends Modal {
  private plugin: MdJournalPlugin;

  constructor(app: App, plugin: MdJournalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.titleEl.setText('Journal appearance');
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    renderSpecs(this.contentEl, this.plugin, PAGE_SPECS, () => this.render());
  }

  onClose(): void { this.contentEl.empty(); }
}

export class JournalSettingTab extends PluginSettingTab {
  private plugin: MdJournalPlugin;

  constructor(app: App, plugin: MdJournalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /* Obsidian 1.13+: searchable, declarative settings. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.config;
    return [
      { type: 'group', items: JOURNAL_SPECS.map((spec) => toDefinition(spec, s)) },
      { type: 'group', heading: 'Page', items: PAGE_SPECS.map((spec) => toDefinition(spec, s)) },
    ];
  }

  getControlValue(key: string): unknown {
    const spec = ALL_SPECS.find((x) => x.key === key);
    return spec ? readSpec(this.plugin.config, spec) : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    // pageMode appears twice (columns / pages); both write the same value
    const spec = ALL_SPECS.find((x) => x.key === key);
    if (!spec || !writeSpec(this.plugin.config, spec, value)) return;
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
    if (requireApiVersion('1.13.0') && spec.rerender) this.update();
  }

  /* Obsidian 1.10–1.12. */
  display(): void {
    this.render();
  }

  private render(): void {
    const el = this.containerEl;
    el.empty();
    renderSpecs(el, this.plugin, JOURNAL_SPECS, () => this.render());
    new Setting(el).setName('Page').setHeading();
    renderSpecs(el, this.plugin, PAGE_SPECS, () => this.render());
  }
}
