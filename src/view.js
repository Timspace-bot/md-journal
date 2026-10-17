import { FileView, Notice, Platform, moment } from 'obsidian';
import { VIEW_TYPE_JOURNAL } from './constants.js';
import { splitFrontmatter, prismLines } from './markdown.js';
import { PagedEditor } from './editor.js';
import { AppearanceModal } from './settings.js';

export class JournalView extends FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.editor = null;
    this.front = '';
    this.eol = '\n';
    this.lastSaved = null;
    this.dirty = false;
    this.saveTimer = null;
    this.posTimer = null;
  }

  getViewType() { return VIEW_TYPE_JOURNAL; }
  getIcon() { return 'book-open'; }
  canAcceptExtension(ext) { return ext === 'md'; }

  ensureEditor() {
    if (this.editor) return this.editor;
    this.contentEl.empty();
    this.contentEl.addClass('mj-view-content');
    const host = {
      platform: { isPhone: Platform.isPhone, isMacOS: Platform.isMacOS },
      onChange: () => this.scheduleSave(),
      onCaret: () => this.schedulePosition(),
      resolveImage: (link) => this.resolveImage(link),
      openLink: (href, newLeaf) => this.openLink(href, newLeaf),
      saveAttachment: (file) => this.saveAttachment(file),
      highlight: (code, lang) => prismLines(this.plugin.prism, code, lang),
    };
    this.editor = new PagedEditor(this.contentEl, host, this.plugin.settings);
    return this.editor;
  }

  async onOpen() {
    this.ensureEditor();
    this.addAction('pencil', 'Edit as Markdown', () => { void this.plugin.switchLeaf(this.leaf, 'markdown'); });
    this.addAction('type', 'Journal appearance', () => new AppearanceModal(this.app, this.plugin).open());
    this.addAction('monitor', 'Switch between theme view and journal pages', () => { void this.plugin.toggleLayout(); });
    this.registerEvent(this.app.vault.on('modify', (f) => { if (f === this.file) void this.onExternalModify(); }));
    this.registerEvent(this.app.vault.on('delete', (f) => { if (f === this.file) this.dirty = false; }));
    this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
      if (f !== this.file) return;
      const pos = this.plugin.settings.positions;
      if (pos[oldPath]) { pos[f.path] = pos[oldPath]; delete pos[oldPath]; void this.plugin.saveSettings(); }
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf === this.leaf && this.editor && this.file) this.editor.focus();
    }));
  }

  async onClose() {
    await this.flush();
    this.savePosition();
    if (this.editor) this.editor.destroy();
    this.editor = null;
  }

  async onLoadFile(file) {
    const editor = this.ensureEditor();
    const text = await this.app.vault.read(file);
    if (this.file !== file || this.editor !== editor) return;
    this.applyText(text, true);
    if (this.app.workspace.getActiveViewOfType(JournalView) === this) editor.focus();
  }

  async onUnloadFile(file) {
    await this.flush(file);
    this.savePosition(file);
  }

  applyText(text, initial) {
    this.eol = text.includes('\r\n') ? '\r\n' : '\n';
    const { front, body } = splitFrontmatter(text);
    this.front = front;
    this.lastSaved = text;
    let caret = null;
    if (initial) {
      const saved = this.plugin.settings.positions[this.file.path];
      caret = this.plugin.settings.openAt === 'last' && saved ? saved : { line: Infinity, ch: Infinity };
    }
    this.editor.setText(body, { resetHistory: initial, caret });
    this.editor.setStatus('');
  }

  composeText() {
    let body = this.editor.getText();
    if (this.eol !== '\n') body = body.replace(/\n/g, this.eol);
    let front = this.front;
    if (front && !/\n$/.test(front) && body) front += this.eol;
    return front + body;
  }

  scheduleSave() {
    this.dirty = true;
    this.editor.setStatus('Editing…');
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { void this.flush(); }, Math.max(100, this.plugin.settings.saveDelay || 700));
  }

  async flush(file = this.file) {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.dirty || !file || !this.editor) return;
    this.dirty = false;
    const data = this.composeText();
    if (data === this.lastSaved) { this.editor.setStatus('Saved'); return; }
    this.lastSaved = data;
    try {
      await this.app.vault.process(file, () => data);
      if (this.editor && !this.dirty) this.editor.setStatus('Saved');
    } catch (err) {
      this.dirty = true;
      new Notice('Could not save ' + file.path + ': ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async onExternalModify() {
    const file = this.file;
    const text = await this.app.vault.read(file);
    if (text === this.lastSaved || !this.editor || file !== this.file) return;
    if (this.dirty) {
      // Edited here and elsewhere at once: keep what is being typed here, but
      // take the other side's properties (frontmatter), which this view never edits.
      this.front = splitFrontmatter(text).front;
      return;
    }
    this.applyText(text, false);
  }

  schedulePosition() {
    window.clearTimeout(this.posTimer);
    this.posTimer = window.setTimeout(() => this.savePosition(), 2000);
  }

  savePosition(file = this.file) {
    window.clearTimeout(this.posTimer);
    if (!file || !this.editor || !this.editor.sel) return;
    const h = this.editor.sel.head;
    const prev = this.plugin.settings.positions[file.path];
    if (prev && prev.line === h.line && prev.ch === h.ch) return;
    this.plugin.settings.positions[file.path] = { line: h.line, ch: h.ch };
    void this.plugin.saveSettings();
  }

  resolveImage(link) {
    if (/^https?:/i.test(link)) return link;
    let path = link;
    try { path = decodeURIComponent(link); } catch { /* keep as written */ }
    const f = this.app.metadataCache.getFirstLinkpathDest(path, this.file ? this.file.path : '');
    return f ? this.app.vault.getResourcePath(f) : null;
  }

  openLink(href, newLeaf) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { window.open(href); return; }
    void this.app.workspace.openLinkText(href, this.file ? this.file.path : '', newLeaf ? 'tab' : false);
  }

  async saveAttachment(file) {
    const buf = await file.arrayBuffer();
    const fromName = file.name && file.name.includes('.') ? file.name.split('.').pop() : '';
    const ext = (fromName || file.type.split('/')[1] || 'png').toLowerCase();
    const base = file.name && file.name !== 'image.png'
      ? file.name.replace(/\.[^.]+$/, '')
      : 'Pasted image ' + moment().format('YYYYMMDDHHmmss');
    const source = this.file ? this.file.path : '';
    const path = await this.app.fileManager.getAvailablePathForAttachment(base + '.' + ext, source);
    const created = await this.app.vault.createBinary(path, buf);
    const link = this.app.fileManager.generateMarkdownLink(created, source);
    return link.startsWith('!') ? link : '!' + link;
  }
}
