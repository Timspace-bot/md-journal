import { MarkdownView, Notice, Plugin, TFile, TFolder, loadPrism, moment, normalizePath } from 'obsidian';
import { DEFAULT_SETTINGS, PAGEBREAK_LINE, VIEW_TYPE_JOURNAL } from './constants.js';
import { JournalView } from './view.js';
import { AppearanceModal, JournalSettingTab } from './settings.js';

export default class MdJournalPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_JOURNAL, (leaf) => new JournalView(leaf, this));
    void this.loadHighlighter();
    this.addRibbonIcon('book-open', 'Open journal', () => { void this.openJournal(); });

    this.addCommand({ id: 'open-journal', name: 'Open journal', callback: () => { void this.openJournal(); } });
    this.addCommand({
      id: 'open-current-as-journal',
      name: 'Open current note as journal',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) return false;
        if (!checking) void this.openFile(view.file);
        return true;
      },
    });
    this.addCommand({
      id: 'toggle-journal-view',
      name: 'Toggle between journal and editor',
      checkCallback: (checking) => {
        const ws = this.app.workspace;
        const view = ws.getActiveViewOfType(JournalView) || ws.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) return false;
        if (!checking) void this.switchLeaf(view.leaf, view instanceof JournalView ? 'markdown' : VIEW_TYPE_JOURNAL);
        return true;
      },
    });
    this.addJournalCommand('insert-date-heading', 'Insert date heading', (v) => {
      v.editor.insertBlock('## ' + moment().format(this.config.dateFormat || DEFAULT_SETTINGS.dateFormat));
    });
    this.addJournalCommand('insert-page-break', 'Insert page break', (v) => v.editor.insertBlock(PAGEBREAK_LINE));
    this.addJournalCommand('next-page', 'Next page', (v) => v.editor.flip(1));
    this.addJournalCommand('previous-page', 'Previous page', (v) => v.editor.flip(-1));
    this.addCommand({ id: 'appearance', name: 'Journal appearance', callback: () => new AppearanceModal(this.app, this).open() });
    this.addCommand({ id: 'toggle-layout', name: 'Switch between theme view and journal pages', callback: () => { void this.toggleLayout(); } });
    this.addCommand({
      id: 'toggle-fixed-page',
      name: 'Toggle fixed page in the theme view',
      callback: async () => {
        this.config.fixedPage = !this.config.fixedPage;
        await this.saveSettings();
        this.refreshViews();
        new Notice(this.config.fixedPage ? 'Fixed page: every page keeps the same text when the window is resized.' : 'Pages now fill the window.');
      },
    });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem((item) => item.setTitle('Open as journal').setIcon('book-open').onClick(() => { void this.openFile(file); }));
    }));
    this.addSettingTab(new JournalSettingTab(this.app, this));
  }

  addJournalCommand(id, name, run) {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const v = this.app.workspace.getActiveViewOfType(JournalView);
        if (!v || !v.editor) return false;
        if (!checking) run(v);
        return true;
      },
    });
  }

  /* Obsidian's own Prism, so code blocks look like they do in reading view. */
  async loadHighlighter() {
    try {
      this.prism = await loadPrism();
      this.refreshViews(true);
    } catch {
      // no highlighting; code still shows as plain monospace
    }
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.config = { ...DEFAULT_SETTINGS, ...data };
    if (!this.config.positions || typeof this.config.positions !== 'object') this.config.positions = {};
  }

  async saveSettings() { await this.saveData(this.config); }

  refreshViews(repaint) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_JOURNAL)) {
      const view = leaf.view;
      if (!(view instanceof JournalView) || !view.editor) continue;
      view.editor.configure(this.config);
      if (repaint) view.editor.repaint();
    }
  }

  async toggleLayout() {
    this.config.layout = this.config.layout === 'screen' ? 'journal' : 'screen';
    await this.saveSettings();
    this.refreshViews();
  }

  async openFile(file) {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE_JOURNAL).find((l) => l.view instanceof JournalView && l.view.file === file);
    if (existing) { ws.setActiveLeaf(existing, { focus: true }); return; }
    const where = this.config.openIn;
    const leaf = where === 'current' ? ws.getLeaf(false) : where === 'split' ? ws.getLeaf('split') : ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_JOURNAL, state: { file: file.path }, active: true });
    ws.setActiveLeaf(leaf, { focus: true });
  }

  async switchLeaf(leaf, type) {
    const view = leaf.view;
    const file = view && view.file;
    if (!file) return;
    if (view instanceof JournalView) await view.flush();
    const state = type === 'markdown' ? { file: file.path, mode: 'source' } : { file: file.path };
    await leaf.setViewState({ type, state, active: true });
  }

  async openJournal() {
    let path = normalizePath(this.config.journalFile || 'Journal.md');
    if (!/\.md$/i.test(path)) path += '.md';
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (dir && !(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
        try { await this.app.vault.createFolder(dir); } catch { /* created meanwhile */ }
      }
      file = await this.app.vault.create(path, '');
    }
    if (file instanceof TFile) await this.openFile(file);
    else new Notice(path + ' is not a note.');
  }
}
