import { MarkdownView, Notice, Plugin, TFile, TFolder, loadPrism, moment, normalizePath, type WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, PAGEBREAK_LINE, VIEW_TYPE_JOURNAL, type JournalSettings } from './constants';
import type { PrismLike } from './markdown';
import { JournalView } from './view';
import { AppearanceModal, JournalSettingTab } from './settings';

export default class MdJournalPlugin extends Plugin {
  // Kept off Plugin.settings, which only exists from Obsidian 1.13.
  config: JournalSettings = { ...DEFAULT_SETTINGS, positions: {} };
  prism: PrismLike | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_JOURNAL, (leaf) => new JournalView(leaf, this));
    void this.loadHighlighter();
    this.addRibbonIcon('book-open', 'Open journal', () => { void this.openJournal(); });

    this.addCommand({ id: 'open-journal', name: 'Open journal', callback: () => { void this.openJournal(); } });
    this.addCommand({
      id: 'open-current-as-journal',
      name: 'Open current note as journal',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) return false;
        if (!checking) void this.openFile(file);
        return true;
      },
    });
    this.addCommand({
      id: 'toggle-journal-view',
      name: 'Toggle between journal and editor',
      checkCallback: (checking) => {
        const ws = this.app.workspace;
        const journal = ws.getActiveViewOfType(JournalView);
        const view = journal ?? ws.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) void this.switchLeaf(view.leaf, journal ? 'markdown' : VIEW_TYPE_JOURNAL);
        return true;
      },
    });
    this.addJournalCommand('insert-date-heading', 'Insert date heading', (editor) => {
      editor.insertBlock('## ' + moment().format(this.config.dateFormat || DEFAULT_SETTINGS.dateFormat));
    });
    this.addJournalCommand('insert-page-break', 'Insert page break', (editor) => editor.insertBlock(PAGEBREAK_LINE));
    this.addJournalCommand('next-page', 'Next page', (editor) => editor.flip(1));
    this.addJournalCommand('previous-page', 'Previous page', (editor) => editor.flip(-1));
    this.addCommand({ id: 'appearance', name: 'Journal appearance', callback: () => new AppearanceModal(this.app, this).open() });
    this.addCommand({ id: 'toggle-layout', name: 'Switch between theme view and journal pages', callback: () => { void this.toggleLayout(); } });
    this.addCommand({
      id: 'toggle-fixed-page',
      name: 'Toggle fixed page in the theme view',
      callback: () => { void this.toggleFixedPage(); },
    });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem((item) => item.setTitle('Open as journal').setIcon('book-open').onClick(() => { void this.openFile(file); }));
    }));
    this.addSettingTab(new JournalSettingTab(this.app, this));
  }

  private addJournalCommand(id: string, name: string, run: (editor: NonNullable<JournalView['editor']>) => void): void {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const editor = this.app.workspace.getActiveViewOfType(JournalView)?.editor;
        if (!editor) return false;
        if (!checking) run(editor);
        return true;
      },
    });
  }

  /* Obsidian's own Prism, so code blocks look like they do in reading view. */
  private async loadHighlighter(): Promise<void> {
    try {
      this.prism = (await loadPrism()) as PrismLike;
      this.refreshViews(true);
    } catch {
      // no highlighting; code still shows as plain monospace
    }
  }

  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<JournalSettings>;
    this.config = { ...DEFAULT_SETTINGS, ...data };
    if (typeof this.config.positions !== 'object' || this.config.positions === null) this.config.positions = {};
  }

  async saveSettings(): Promise<void> { await this.saveData(this.config); }

  refreshViews(repaint = false): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_JOURNAL)) {
      const view = leaf.view;
      if (!(view instanceof JournalView) || !view.editor) continue;
      view.editor.configure(this.config);
      if (repaint) view.editor.repaint();
    }
  }

  async toggleLayout(): Promise<void> {
    this.config.layout = this.config.layout === 'screen' ? 'journal' : 'screen';
    await this.saveSettings();
    this.refreshViews();
  }

  private async toggleFixedPage(): Promise<void> {
    this.config.fixedPage = !this.config.fixedPage;
    await this.saveSettings();
    this.refreshViews();
    new Notice(this.config.fixedPage ? 'Fixed page: every page keeps the same text when the window is resized.' : 'Pages now fill the window.');
  }

  async openFile(file: TFile): Promise<void> {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE_JOURNAL).find((l) => l.view instanceof JournalView && l.view.file === file);
    if (existing) { ws.setActiveLeaf(existing, { focus: true }); return; }
    const where = this.config.openIn;
    const leaf = where === 'current' ? ws.getLeaf(false) : where === 'split' ? ws.getLeaf('split') : ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_JOURNAL, state: { file: file.path }, active: true });
    ws.setActiveLeaf(leaf, { focus: true });
  }

  async switchLeaf(leaf: WorkspaceLeaf, type: string): Promise<void> {
    const view = leaf.view;
    const file = view instanceof JournalView || view instanceof MarkdownView ? view.file : null;
    if (!file) return;
    if (view instanceof JournalView) await view.flush();
    const state = type === 'markdown' ? { file: file.path, mode: 'source' } : { file: file.path };
    await leaf.setViewState({ type, state, active: true });
  }

  async openJournal(): Promise<void> {
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
