/*
 * PagedEditor — the page you write on. Pure DOM, no Obsidian API, so it can run
 * in a plain browser for tests.
 *
 * The Markdown source (an array of lines) is the model; the DOM is a view of it.
 * A contenteditable surface is laid out in CSS columns at a fixed height, one
 * column per page, so the browser decides where a page ends and text that no
 * longer fits moves to the next page by itself. Edits are intercepted
 * (beforeinput, clipboard, keys), applied to the model, and only the changed
 * lines are repainted. IME composition cannot be intercepted, so the browser
 * types it and the changed lines are read back.
 */
import { FONTS, PAPERS, TINTS } from './constants.js';
import { pageGeometry, screenGeometry } from './geometry.js';
import {
  computeKinds, renderLine, lineClass, nodesKey, continuationPrefix,
  prevBoundary, nextBoundary, prevWordStart, nextWordEnd, countWords,
} from './markdown.js';
import { appendNodes, domToLines } from './dom.js';

const cmpPos = (a, b) => (a.line - b.line) || (a.ch - b.ch);
const samePos = (a, b) => cmpPos(a, b) === 0;
const ordered = (a, b) => (cmpPos(a, b) <= 0 ? [a, b] : [b, a]);

export class PagedEditor {
  constructor(parent, host, settings) {
    this.host = host || {};
    this.doc = parent.ownerDocument;
    this.win = this.doc.defaultView || window;
    this.settings = settings;
    this.lines = [''];
    this.lineEls = [];
    this.rendered = [];
    this.kinds = [];
    this.activeEls = new Set();
    this.sel = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lastUndoKind = null;
    this.lastUndoTime = 0;
    this.composing = false;
    this.spread = 0;
    this.n = 1;
    this.scale = 1;
    this.totalPages = 1;
    this.paperEls = [];
    this.laidOut = false;
    this.status = '';
    this.wordTimer = null;
    this.build(parent);
    this.configure(settings);
    this.syncDOM();
  }

  /* ---------- DOM ---------- */

  build(parent) {
    const el = (tag, cls, p) => { const e = this.doc.createElement(tag); if (cls) e.className = cls; if (p) p.appendChild(e); return e; };
    this.root = el('div', 'mj-root', parent);
    this.viewport = el('div', 'mj-viewport', this.root);
    this.book = el('div', 'mj-book', this.viewport);
    this.stage = el('div', 'mj-stage', this.book);
    this.track = el('div', 'mj-track', this.stage);
    this.papers = el('div', 'mj-papers', this.track);
    this.content = el('div', 'mj-content', this.track);
    this.content.contentEditable = 'true';
    this.content.setAttribute('role', 'textbox');
    this.content.setAttribute('aria-multiline', 'true');
    this.content.setAttribute('autocapitalize', 'sentences');
    this.spine = el('div', 'mj-spine', this.stage);

    this.bar = el('div', 'mj-bar', this.root);
    this.prevBtn = el('button', 'mj-nav clickable-icon', this.bar);
    this.prevBtn.textContent = '‹';
    this.prevBtn.setAttribute('aria-label', 'Previous page');
    this.info = el('span', 'mj-info', this.bar);
    this.nextBtn = el('button', 'mj-nav clickable-icon', this.bar);
    this.nextBtn.textContent = '›';
    this.nextBtn.setAttribute('aria-label', 'Next page');
    this.meta = el('span', 'mj-meta', this.bar);

    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      (this._listeners || (this._listeners = [])).push([target, type, fn, opts]);
    };
    const c = this.content;
    on(c, 'beforeinput', (e) => this.onBeforeInput(e));
    on(c, 'input', (e) => this.onInput(e));
    on(c, 'keydown', (e) => this.onKeyDown(e));
    on(c, 'compositionstart', () => this.onCompositionStart());
    on(c, 'compositionend', () => this.onCompositionEnd());
    on(c, 'copy', (e) => this.onCopy(e, false));
    on(c, 'cut', (e) => this.onCopy(e, true));
    on(c, 'paste', (e) => this.onPaste(e));
    on(c, 'drop', (e) => this.onDrop(e));
    on(c, 'dragstart', (e) => e.preventDefault());
    on(c, 'mousedown', (e) => this.onContentMouseDown(e));
    on(c, 'load', (e) => { if (e.target && e.target.nodeName === 'IMG') this.fitImage(e.target); }, true);
    on(this.papers, 'mousedown', (e) => this.onPaperMouseDown(e));
    on(this.doc, 'selectionchange', () => this.onSelectionChange());
    on(this.viewport, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(this.viewport, 'touchstart', (e) => this.onTouchStart(e), { passive: true });
    on(this.viewport, 'touchend', (e) => this.onTouchEnd(e), { passive: true });
    on(this.prevBtn, 'click', () => this.flip(-1));
    on(this.nextBtn, 'click', () => this.flip(1));
    on(this.bar, 'mousedown', (e) => e.preventDefault()); // keep the caret in the page
    if (this.win.ResizeObserver) {
      this.ro = new this.win.ResizeObserver(() => this.layout());
      this.ro.observe(this.viewport);
    }
    if (this.doc.fonts && this.doc.fonts.ready) this.doc.fonts.ready.then(() => { if (this.root.isConnected) this.layout(); }).catch(() => {});
  }

  destroy() {
    for (const [t, type, fn, opts] of this._listeners || []) t.removeEventListener(type, fn, opts);
    this._listeners = [];
    if (this.ro) this.ro.disconnect();
    this.win.clearTimeout(this.wordTimer);
    this.root.remove();
  }

  configure(settings) {
    this.settings = settings;
    this.screen = settings.layout === 'screen';
    // the Obsidian view always wears the theme; paper and type are journal settings
    const font = this.screen ? FONTS.theme.css : settings.fontFamily === 'custom'
      ? (settings.fontFamilyCustom || FONTS.serif.css)
      : (FONTS[settings.fontFamily] || FONTS.serif).css;
    const tint = this.screen ? 'theme' : settings.tint;
    this.root.style.setProperty('--mj-font', font);
    const cls = this.root.classList;
    cls.toggle('mj-screen', this.screen);
    for (const t of Object.keys(TINTS)) cls.toggle('mj-tint-' + t, tint === t);
    for (const p of Object.keys(PAPERS)) cls.toggle('mj-paper-' + p, !this.screen && settings.paper === p);
    cls.toggle('mj-hide-syntax', !!settings.hideSyntax);
    cls.toggle('mj-no-pnum', this.screen || !settings.pageNumbers);
    cls.toggle('mj-h1-newpage', !!settings.headingNewPage);
    this.content.spellcheck = settings.spellcheck !== false;
    this.geo = null;
    this.laidOut = false;
    // A fixed page never depends on the window: same text per page, just scaled.
    this.fixed = !this.screen || !!settings.fixedPage;
    cls.toggle('mj-fixed', this.fixed);
    if (!this.screen) this.applyGeometry(pageGeometry(settings));
    else if (this.fixed) this.applyGeometry(pageGeometry({ ...settings, fontSize: this.themeFontSize() }));
    this.layout();
  }

  themeFontSize() {
    return parseFloat(getComputedStyle(this.root).getPropertyValue('--font-text-size')) || 16;
  }

  applyGeometry(g) {
    this.geo = g;
    const st = this.root.style;
    st.setProperty('--mj-page-w', g.W + 'px');
    st.setProperty('--mj-page-h', g.H + 'px');
    st.setProperty('--mj-margin', g.m + 'px');
    st.setProperty('--mj-top', g.top + 'px');
    st.setProperty('--mj-bottom', g.bottom + 'px');
    st.setProperty('--mj-col-w', g.colW + 'px');
    st.setProperty('--mj-content-h', g.contentH + 'px');
    st.setProperty('--mj-fs', g.fs + 'px');
    st.setProperty('--mj-lh', g.lh + 'px');
    this.content.querySelectorAll('img.mj-img').forEach((img) => this.fitImage(img, true));
  }

  /* Journal pages: scale the fixed-size page to the window, one page or a spread.
     Obsidian view: the pane is the page, so the columns are re-cut to fit it. */
  layout() {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    if (!vw || !vh) return;
    const phone = !!(this.host.platform && this.host.platform.isPhone);
    const firstPage = this.spread * this.n;
    let n;
    let scale;
    let reflowed = false;
    if (!this.fixed) {
      const g = screenGeometry(vw, vh, this.settings, this.themeFontSize(), phone);
      const old = this.geo;
      if (!old || old.W !== g.W || old.H !== g.H || old.colW !== g.colW || old.lh !== g.lh || old.fs !== g.fs) {
        this.applyGeometry(g);
        reflowed = !!old;
      }
      this.root.classList.toggle('mj-narrow', g.narrow);
      n = g.n;
      scale = 1;
    } else {
      const g = this.geo;
      this.root.classList.remove('mj-narrow');
      const pad = vw < 520 ? 8 : this.screen ? 52 : 28; // the theme view keeps room for its side buttons
      const aw = Math.max(50, vw - 2 * pad);
      const ah = Math.max(50, vh - 2 * pad);
      const single = Math.min(aw / g.W, ah / g.H);
      const double = Math.min(aw / (2 * g.W), ah / g.H);
      const mode = this.settings.pageMode;
      n = mode === 'single' ? 1 : mode === 'double' ? 2 : (double >= 0.8 * single && !phone ? 2 : 1);
      scale = Math.min(n === 2 ? double : single, 3);
    }
    const g = this.geo;
    this.n = n;
    this.scale = scale;
    this.root.classList.toggle('mj-double', n === 2);
    this.book.style.width = (n * g.W * scale) + 'px';
    this.book.style.height = (g.H * scale) + 'px';
    this.stage.style.width = (n * g.W) + 'px';
    this.stage.style.height = g.H + 'px';
    this.stage.style.transform = 'scale(' + scale + ')';
    this.content.style.width = (n * g.colW + (n - 1) * g.gap) + 'px';
    this.content.style.columnCount = String(n);
    this.spread = Math.floor(firstPage / n);
    this.laidOut = true;
    this.measure();
    // pages were re-cut (Obsidian view resized): stay with the caret, not the page number
    if (this._revealPending || reflowed) { this._revealPending = false; this.revealCaret(false); }
  }

  /* Repaint every line (e.g. once code highlighting becomes available). */
  repaint() {
    for (const el of this.lineEls) el._mjKey = null;
    this.syncDOM();
    if (this.sel && this.hasFocus()) this.setSelection(this.sel.anchor, this.sel.head);
    this.measure();
  }

  /* Fenced blocks with a language get Prism token spans (node lists, one per line). */
  highlightCode(lines, kinds) {
    const hl = this.host.highlight;
    if (!hl) return;
    const cache = this._hlCache || (this._hlCache = new Map());
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i];
      if (k.type !== 'fence' || !k.lang) continue;
      let j = i + 1;
      while (j < kinds.length && kinds[j].type === 'code') j++;
      if (j > i + 1) {
        const code = lines.slice(i + 1, j).join('\n');
        const ck = k.lang + '\u0000' + code;
        let hlLines = cache.get(ck);
        if (hlLines === undefined) {
          hlLines = hl(code, k.lang) || null;
          cache.set(ck, hlLines);
          if (cache.size > 64) cache.delete(cache.keys().next().value);
        }
        if (hlLines && hlLines.length === j - i - 1) {
          for (let x = i + 1; x < j; x++) {
            const nodes = hlLines[x - i - 1];
            kinds[x] = { type: 'code', key: 'code\u0001' + nodesKey(nodes), nodes };
          }
        }
      }
      i = j - 1;
    }
  }

  pageOfRect(r) {
    const cb = this.content.getBoundingClientRect();
    const x = ((r.left + r.right) / 2 - cb.left) / (this.scale || 1);
    return Math.max(0, Math.floor(x / (this.geo.colW + this.geo.gap)));
  }

  measure() {
    if (!this.laidOut) return;
    let pages = 1;
    const last = this.lineEls[this.lineEls.length - 1];
    if (last) {
      const rs = last.getClientRects();
      if (rs.length) pages = this.pageOfRect(rs[rs.length - 1]) + 1;
      if (this.kinds[this.kinds.length - 1] && this.kinds[this.kinds.length - 1].type === 'pagebreak') pages++;
    }
    this.totalPages = pages;
    this.renderPapers();
    const spreads = this.spreadCount();
    if (this.spread > spreads - 1) this.showSpread(spreads - 1, false);
    else this.showSpread(this.spread, false, true);
  }

  spreadCount() { return Math.max(1, Math.ceil(this.totalPages / this.n)); }

  renderPapers() {
    const g = this.geo;
    const count = this.spreadCount() * this.n;
    while (this.paperEls.length < count) {
      const p = this.doc.createElement('div');
      p.className = 'mj-paper';
      const rules = this.doc.createElement('div');
      rules.className = 'mj-rules';
      const num = this.doc.createElement('div');
      num.className = 'mj-pnum';
      p.append(rules, num);
      this.papers.appendChild(p);
      this.paperEls.push(p);
    }
    while (this.paperEls.length > count) this.paperEls.pop().remove();
    this.paperEls.forEach((p, i) => {
      p.style.left = (i * g.W) + 'px';
      p.className = 'mj-paper' + (this.n === 2 ? (i % 2 ? ' mj-paper-r' : ' mj-paper-l') : '');
      p.lastChild.textContent = String(i + 1);
    });
  }

  showSpread(s, animate, silent) {
    if (!this.geo) return;
    const spreads = this.spreadCount();
    s = Math.max(0, Math.min(s, spreads - 1));
    const changed = s !== this.spread || !this._shown;
    this.spread = s;
    this._shown = true;
    if (changed || !silent) {
      this.track.style.transition = animate && this.settings.animate ? 'transform 0.38s cubic-bezier(.25,.75,.25,1)' : 'none';
      this.track.style.transform = 'translate3d(' + (-s * this.n * this.geo.W) + 'px,0,0)';
    }
    this.updateBar();
  }

  flip(delta) {
    const before = this.spread;
    this.showSpread(this.spread + delta, true);
    if (this.spread === before) return;
    if (this.hasFocus()) {
      const pos = this.posAtPageStart(this.spread * this.n);
      if (pos) this.setSelection(pos, pos);
    }
  }

  updateBar() {
    const first = this.spread * this.n + 1;
    const total = this.spreadCount() * this.n;
    this.info.textContent = (this.n === 2 ? 'Pages ' + first + '–' + (first + 1) : 'Page ' + first) + ' of ' + total;
    this.prevBtn.disabled = this.spread <= 0;
    this.nextBtn.disabled = this.spread >= this.spreadCount() - 1;
  }

  setStatus(text) {
    this.status = text;
    this.renderMeta();
  }

  renderMeta() {
    const words = this.words == null ? '' : this.words.toLocaleString() + (this.words === 1 ? ' word' : ' words');
    this.meta.textContent = [words, this.status].filter(Boolean).join(' · ');
  }

  scheduleWordCount() {
    this.win.clearTimeout(this.wordTimer);
    this.wordTimer = this.win.setTimeout(() => { this.words = countWords(this.getText()); this.renderMeta(); }, 300);
  }

  /* ---------- model <-> DOM ---------- */

  getText() { return this.lines.join('\n'); }

  setText(text, opts = {}) {
    if (opts.resetHistory) { this.undoStack = []; this.redoStack = []; this.lastUndoKind = null; }
    else this.pushUndo('other');
    const old = this.sel;
    this.lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    this.syncDOM();
    const c = this.clampPos(opts.caret || (old && old.head) || this.endPos());
    this.sel = { anchor: c, head: c };
    this.updateActive(this.sel);
    if (this.hasFocus()) this.setSelection(c, c);
    this.measure();
    if (this.laidOut) this.revealCaret(false);
    else this._revealPending = true;
    this.scheduleWordCount();
  }

  endPos() { const l = this.lines.length - 1; return { line: l, ch: this.lines[l].length }; }

  clampPos(p) {
    const int = (v) => (Number.isFinite(v) ? Math.trunc(v) : v > 0 ? Number.MAX_SAFE_INTEGER : 0);
    const line = Math.max(0, Math.min(int(p.line), this.lines.length - 1));
    return { line, ch: Math.max(0, Math.min(int(p.ch), this.lines[line].length)) };
  }

  syncDOM() {
    const old = this.rendered;
    const neu = this.lines;
    let s = 0;
    const min = Math.min(old.length, neu.length);
    while (s < min && old[s] === neu[s]) s++;
    let eo = old.length;
    let en = neu.length;
    while (eo > s && en > s && old[eo - 1] === neu[en - 1]) { eo--; en--; }
    if (eo > s || en > s) {
      const ref = this.lineEls[eo] || null;
      for (let i = s; i < eo; i++) { this.activeEls.delete(this.lineEls[i]); this.lineEls[i].remove(); }
      const fresh = [];
      const frag = this.doc.createDocumentFragment();
      for (let i = s; i < en; i++) {
        const d = this.doc.createElement('div');
        fresh.push(d);
        frag.appendChild(d);
      }
      this.content.insertBefore(frag, ref);
      this.lineEls = this.lineEls.slice(0, s).concat(fresh, this.lineEls.slice(eo));
    }
    this.rendered = neu.slice();
    const kinds = computeKinds(neu);
    this.highlightCode(neu, kinds);
    for (let i = 0; i < neu.length; i++) {
      const el = this.lineEls[i];
      el._mjIdx = i;
      const k = kinds[i];
      if (el._mjText !== neu[i] || el._mjKey !== k.key) this.paintLine(el, neu[i], k);
    }
    this.kinds = kinds;
    this.content.classList.toggle('mj-empty', neu.length === 1 && neu[0] === '');
  }

  paintLine(el, text, k) {
    el.className = lineClass(k) + (this.activeEls.has(el) ? ' mj-active' : '');
    el.replaceChildren();
    appendNodes(el, renderLine(text, k, this.host.resolveImage));
    el._mjText = text;
    el._mjKey = k.key;
  }

  fitImage(img, quiet) {
    const g = this.geo;
    if (!g) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    let h = Math.min(g.colW, nw) * nh / nw;
    h = Math.min(h, g.contentH - g.lh);
    h = Math.max(g.lh, Math.floor(h / g.lh) * g.lh); // keep the text on the ruling
    img.style.height = h + 'px';
    img.style.width = Math.min(g.colW, h * nw / nh) + 'px';
    if (!quiet) this.measure();
  }

  lineElOf(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentNode);
    while (el && el.parentNode !== this.content) el = el.parentNode;
    return el && el._mjIdx != null && this.lineEls[el._mjIdx] === el ? el : null;
  }

  posFromDOM(node, offset) {
    if (node === this.content) {
      const n = this.lineEls.length;
      if (offset >= n) return this.endPos();
      return { line: offset, ch: 0 };
    }
    const el = this.lineElOf(node);
    if (!el) return null;
    const line = el._mjIdx;
    const r = this.doc.createRange();
    r.setStart(el, 0);
    try { r.setEnd(node, offset); } catch { return { line, ch: 0 }; }
    return { line, ch: Math.min(r.toString().length, this.lines[line].length) };
  }

  domPoint(pos) {
    const el = this.lineEls[pos.line];
    if (!el) return [this.content, 0];
    const w = this.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let t;
    let last = null;
    while ((t = w.nextNode())) {
      const len = t.data.length;
      if (pos.ch <= acc + len) return [t, pos.ch - acc];
      acc += len;
      last = t;
    }
    return last ? [last, last.data.length] : [el, 0];
  }

  readSelection() {
    const s = this.doc.getSelection();
    if (!s || !s.rangeCount || !s.anchorNode) return null;
    if (!this.content.contains(s.anchorNode) || !this.content.contains(s.focusNode)) return null;
    const anchor = this.posFromDOM(s.anchorNode, s.anchorOffset);
    const head = this.posFromDOM(s.focusNode, s.focusOffset);
    return anchor && head ? { anchor, head } : null;
  }

  hasFocus() { return this.doc.activeElement === this.content; }

  focus() {
    this.content.focus({ preventScroll: true });
    const c = this.sel ? this.sel : { anchor: this.endPos(), head: this.endPos() };
    this.setSelection(this.clampPos(c.anchor), this.clampPos(c.head));
    this.revealCaret(false);
  }

  setSelection(anchor, head = anchor) {
    this.sel = { anchor, head };
    this.updateActive(this.sel);
    this._expected = this.sel;
    const [an, ao] = this.domPoint(anchor);
    const [hn, ho] = this.domPoint(head);
    const s = this.doc.getSelection();
    if (s) s.setBaseAndExtent(an, ao, hn, ho);
  }

  /* Lines that hold the caret show their Markdown marks; the rest hide them. */
  updateActive(sel) {
    const want = new Set();
    if (sel) {
      for (const p of [sel.anchor, sel.head]) { const el = this.lineEls[p.line]; if (el) want.add(el); }
    }
    let changed = false;
    for (const el of this.activeEls) if (!want.has(el)) { el.classList.remove('mj-active'); changed = true; }
    for (const el of want) if (!this.activeEls.has(el)) { el.classList.add('mj-active'); changed = true; }
    this.activeEls = want;
    return changed;
  }

  rectAt(pos) {
    const [node, off] = this.domPoint(pos);
    const r = this.doc.createRange();
    if (node.nodeType === 3) {
      r.setStart(node, off);
      r.collapse(true);
      let rs = r.getClientRects();
      if (rs.length) return rs[rs.length - 1];
      if (off < node.data.length) {
        r.setEnd(node, off + 1);
        rs = r.getClientRects();
        if (rs.length) return rs[0];
      }
      if (off > 0) {
        r.setStart(node, off - 1);
        r.setEnd(node, off);
        rs = r.getClientRects();
        if (rs.length) { const x = rs[rs.length - 1]; return { left: x.right, right: x.right, top: x.top, bottom: x.bottom }; }
      }
    }
    const el = this.lineEls[pos.line];
    if (el) { const rs = el.getClientRects(); if (rs.length) return rs[0]; }
    return null;
  }

  revealCaret(animate) {
    if (!this.sel || !this.laidOut) return;
    const r = this.rectAt(this.sel.head);
    if (!r) return;
    const s = Math.floor(this.pageOfRect(r) / this.n);
    if (s !== this.spread) this.showSpread(s, animate);
  }

  /* First caret position on page p (for flipping with the editor focused). */
  posAtPageStart(p) {
    const els = this.lineEls;
    const pageOf = (r) => this.pageOfRect(r);
    let lo = 0;
    let hi = els.length - 1;
    let found = -1;
    while (lo <= hi) { // first line whose last fragment is on page >= p
      const mid = (lo + hi) >> 1;
      const rs = els[mid].getClientRects();
      if (rs.length && pageOf(rs[rs.length - 1]) >= p) { found = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (found < 0) return this.endPos();
    const el = els[found];
    const first = el.getClientRects();
    if (!first.length || pageOf(first[0]) >= p) return { line: found, ch: 0 };
    const w = this.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const r = this.doc.createRange();
    let t;
    while ((t = w.nextNode())) {
      r.selectNodeContents(t);
      const rs = r.getClientRects();
      if (!rs.length || pageOf(rs[rs.length - 1]) < p) continue;
      let a = 0;
      let b = t.data.length - 1;
      let k = t.data.length;
      while (a <= b) {
        const mid = (a + b) >> 1;
        r.setStart(t, mid);
        r.setEnd(t, mid + 1);
        const cr = r.getClientRects();
        if (cr.length && pageOf(cr[0]) >= p) { k = mid; b = mid - 1; } else a = mid + 1;
      }
      return this.posFromDOM(t, k) || { line: found, ch: 0 };
    }
    return { line: found, ch: 0 };
  }

  /* ---------- editing ---------- */

  snapshot() {
    return { lines: this.lines.slice(), sel: this.sel ? { anchor: { ...this.sel.anchor }, head: { ...this.sel.head } } : null };
  }

  pushUndo(kind) {
    const now = Date.now();
    const coalesce = (kind === 'type' || kind === 'delete') && kind === this.lastUndoKind && now - this.lastUndoTime < 1200;
    this.lastUndoKind = kind;
    this.lastUndoTime = now;
    if (coalesce) return;
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
  }

  restore(snap) {
    this.lastUndoKind = null;
    this.lines = snap.lines;
    const sel = snap.sel || { anchor: this.endPos(), head: this.endPos() };
    this.commit(this.clampPos(sel.anchor), this.clampPos(sel.head));
  }

  replaceRange(from, to, text) {
    from = this.clampPos(from);
    to = this.clampPos(to);
    const before = this.lines[from.line].slice(0, from.ch);
    const after = this.lines[to.line].slice(to.ch);
    const parts = text.split('\n');
    const endCh = parts[parts.length - 1].length + (parts.length === 1 ? before.length : 0);
    parts[0] = before + parts[0];
    parts[parts.length - 1] += after;
    this.lines = this.lines.slice(0, from.line).concat(parts, this.lines.slice(to.line + 1));
    return { line: from.line + parts.length - 1, ch: endCh };
  }

  edit(from, to, text, kind) {
    [from, to] = ordered(from, to);
    this.pushUndo(kind === 'type' && !samePos(from, to) ? 'replace' : kind);
    const caret = this.replaceRange(from, to, text);
    this.commit(caret, caret);
  }

  commit(anchor, head = anchor) {
    this.syncDOM();
    if (this.hasFocus()) this.setSelection(anchor, head);
    else { this.sel = { anchor, head }; this.updateActive(this.sel); }
    this.measure();
    this.revealCaret(true);
    this.changed();
  }

  changed() {
    this.scheduleWordCount();
    if (this.host.onChange) this.host.onChange();
  }

  currentSel() {
    return this.readSelection() || this.sel;
  }

  getRangeText(from, to) {
    [from, to] = ordered(from, to);
    if (from.line === to.line) return this.lines[from.line].slice(from.ch, to.ch);
    const out = [this.lines[from.line].slice(from.ch)];
    for (let l = from.line + 1; l < to.line; l++) out.push(this.lines[l]);
    out.push(this.lines[to.line].slice(0, to.ch));
    return out.join('\n');
  }

  insertNewline(sel, plain) {
    const [from, to] = ordered(sel.anchor, sel.head);
    if (!plain && samePos(from, to)) {
      const line = this.lines[from.line];
      const k = this.kinds[from.line];
      const next = continuationPrefix(line, k, from.ch);
      if (next === null && from.ch === line.length) { // Enter on an empty item ends the list
        this.edit({ line: from.line, ch: 0 }, { line: from.line, ch: line.length }, '', 'other');
        return;
      }
      if (next) { this.edit(from, to, '\n' + next, 'other'); return; }
    }
    this.edit(from, to, '\n', 'other');
  }

  deleteBackward(sel, unit) {
    const [from, to] = ordered(sel.anchor, sel.head);
    if (!samePos(from, to)) { this.edit(from, to, '', 'other'); return; }
    const p = from;
    if (p.ch === 0) {
      if (p.line > 0) this.edit({ line: p.line - 1, ch: this.lines[p.line - 1].length }, p, '', 'delete');
      return;
    }
    const line = this.lines[p.line];
    const k = this.kinds[p.line];
    if (unit === 'char' && k && ['ul', 'ol', 'task'].includes(k.type) && p.ch === k.prefix) {
      this.edit({ line: p.line, ch: k.indent.length }, p, '', 'other'); // Backspace right after "- " drops the bullet
      return;
    }
    const start = unit === 'word' ? prevWordStart(line, p.ch) : unit === 'line' ? 0 : prevBoundary(line, p.ch);
    this.edit({ line: p.line, ch: start }, p, '', 'delete');
  }

  deleteForward(sel, unit) {
    const [from, to] = ordered(sel.anchor, sel.head);
    if (!samePos(from, to)) { this.edit(from, to, '', 'other'); return; }
    const p = from;
    const line = this.lines[p.line];
    if (p.ch >= line.length) {
      if (p.line < this.lines.length - 1) this.edit(p, { line: p.line + 1, ch: 0 }, '', 'delete');
      return;
    }
    const end = unit === 'word' ? nextWordEnd(line, p.ch) : unit === 'line' ? line.length : nextBoundary(line, p.ch);
    this.edit(p, { line: p.line, ch: end }, '', 'delete');
  }

  indent(sel, outdent) {
    const [from, to] = ordered(sel.anchor, sel.head);
    const k = this.kinds[from.line];
    const listy = k && ['ul', 'ol', 'task'].includes(k.type);
    if (!outdent && samePos(from, to) && !listy) { this.edit(from, to, '\t', 'other'); return; }
    this.pushUndo('other');
    const shift = {};
    for (let l = from.line; l <= to.line; l++) {
      if (outdent) {
        const m = /^(\t| {1,4})/.exec(this.lines[l]);
        if (!m) continue;
        this.lines[l] = this.lines[l].slice(m[0].length);
        shift[l] = -m[0].length;
      } else {
        this.lines[l] = '\t' + this.lines[l];
        shift[l] = 1;
      }
    }
    const move = (p) => ({ line: p.line, ch: Math.max(0, p.ch + (shift[p.line] || 0)) });
    this.commit(move(sel.anchor), move(sel.head));
  }

  toggleWrap(marker) {
    const sel = this.currentSel();
    if (!sel) return;
    const [from, to] = ordered(sel.anchor, sel.head);
    if (from.line !== to.line) return;
    const line = this.lines[from.line];
    const L = marker.length;
    this.pushUndo('other');
    if (line.slice(from.ch - L, from.ch) === marker && line.slice(to.ch, to.ch + L) === marker) {
      this.lines[from.line] = line.slice(0, from.ch - L) + line.slice(from.ch, to.ch) + line.slice(to.ch + L);
      this.commit({ line: from.line, ch: from.ch - L }, { line: from.line, ch: to.ch - L });
    } else {
      this.lines[from.line] = line.slice(0, from.ch) + marker + line.slice(from.ch, to.ch) + marker + line.slice(to.ch);
      this.commit({ line: from.line, ch: from.ch + L }, { line: from.line, ch: to.ch + L });
    }
  }

  /* Puts a block (a date heading, a page break) on its own line at the caret. */
  insertBlock(text) {
    const sel = this.currentSel() || { anchor: this.endPos(), head: this.endPos() };
    this.content.focus({ preventScroll: true });
    const [, to] = ordered(sel.anchor, sel.head);
    const line = this.lines[to.line];
    if (!line.trim()) {
      this.edit({ line: to.line, ch: 0 }, { line: to.line, ch: line.length }, text + '\n', 'other');
    } else {
      this.edit({ line: to.line, ch: line.length }, { line: to.line, ch: line.length }, '\n' + text + '\n', 'other');
    }
  }

  toggleTask(lineIdx) {
    const k = this.kinds[lineIdx];
    if (!k || k.type !== 'task') return;
    const line = this.lines[lineIdx];
    const i = k.checkAt + 1;
    this.pushUndo('other');
    this.lines[lineIdx] = line.slice(0, i) + (line[i] === ' ' ? 'x' : ' ') + line.slice(i + 1);
    const sel = this.sel;
    this.syncDOM();
    if (sel && this.hasFocus()) this.setSelection(sel.anchor, sel.head);
    this.measure();
    this.changed();
  }

  /* ---------- events ---------- */

  onBeforeInput(e) {
    if (this.composing || e.isComposing || e.inputType === 'insertCompositionText') return;
    if (!e.cancelable) { this.pushUndo('type'); return; } // let it happen, read it back in onInput
    const sel = this.readSelection() || this.sel;
    e.preventDefault();
    if (!sel) return;
    const t = e.inputType;
    let range = null;
    const tr = e.getTargetRanges ? e.getTargetRanges() : [];
    if (tr.length) {
      const a = this.posFromDOM(tr[0].startContainer, tr[0].startOffset);
      const b = this.posFromDOM(tr[0].endContainer, tr[0].endOffset);
      if (a && b) range = [a, b];
    }
    const [from, to] = ordered(sel.anchor, sel.head);
    switch (t) {
      case 'insertText':
      case 'insertReplacementText':
      case 'insertFromDrop':
      case 'insertFromPaste':
      case 'insertFromYank': {
        let text = e.data;
        if (text == null && e.dataTransfer) text = e.dataTransfer.getData('text/plain');
        if (text == null) return;
        text = text.replace(/\r\n?/g, '\n');
        const r = t === 'insertText' ? [from, to] : (range || [from, to]);
        this.edit(r[0], r[1], text, t === 'insertText' && text.length === 1 ? 'type' : 'other');
        return;
      }
      case 'insertParagraph': this.insertNewline(sel, false); return;
      case 'insertLineBreak': this.insertNewline(sel, true); return;
      case 'deleteContentBackward': this.deleteBackward(sel, 'char'); return;
      case 'deleteContentForward': this.deleteForward(sel, 'char'); return;
      case 'deleteWordBackward': this.deleteBackward(sel, 'word'); return;
      case 'deleteWordForward': this.deleteForward(sel, 'word'); return;
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        if (range && !samePos(range[0], range[1])) this.edit(range[0], range[1], '', 'other');
        else this.deleteBackward(sel, 'line');
        return;
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
        if (range && !samePos(range[0], range[1])) this.edit(range[0], range[1], '', 'other');
        else this.deleteForward(sel, 'line');
        return;
      case 'deleteByCut':
      case 'deleteContent':
      case 'deleteByDrag':
        if (!samePos(from, to)) this.edit(from, to, '', 'other');
        return;
      case 'historyUndo': this.undo(); return;
      case 'historyRedo': this.redo(); return;
      case 'formatBold': this.toggleWrap('**'); return;
      case 'formatItalic': this.toggleWrap('*'); return;
      default: // formatting the browser would do to the HTML — not Markdown
    }
  }

  onInput(e) {
    if (this.composing || (e && e.isComposing)) return;
    this.resyncFromDOM(); // only reached for input we could not intercept
  }

  onCompositionStart() {
    this.pushUndo('type');
    this.composing = true;
  }

  onCompositionEnd() {
    this.composing = false;
    this.resyncFromDOM();
  }

  /* The browser changed the DOM by itself (IME, some mobile keyboards): read the
     text back, then repaint so the DOM is ours again. */
  resyncFromDOM() {
    const s = this.doc.getSelection();
    const { lines, caret } = domToLines(this.content, s && s.focusNode, s && s.focusOffset);
    const kids = this.content.childNodes;
    let intact = kids.length === this.lineEls.length && lines.length === this.lineEls.length;
    for (let i = 0; intact && i < kids.length; i++) if (kids[i] !== this.lineEls[i]) intact = false;
    if (intact) {
      let same = true;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== this.rendered[i]) { this.lineEls[i]._mjText = null; same = false; }
      }
      if (same) return;
      this.rendered = lines.slice();
    } else {
      this.content.textContent = '';
      this.lineEls = [];
      this.rendered = [];
      this.activeEls.clear();
    }
    this.lines = lines;
    const c = this.clampPos(caret || (this.sel && this.sel.head) || this.endPos());
    this.commit(c, c);
  }

  onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    const isMac = !!(this.host.platform && this.host.platform.isMacOS);
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (mod && !e.altKey) {
      const lower = k.length === 1 ? k.toLowerCase() : k;
      if (lower === 'z') { stop(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (lower === 'y' && !isMac) { stop(); this.redo(); return; }
      if (lower === 'b') { stop(); this.toggleWrap('**'); return; }
      if (lower === 'i') { stop(); this.toggleWrap('*'); return; }
    }
    if (k === 'Tab' && !mod && !e.altKey) {
      stop();
      const sel = this.currentSel();
      if (sel) this.indent(sel, e.shiftKey);
      return;
    }
    if (k === 'PageDown' || k === 'PageUp') { stop(); this.flip(k === 'PageDown' ? 1 : -1); }
  }

  onSelectionChange() {
    if (this.composing) return;
    const sel = this.readSelection();
    if (!sel) return;
    const exp = this._expected;
    this._expected = null;
    if (!exp || !samePos(exp.anchor, sel.anchor) || !samePos(exp.head, sel.head)) this.lastUndoKind = null;
    this.sel = sel;
    if (this.updateActive(sel)) this.measure();
    this.revealCaret(true);
    if (this.host.onCaret) this.host.onCaret(sel.head);
  }

  onCopy(e, cut) {
    const sel = this.readSelection();
    if (!sel || samePos(sel.anchor, sel.head) || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', this.getRangeText(sel.anchor, sel.head));
    if (cut) this.edit(sel.anchor, sel.head, '', 'other');
  }

  onPaste(e) {
    e.preventDefault();
    const dt = e.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.files || []).filter((f) => /^image\//.test(f.type));
    if (files.length && this.host.saveAttachment) { this.insertFiles(files); return; }
    const text = dt.getData('text/plain');
    const sel = this.currentSel();
    if (!text || !sel) return;
    this.edit(sel.anchor, sel.head, text.replace(/\r\n?/g, '\n'), 'other');
  }

  onDrop(e) {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => /^image\//.test(f.type));
    if (!files.length || !this.host.saveAttachment) return; // text drops arrive as beforeinput
    e.preventDefault();
    const r = this.doc.caretRangeFromPoint ? this.doc.caretRangeFromPoint(e.clientX, e.clientY) : null;
    const pos = r && this.posFromDOM(r.startContainer, r.startOffset);
    if (pos) { this.content.focus({ preventScroll: true }); this.setSelection(pos, pos); }
    this.insertFiles(files);
  }

  async insertFiles(files) {
    const embeds = [];
    for (const f of files) {
      try { const md = await this.host.saveAttachment(f); if (md) embeds.push(md); } catch (err) { console.error('MD Journal: could not save the attachment', err); }
    }
    const sel = this.sel;
    if (!embeds.length || !sel) return;
    const [from, to] = ordered(sel.anchor, sel.head);
    let text = embeds.join('\n');
    if (from.ch > 0) text = '\n' + text;
    if (to.ch < this.lines[to.line].length) text += '\n';
    this.edit(from, to, text, 'other');
  }

  onContentMouseDown(e) {
    const t = e.target;
    const chk = t && t.closest && t.closest('.mj-check');
    if (chk && this.content.contains(chk)) {
      e.preventDefault();
      const el = this.lineElOf(chk);
      if (el) this.toggleTask(el._mjIdx);
      return;
    }
    const link = t && t.closest && t.closest('.mj-link');
    if (link && (e.ctrlKey || e.metaKey) && this.host.openLink) {
      e.preventDefault();
      this.host.openLink(link.dataset.href, e.shiftKey || e.altKey);
    }
  }

  /* A click on paper where there is no text (below the last line of a page, or a
     blank page) puts the caret at the end of the writing on that page. */
  onPaperMouseDown(e) {
    e.preventDefault();
    const paper = e.target.closest && e.target.closest('.mj-paper');
    const page = paper ? this.paperEls.indexOf(paper) : -1;
    this.content.focus({ preventScroll: true });
    let pos;
    if (page < 0 || page >= this.totalPages - 1) pos = this.endPos();
    else {
      pos = this.posAtPageStart(page + 1);
      if (pos.ch > 0) pos = { line: pos.line, ch: prevBoundary(this.lines[pos.line], pos.ch) };
      else if (pos.line > 0) pos = { line: pos.line - 1, ch: this.lines[pos.line - 1].length };
    }
    this.setSelection(pos, pos);
    this.revealCaret(true);
  }

  onWheel(e) {
    if (e.ctrlKey) return;
    e.preventDefault();
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 6) return;
    const now = Date.now();
    if (now - (this._lastWheel || 0) < 450) return;
    this._lastWheel = now;
    this.flip(d > 0 ? 1 : -1);
  }

  onTouchStart(e) {
    const t = e.touches[0];
    this._touch = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, time: Date.now() } : null;
  }

  onTouchEnd(e) {
    const s = this._touch;
    this._touch = null;
    if (!s || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    const sel = this.doc.getSelection();
    if (sel && !sel.isCollapsed) return; // the user was selecting text
    if (Date.now() - s.time < 500 && Math.abs(dx) > 60 && Math.abs(dy) < 45) this.flip(dx < 0 ? 1 : -1);
  }
}
