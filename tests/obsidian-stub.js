// Just enough of the `obsidian` module (and its DOM helpers) for the browser harness.
const proto = HTMLElement.prototype;
function createEl(tag, o, cb) {
  const el = document.createElement(tag);
  const info = typeof o === 'string' ? { cls: o } : o || {};
  if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
  if (info.text) el.textContent = info.text;
  for (const [k, v] of Object.entries(info.attr || {})) if (v != null) el.setAttribute(k, String(v));
  this.appendChild(el);
  if (cb) cb(el);
  return el;
}
for (const target of [proto, DocumentFragment.prototype]) {
  target.createEl = createEl;
  target.createDiv = function (o, cb) { return this.createEl('div', o, cb); };
  target.createSpan = function (o, cb) { return this.createEl('span', o, cb); };
}
Node.prototype.appendText = function (t) { this.appendChild(document.createTextNode(t)); };
proto.empty = function () { this.replaceChildren(); };
proto.addClass = function (...c) { this.classList.add(...c); };
proto.removeClass = function (...c) { this.classList.remove(...c); };
proto.toggleClass = function (c, v) { this.classList.toggle(c, v); };
proto.setCssProps = function (props) { for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v); };

export const Platform = { isPhone: false, isMacOS: false };
export const moment = () => ({ format: () => 'Saturday, 17 October 2026' });
export const requireApiVersion = () => false;
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
