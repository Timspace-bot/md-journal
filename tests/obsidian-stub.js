// Just enough of the `obsidian` module for the browser harness.
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (c) { this.classList.add(c); };

export const Platform = { isPhone: false, isMacOS: false };
export const moment = () => ({ format: () => 'Saturday, 17 October 2026' });
export class Notice { constructor(msg) { console.warn('Notice:', msg); } }
export class Modal { constructor(app) { this.app = app; } open() {} }
export class PluginSettingTab { constructor(app) { this.app = app; } }
export class Setting {}

export class FileView {
  constructor(leaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.file = null;
    this.contentEl = document.createElement('div');
  }
  addAction() {}
  registerEvent() {}
  // Obsidian calls these when the view's file changes
  async setFile(file) {
    if (this.file) await this.onUnloadFile(this.file);
    this.file = file;
    await this.onLoadFile(file);
  }
}
