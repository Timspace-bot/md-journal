import { FileView, Notice, Platform, moment, type TFile, type WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_JOURNAL, type Pos } from './constants';
import { splitFrontmatter, prismLines } from './markdown';
import { PagedEditor, type EditorHost } from './editor';
import { AppearanceModal } from './settings';
import type MdJournalPlugin from './main';

export class JournalView extends FileView {
  plugin: MdJournalPlugin;
  editor: PagedEditor | null = null;
  private front = '';
  private eol = '\n';
  private lastSaved: string | null = null;
  private dirty = false;
  private saveTimer = 0;
  private posTimer = 0;

  constructor(leaf: WorkspaceLeaf, plugin: MdJournalPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_JOURNAL; }
  getIcon(): string { return 'book-open'; }
  canAcceptExtension(ext: string): boolean { return ext === 'md'; }

  private ensureEditor(): PagedEditor {
    if (this.editor) return this.editor;
    this.contentEl.empty();
    this.contentEl.addClass('mj-view-content');
    const host: EditorHost = {
      platform: { isPhone: Platform.isPhone, isMacOS: Platform.isMacOS },
      onChange: () => this.scheduleSave(),
      onCaret: () => this.schedulePosition(),
      resolveImage: (link) => this.resolveImage(link),
      openLink: (href, newLeaf) => this.openLink(href, newLeaf),
      saveAttachment: (file) => this.saveAttachment(file),
      highlight: (code, lang) => prismLines(this.plugin.prism, code, lang),
    };
    this.editor = new PagedEditor(this.contentEl, host, this.plugin.config);
    return this.editor;
  }

  onOpen(): Promise<void> {
    this.ensureEditor();
    this.addAction('pencil', 'Edit as Markdown', () => { void this.plugin.switchLeaf(this.leaf, 'markdown'); });
    this.addAction('type', 'Journal appearance', () => new AppearanceModal(this.app, this.plugin).open());
    this.addAction('monitor', 'Switch between theme view and journal pages', () => { void this.plugin.toggleLayout(); });
    this.registerEvent(this.app.vault.on('modify', (f) => { if (f === this.file) void this.onExternalModify(); }));
    this.registerEvent(this.app.vault.on('delete', (f) => { if (f === this.file) this.dirty = false; }));
    this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
      if (f !== this.file) return;
      const pos = this.plugin.config.positions;
      const saved = pos[oldPath];
      if (saved) {
        pos[f.path] = saved;
        delete pos[oldPath];
        void this.plugin.saveSettings();
      }
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf === this.leaf && this.editor && this.file) this.editor.focus();
    }));
    return Promise.resolve();
  }

  async onClose(): Promise<void> {
    await this.flush();
    this.savePosition();
    this.editor?.destroy();
    this.editor = null;
  }

  async onLoadFile(file: TFile): Promise<void> {
    const editor = this.ensureEditor();
    const text = await this.app.vault.read(file);
    if (this.file !== file || this.editor !== editor) return;
    this.applyText(file, editor, text, true);
    if (this.app.workspace.getActiveViewOfType(JournalView) === this) editor.focus();
  }

  async onUnloadFile(file: TFile): Promise<void> {
    await this.flush(file);
    this.savePosition(file);
  }

  private applyText(file: TFile, editor: PagedEditor, text: string, initial: boolean): void {
    this.eol = text.includes('\r\n') ? '\r\n' : '\n';
    const { front, body } = splitFrontmatter(text);
    this.front = front;
    this.lastSaved = text;
    let caret: Pos | null = null;
    if (initial) {
      const saved = this.plugin.config.positions[file.path];
      caret = this.plugin.config.openAt === 'last' && saved ? saved : { line: Infinity, ch: Infinity };
    }
    editor.setText(body, { resetHistory: initial, caret });
    editor.setStatus('');
  }

  private composeText(editor: PagedEditor): string {
    let body = editor.getText();
    if (this.eol !== '\n') body = body.replace(/\n/g, this.eol);
    let front = this.front;
    if (front && !front.endsWith('\n') && body) front += this.eol;
    return front + body;
  }

  private scheduleSave(): void {
    this.dirty = true;
    this.editor?.setStatus('Editing…');
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { void this.flush(); }, Math.max(100, this.plugin.config.saveDelay || 700));
  }

  async flush(file: TFile | null = this.file): Promise<void> {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    const editor = this.editor;
    if (!this.dirty || !file || !editor) return;
    this.dirty = false;
    const data = this.composeText(editor);
    if (data === this.lastSaved) { editor.setStatus('Saved'); return; }
    this.lastSaved = data;
    try {
      await this.app.vault.process(file, () => data);
      if (this.editor && !this.dirty) this.editor.setStatus('Saved');
    } catch (err) {
      this.dirty = true;
      new Notice('Could not save ' + file.path + ': ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async onExternalModify(): Promise<void> {
    const file = this.file;
    if (!file) return;
    const text = await this.app.vault.read(file);
    const editor = this.editor;
    if (text === this.lastSaved || !editor || file !== this.file) return;
    if (this.dirty) {
      // Edited here and elsewhere at once: keep what is being typed here, but
      // take the other side's properties (frontmatter), which this view never edits.
      this.front = splitFrontmatter(text).front;
      return;
    }
    this.applyText(file, editor, text, false);
  }

  private schedulePosition(): void {
    window.clearTimeout(this.posTimer);
    this.posTimer = window.setTimeout(() => this.savePosition(), 2000);
  }

  private savePosition(file: TFile | null = this.file): void {
    window.clearTimeout(this.posTimer);
    const head = this.editor?.sel?.head;
    if (!file || !head) return;
    const prev = this.plugin.config.positions[file.path];
    if (prev && prev.line === head.line && prev.ch === head.ch) return;
    this.plugin.config.positions[file.path] = { line: head.line, ch: head.ch };
    void this.plugin.saveSettings();
  }

  private resolveImage(link: string): string | null {
    if (/^https?:/i.test(link)) return link;
    let path = link;
    try { path = decodeURIComponent(link); } catch { /* keep as written */ }
    const f = this.app.metadataCache.getFirstLinkpathDest(path, this.file?.path ?? '');
    return f ? this.app.vault.getResourcePath(f) : null;
  }

  private openLink(href: string, newLeaf: boolean): void {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { window.open(href); return; }
    void this.app.workspace.openLinkText(href, this.file?.path ?? '', newLeaf ? 'tab' : false);
  }

  private async saveAttachment(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const fromName = file.name.includes('.') ? file.name.split('.').pop() : '';
    const ext = (fromName || file.type.split('/')[1] || 'png').toLowerCase();
    const base = file.name && file.name !== 'image.png'
      ? file.name.replace(/\.[^.]+$/, '')
      : 'Pasted image ' + moment().format('YYYYMMDDHHmmss');
    const source = this.file?.path ?? '';
    const path = await this.app.fileManager.getAvailablePathForAttachment(base + '.' + ext, source);
    const created = await this.app.vault.createBinary(path, buf);
    const link = this.app.fileManager.generateMarkdownLink(created, source);
    return link.startsWith('!') ? link : '!' + link;
  }
}
