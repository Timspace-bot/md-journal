import { Modal, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_SETTINGS, FONTS, LAYOUTS, PAGE_SIZES, PAPERS, TINTS } from './constants.js';

function addPageSize(el, s, apply, redisplay) {
  new Setting(el).setName('Page size')
    .setDesc('The page keeps this size whatever the window: it is scaled to fit, so the text never re-flows.')
    .addDropdown((d) => {
      for (const [k, v] of Object.entries(PAGE_SIZES)) d.addOption(k, v.label);
      d.setValue(s.pageSize).onChange(async (v) => { s.pageSize = v; await apply(); redisplay(); });
    });
  if (s.pageSize === 'custom') {
    new Setting(el).setName('Custom page size').setDesc('Width and height in millimetres.')
      .addText((t) => t.setPlaceholder('148').setValue(String(s.customWidth)).onChange(async (v) => {
        const n = Number(v);
        if (n >= 50 && n <= 420) { s.customWidth = n; await apply(); }
      }))
      .addText((t) => t.setPlaceholder('210').setValue(String(s.customHeight)).onChange(async (v) => {
        const n = Number(v);
        if (n >= 50 && n <= 600) { s.customHeight = n; await apply(); }
      }));
  }
  new Setting(el).setName('Margins').setDesc('Millimetres around the text on each page.')
    .addSlider((sl) => sl.setLimits(4, 30, 1).setValue(s.margin).setDynamicTooltip()
      .onChange(async (v) => { s.margin = v; await apply(); }));
}

function addCommon(el, s, apply) {
  new Setting(el).setName('Line spacing')
    .addSlider((sl) => sl.setLimits(1.2, 2.4, 0.05).setValue(s.lineHeight).setDynamicTooltip()
      .onChange(async (v) => { s.lineHeight = v; await apply(); }));
  new Setting(el).setName('Hide Markdown marks').setDesc('Show bold, headings and links as formatting, and their marks only on the line you are writing.')
    .addToggle((t) => t.setValue(s.hideSyntax).onChange(async (v) => { s.hideSyntax = v; await apply(); }));
}

export function addAppearanceSettings(el, plugin, redisplay) {
  const s = plugin.config;
  const apply = async () => { await plugin.saveSettings(); plugin.refreshViews(); };

  new Setting(el).setName('Layout').setDesc('The theme view uses your normal theme. Journal pages are a fixed size, on paper.')
    .addDropdown((d) => d.addOptions(LAYOUTS).setValue(s.layout).onChange(async (v) => { s.layout = v; await apply(); redisplay(); }));

  if (s.layout === 'screen') {
    new Setting(el).setName('Columns').setDesc('Auto shows two columns when the pane is wide enough.')
      .addDropdown((d) => d.addOptions({ auto: 'Auto', single: 'One column', double: 'Two columns' })
        .setValue(s.pageMode).onChange(async (v) => { s.pageMode = v; await apply(); }));
    new Setting(el).setName('Fixed page')
      .setDesc('Every page holds the same amount of text whatever the window size: the page is scaled to fit instead of re-flowing, so page breaks stay put.')
      .addToggle((t) => t.setValue(!!s.fixedPage).onChange(async (v) => { s.fixedPage = v; await apply(); redisplay(); }));
    if (s.fixedPage) {
      addPageSize(el, s, apply, redisplay);
    } else {
      new Setting(el).setName('Max column width').setDesc('In pixels; 0 lets the columns fill the pane.')
        .addSlider((sl) => sl.setLimits(0, 1400, 20).setValue(s.screenMaxWidth).setDynamicTooltip()
          .onChange(async (v) => { s.screenMaxWidth = v; await apply(); }));
    }
    addCommon(el, s, apply);
    new Setting(el).setName('New page for each top-level heading')
      .addToggle((t) => t.setValue(s.headingNewPage).onChange(async (v) => { s.headingNewPage = v; await apply(); }));
    return;
  }

  addPageSize(el, s, apply, redisplay);
  new Setting(el).setName('Pages').setDesc('Auto shows an open book (two pages) when the window is wide enough.')
    .addDropdown((d) => d.addOptions({ auto: 'Auto', single: 'One page', double: 'Two-page spread' })
      .setValue(s.pageMode).onChange(async (v) => { s.pageMode = v; await apply(); }));
  new Setting(el).setName('Paper')
    .addDropdown((d) => d.addOptions(PAPERS).setValue(s.paper).onChange(async (v) => { s.paper = v; await apply(); }));
  new Setting(el).setName('Paper colour')
    .addDropdown((d) => d.addOptions(TINTS).setValue(s.tint).onChange(async (v) => { s.tint = v; await apply(); }));
  new Setting(el).setName('Font')
    .addDropdown((d) => {
      for (const [k, v] of Object.entries(FONTS)) d.addOption(k, v.label);
      d.setValue(s.fontFamily).onChange(async (v) => { s.fontFamily = v; await apply(); redisplay(); });
    });
  if (s.fontFamily === 'custom') {
    new Setting(el).setName('Custom font').setDesc('Any font family list that CSS accepts.')
      .addText((t) => t.setValue(s.fontFamilyCustom).onChange(async (v) => { s.fontFamilyCustom = v; await apply(); }));
  }
  new Setting(el).setName('Font size').setDesc('In pixels on an unscaled page.')
    .addSlider((sl) => sl.setLimits(10, 28, 1).setValue(s.fontSize).setDynamicTooltip()
      .onChange(async (v) => { s.fontSize = v; await apply(); }));
  addCommon(el, s, apply);
  new Setting(el).setName('Page numbers')
    .addToggle((t) => t.setValue(s.pageNumbers).onChange(async (v) => { s.pageNumbers = v; await apply(); }));
  new Setting(el).setName('New page for each top-level heading').setDesc('Every top-level heading starts on a fresh page: one entry per page.')
    .addToggle((t) => t.setValue(s.headingNewPage).onChange(async (v) => { s.headingNewPage = v; await apply(); }));
}

export class AppearanceModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.titleEl.setText('Journal appearance');
    this.display();
  }

  display() {
    this.contentEl.empty();
    addAppearanceSettings(this.contentEl, this.plugin, () => this.display());
  }

  onClose() { this.contentEl.empty(); }
}

export class JournalSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const el = this.containerEl;
    const s = this.plugin.config;
    const save = () => this.plugin.saveSettings();
    el.empty();
    new Setting(el).setName('Journal note').setDesc('The note that the ribbon button opens. It is created if it does not exist.')
      .addText((t) => t.setPlaceholder('Journal.md').setValue(s.journalFile).onChange(async (v) => { s.journalFile = v.trim(); await save(); }));
    new Setting(el).setName('Open at').setDesc('Where the caret goes when a note opens as a journal.')
      .addDropdown((d) => d.addOptions({ end: 'The end, ready for a new entry', last: 'Where I left off' })
        .setValue(s.openAt).onChange(async (v) => { s.openAt = v; await save(); }));
    new Setting(el).setName('Open in')
      .addDropdown((d) => d.addOptions({ tab: 'New tab', current: 'Current tab', split: 'Split' })
        .setValue(s.openIn).onChange(async (v) => { s.openIn = v; await save(); }));
    new Setting(el).setName('Date heading format').setDesc('Format of the date that the insert date heading command adds.')
      .addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.dateFormat).setValue(s.dateFormat)
        .onChange(async (v) => { s.dateFormat = v || DEFAULT_SETTINGS.dateFormat; await save(); }));
    new Setting(el).setName('Spellcheck')
      .addToggle((t) => t.setValue(s.spellcheck).onChange(async (v) => { s.spellcheck = v; await save(); this.plugin.refreshViews(); }));
    new Setting(el).setName('Page-turn animation')
      .addToggle((t) => t.setValue(s.animate).onChange(async (v) => { s.animate = v; await save(); this.plugin.refreshViews(); }));
    new Setting(el).setName('Page').setHeading();
    addAppearanceSettings(el, this.plugin, () => this.display());
  }
}
