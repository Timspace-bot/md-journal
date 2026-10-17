/*
 * PagedEditor — the page you write on. It uses only the DOM and Obsidian's DOM
 * helpers (createDiv, createEl…), so the browser harness can run it with a stub.
 *
 * The Markdown source (an array of lines) is the model; the DOM is a view of it.
 * A contenteditable surface is laid out in CSS columns at a fixed height, one
 * column per page, so the browser decides where a page ends and text that no
 * longer fits moves to the next page by itself. Edits are intercepted
 * (beforeinput, clipboard, keys), applied to the model, and only the changed
 * lines are repainted. IME composition cannot be intercepted, so the browser
 * types it and the changed lines are read back.
 */
import { FONTS, PAPERS, TINTS, type JournalSettings, type Pos } from './constants';
import { pageGeometry, screenGeometry, type Geometry } from './geometry';
import {
  computeKinds, renderLine, lineClass, nodesKey, continuationPrefix, isList,
  prevBoundary, nextBoundary, prevWordStart, nextWordEnd, countWords,
  type LineKind, type MdNode,
} from './markdown';
import { appendNodes, domToLines } from './dom';

export interface EditorHost {
  platform?: { isPhone: boolean; isMacOS: boolean };
  onChange?: () => void;
  onCaret?: (pos: Pos) => void;
  resolveImage?: (link: string) => string | null;
  openLink?: (href: string, newLeaf: boolean) => void;
  saveAttachment?: (file: File) => Promise<string>;
  highlight?: (code: string, lang: string) => MdNode[][] | null;
}

export interface Selection2 { anchor: Pos; head: Pos }
type UndoKind = 'type' | 'delete' | 'replace' | 'other';
type Unit = 'char' | 'word' | 'line';
interface Snapshot { lines: string[]; sel: Selection2 | null }
interface LineMeta { idx: number; text: string | null; key: string | null }
interface CaretRect { left: number; right: number; top: number; bottom: number }

const cmpPos = (a: Pos, b: Pos): number => (a.line - b.line) || (a.ch - b.ch);
const samePos = (a: Pos, b: Pos): boolean => cmpPos(a, b) === 0;
const ordered = (a: Pos, b: Pos): [Pos, Pos] => (cmpPos(a, b) <= 0 ? [a, b] : [b, a]);

export class PagedEditor {
  settings: JournalSettings;
  sel: Selection2 | null = null;
  n = 1;
  spread = 0;
  scale = 1;
  totalPages = 1;
  lines: string[] = [''];
  geo: Geometry | null = null;

  private host: EditorHost;
  private doc: Document;
  private win: Window;
  private root!: HTMLDivElement;
  private viewport!: HTMLDivElement;
  private book!: HTMLDivElement;
  private stage!: HTMLDivElement;
  private track!: HTMLDivElement;
  private papers!: HTMLDivElement;
  private content!: HTMLDivElement;
  private bar!: HTMLDivElement;
  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private info!: HTMLSpanElement;
  private meta!: HTMLSpanElement;

  private lineEls: HTMLDivElement[] = [];
  private lineMeta = new WeakMap<HTMLElement, LineMeta>();
  private rendered: string[] = [];
  private kinds: LineKind[] = [];
  private activeEls = new Set<HTMLElement>();
  private paperEls: HTMLDivElement[] = [];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastUndoKind: UndoKind | null = null;
  private lastUndoTime = 0;
  private composing = false;
  private laidOut = false;
  private screen = false;
  private fixed = true;
  private shown = false;
  private revealPending = false;
  private expected: Selection2 | null = null;
  private status = '';
  private words: number | null = null;
  private wordTimer = 0;
  private lastWheel = 0;
  private touch: { x: number; y: number; time: number } | null = null;
  private hlCache = new Map<string, MdNode[][] | null>();
  private disposers: (() => void)[] = [];
  private ro: ResizeObserver | null = null;

  constructor(parent: HTMLElement, host: EditorHost, settings: JournalSettings) {
    this.host = host;
    this.doc = parent.ownerDocument;
    this.win = this.doc.defaultView ?? window;
    this.settings = settings;
    this.build(parent);
    this.configure(settings);
    this.syncDOM();
  }

  /* ---------- DOM ---------- */

  private on<E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions | boolean): void {
    const listener = (e: Event): void => fn(e as E);
    target.addEventListener(type, listener, opts);
    this.disposers.push(() => target.removeEventListener(type, listener, opts));
  }

  private build(parent: HTMLElement): void {
    this.root = parent.createDiv({ cls: 'mj-root' });
    this.viewport = this.root.createDiv({ cls: 'mj-viewport' });
    this.book = this.viewport.createDiv({ cls: 'mj-book' });
    this.stage = this.book.createDiv({ cls: 'mj-stage' });
    this.track = this.stage.createDiv({ cls: 'mj-track' });
    this.papers = this.track.createDiv({ cls: 'mj-papers' });
    this.content = this.track.createDiv({
      cls: 'mj-content',
      attr: { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', autocapitalize: 'sentences' },
    });
    this.stage.createDiv({ cls: 'mj-spine' });

    this.bar = this.root.createDiv({ cls: 'mj-bar' });
    this.prevBtn = this.bar.createEl('button', { cls: 'mj-nav clickable-icon', text: '‹', attr: { 'aria-label': 'Previous page' } });
    this.info = this.bar.createSpan({ cls: 'mj-info' });
    this.nextBtn = this.bar.createEl('button', { cls: 'mj-nav clickable-icon', text: '›', attr: { 'aria-label': 'Next page' } });
    this.meta = this.bar.createSpan({ cls: 'mj-meta' });

    const c = this.content;
    this.on<InputEvent>(c, 'beforeinput', (e) => this.onBeforeInput(e));
    this.on<InputEvent>(c, 'input', (e) => this.onInput(e));
    this.on<KeyboardEvent>(c, 'keydown', (e) => this.onKeyDown(e));
    this.on(c, 'compositionstart', () => this.onCompositionStart());
    this.on(c, 'compositionend', () => this.onCompositionEnd());
    this.on<ClipboardEvent>(c, 'copy', (e) => this.onCopy(e, false));
    this.on<ClipboardEvent>(c, 'cut', (e) => this.onCopy(e, true));
    this.on<ClipboardEvent>(c, 'paste', (e) => this.onPaste(e));
    this.on<DragEvent>(c, 'drop', (e) => this.onDrop(e));
    this.on(c, 'dragstart', (e) => e.preventDefault());
    this.on<MouseEvent>(c, 'mousedown', (e) => this.onContentMouseDown(e));
    this.on(c, 'load', (e) => {
      const img = e.target as HTMLImageElement | null;
      if (img && img.nodeName === 'IMG') this.fitImage(img, false);
    }, true);
    this.on<MouseEvent>(this.papers, 'mousedown', (e) => this.onPaperMouseDown(e));
    this.on(this.doc, 'selectionchange', () => this.onSelectionChange());
    this.on<WheelEvent>(this.viewport, 'wheel', (e) => this.onWheel(e), { passive: false });
    this.on<TouchEvent>(this.viewport, 'touchstart', (e) => this.onTouchStart(e), { passive: true });
    this.on<TouchEvent>(this.viewport, 'touchend', (e) => this.onTouchEnd(e), { passive: true });
    this.on(this.prevBtn, 'click', () => this.flip(-1));
    this.on(this.nextBtn, 'click', () => this.flip(1));
    this.on(this.bar, 'mousedown', (e) => e.preventDefault()); // keep the caret in the page
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(this.viewport);
    }
    this.doc.fonts.ready.then(() => { if (this.root.isConnected) this.layout(); }).catch(() => { /* layout already ran */ });
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    if (this.ro) this.ro.disconnect();
    this.win.clearTimeout(this.wordTimer);
    this.root.remove();
  }

  configure(settings: JournalSettings): void {
    this.settings = settings;
    this.screen = settings.layout === 'screen';
    // the theme view always wears the theme; paper and type are journal settings
    const font = this.screen ? FONTS.theme.css : settings.fontFamily === 'custom'
      ? (settings.fontFamilyCustom || FONTS.serif.css)
      : (FONTS[settings.fontFamily] ?? FONTS.serif).css;
    const tint = this.screen ? 'theme' : settings.tint;
    this.root.setCssProps({ '--mj-font': font });
    const cls = this.root.classList;
    cls.toggle('mj-screen', this.screen);
    for (const t of Object.keys(TINTS)) cls.toggle('mj-tint-' + t, tint === t);
    for (const p of Object.keys(PAPERS)) cls.toggle('mj-paper-' + p, !this.screen && settings.paper === p);
    cls.toggle('mj-hide-syntax', settings.hideSyntax);
    cls.toggle('mj-no-pnum', this.screen || !settings.pageNumbers);
    cls.toggle('mj-h1-newpage', settings.headingNewPage);
    this.content.spellcheck = settings.spellcheck;
    this.geo = null;
    this.laidOut = false;
    // A fixed page never depends on the window: same text per page, just scaled.
    this.fixed = !this.screen || settings.fixedPage;
    cls.toggle('mj-fixed', this.fixed);
    if (!this.screen) this.applyGeometry(pageGeometry(settings));
    else if (this.fixed) this.applyGeometry(pageGeometry({ ...settings, fontSize: this.themeFontSize() }));
    this.layout();
  }

  private themeFontSize(): number {
    return parseFloat(this.win.getComputedStyle(this.root).getPropertyValue('--font-text-size')) || 16;
  }

  private applyGeometry(g: Geometry): void {
    this.geo = g;
    const px = (v: number): string => String(v) + 'px';
    this.root.setCssProps({
      '--mj-page-w': px(g.W),
      '--mj-page-h': px(g.H),
      '--mj-margin': px(g.m),
      '--mj-top': px(g.top),
      '--mj-bottom': px(g.bottom),
      '--mj-col-w': px(g.colW),
      '--mj-content-h': px(g.contentH),
      '--mj-fs': px(g.fs),
      '--mj-lh': px(g.lh),
    });
    this.content.querySelectorAll<HTMLImageElement>('img.mj-img').forEach((img) => this.fitImage(img, true));
  }

  /* Journal pages and fixed pages: scale the fixed-size page to the window.
     Theme view: the pane is the page, so the columns are re-cut to fit it. */
  layout(): void {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    if (!vw || !vh) return;
    const phone = !!this.host.platform?.isPhone;
    const firstPage = this.spread * this.n;
    let n: number;
    let scale: number;
    let reflowed = false;
    let g = this.geo;
    if (!this.fixed) {
      const sg = screenGeometry(vw, vh, this.settings, this.themeFontSize(), phone);
      if (!g || g.W !== sg.W || g.H !== sg.H || g.colW !== sg.colW || g.lh !== sg.lh || g.fs !== sg.fs) {
        reflowed = !!g;
        this.applyGeometry(sg);
        g = sg;
      }
      this.root.classList.toggle('mj-narrow', sg.narrow);
      n = sg.n;
      scale = 1;
    } else {
      if (!g) return;
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
    this.n = n;
    this.scale = scale;
    this.root.classList.toggle('mj-double', n === 2);
    const px = (v: number): string => String(v) + 'px';
    this.book.setCssProps({ width: px(n * g.W * scale), height: px(g.H * scale) });
    this.stage.setCssProps({ width: px(n * g.W), height: px(g.H), transform: 'scale(' + String(scale) + ')' });
    this.content.setCssProps({ width: px(n * g.colW + (n - 1) * g.gap) }); // .mj-double sets two columns
    this.spread = Math.floor(firstPage / n);
    this.laidOut = true;
    this.measure();
    // pages were re-cut (theme view resized): stay with the caret, not the page number
    if (this.revealPending || reflowed) { this.revealPending = false; this.revealCaret(false); }
  }

  /* Repaint every line (e.g. once code highlighting becomes available). */
  repaint(): void {
    for (const el of this.lineEls) { const m = this.lineMeta.get(el); if (m) m.key = null; }
    this.hlCache.clear();
    this.syncDOM();
    if (this.sel && this.hasFocus()) this.setSelection(this.sel.anchor, this.sel.head);
    this.measure();
  }

  /* Fenced blocks with a language get Prism token spans (node lists, one per line). */
  private highlightCode(lines: string[], kinds: LineKind[]): void {
    const hl = this.host.highlight;
    if (!hl) return;
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i];
      if (k.type !== 'fence' || !k.lang) continue;
      let j = i + 1;
      while (j < kinds.length && kinds[j].type === 'code') j++;
      if (j > i + 1) {
        const code = lines.slice(i + 1, j).join('\n');
        const ck = k.lang + '\u0000' + code;
        let hlLines = this.hlCache.get(ck);
        if (hlLines === undefined) {
          hlLines = hl(code, k.lang);
          this.hlCache.set(ck, hlLines);
          if (this.hlCache.size > 64) {
            const oldest = this.hlCache.keys().next();
            if (!oldest.done) this.hlCache.delete(oldest.value);
          }
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

  pageOfRect(r: CaretRect): number {
    const g = this.geo;
    if (!g) return 0;
    const cb = this.content.getBoundingClientRect();
    const x = ((r.left + r.right) / 2 - cb.left) / (this.scale || 1);
    return Math.max(0, Math.floor(x / (g.colW + g.gap)));
  }

  private measure(): void {
    if (!this.laidOut) return;
    let pages = 1;
    const last = this.lineEls[this.lineEls.length - 1];
    if (last) {
      const rs = last.getClientRects();
      if (rs.length) pages = this.pageOfRect(rs[rs.length - 1]) + 1;
      if (this.kinds[this.kinds.length - 1]?.type === 'pagebreak') pages++;
    }
    this.totalPages = pages;
    this.renderPapers();
    const spreads = this.spreadCount();
    if (this.spread > spreads - 1) this.showSpread(spreads - 1, false);
    else this.showSpread(this.spread, false, true);
  }

  private spreadCount(): number { return Math.max(1, Math.ceil(this.totalPages / this.n)); }

  private renderPapers(): void {
    const g = this.geo;
    if (!g) return;
    const count = this.spreadCount() * this.n;
    while (this.paperEls.length < count) {
      const p = this.papers.createDiv({ cls: 'mj-paper' });
      p.createDiv({ cls: 'mj-rules' });
      p.createDiv({ cls: 'mj-pnum' });
      this.paperEls.push(p);
    }
    while (this.paperEls.length > count) this.paperEls.pop()?.remove();
    this.paperEls.forEach((p, i) => {
      p.setCssProps({ left: String(i * g.W) + 'px' });
      p.className = 'mj-paper' + (this.n === 2 ? (i % 2 ? ' mj-paper-r' : ' mj-paper-l') : '');
      if (p.lastChild) p.lastChild.textContent = String(i + 1);
    });
  }

  private showSpread(s: number, animate: boolean, silent = false): void {
    const g = this.geo;
    if (!g) return;
    const spreads = this.spreadCount();
    s = Math.max(0, Math.min(s, spreads - 1));
    const changed = s !== this.spread || !this.shown;
    this.spread = s;
    this.shown = true;
    if (changed || !silent) {
      this.track.toggleClass('mj-animate', animate && this.settings.animate);
      this.track.setCssProps({ transform: 'translate3d(' + String(-s * this.n * g.W) + 'px,0,0)' });
    }
    this.updateBar();
  }

  flip(delta: number): void {
    const before = this.spread;
    this.showSpread(this.spread + delta, true);
    if (this.spread === before) return;
    if (this.hasFocus()) {
      const pos = this.posAtPageStart(this.spread * this.n);
      this.setSelection(pos, pos);
    }
  }

  private updateBar(): void {
    const first = this.spread * this.n + 1;
    const total = this.spreadCount() * this.n;
    const pages = this.n === 2 ? 'Pages ' + String(first) + '–' + String(first + 1) : 'Page ' + String(first);
    this.info.textContent = pages + ' of ' + String(total);
    this.prevBtn.disabled = this.spread <= 0;
    this.nextBtn.disabled = this.spread >= this.spreadCount() - 1;
  }

  setStatus(text: string): void {
    this.status = text;
    this.renderMeta();
  }

  private renderMeta(): void {
    const words = this.words === null ? '' : this.words.toLocaleString() + (this.words === 1 ? ' word' : ' words');
    this.meta.textContent = [words, this.status].filter(Boolean).join(' · ');
  }

  private scheduleWordCount(): void {
    this.win.clearTimeout(this.wordTimer);
    this.wordTimer = this.win.setTimeout(() => { this.words = countWords(this.getText()); this.renderMeta(); }, 300);
  }

  /* ---------- model <-> DOM ---------- */

  getText(): string { return this.lines.join('\n'); }

  setText(text: string, opts: { resetHistory?: boolean; caret?: Pos | null } = {}): void {
    if (opts.resetHistory) { this.undoStack = []; this.redoStack = []; this.lastUndoKind = null; }
    else this.pushUndo('other');
    const old = this.sel;
    this.lines = text.replace(/\r\n?/g, '\n').split('\n');
    this.syncDOM();
    const c = this.clampPos(opts.caret ?? old?.head ?? this.endPos());
    this.sel = { anchor: c, head: c };
    this.updateActive(this.sel);
    if (this.hasFocus()) this.setSelection(c, c);
    this.measure();
    if (this.laidOut) this.revealCaret(false);
    else this.revealPending = true;
    this.scheduleWordCount();
  }

  endPos(): Pos { const l = this.lines.length - 1; return { line: l, ch: this.lines[l].length }; }

  clampPos(p: Pos): Pos {
    const int = (v: number): number => (Number.isFinite(v) ? Math.trunc(v) : v > 0 ? Number.MAX_SAFE_INTEGER : 0);
    const line = Math.max(0, Math.min(int(p.line), this.lines.length - 1));
    return { line, ch: Math.max(0, Math.min(int(p.ch), this.lines[line].length)) };
  }

  private syncDOM(): void {
    const old = this.rendered;
    const neu = this.lines;
    let s = 0;
    const min = Math.min(old.length, neu.length);
    while (s < min && old[s] === neu[s]) s++;
    let eo = old.length;
    let en = neu.length;
    while (eo > s && en > s && old[eo - 1] === neu[en - 1]) { eo--; en--; }
    if (eo > s || en > s) {
      const ref = this.lineEls[eo] ?? null;
      for (let i = s; i < eo; i++) { this.activeEls.delete(this.lineEls[i]); this.lineEls[i].remove(); }
      const fresh: HTMLDivElement[] = [];
      for (let i = s; i < en; i++) {
        const d = this.content.createDiv();
        if (ref) this.content.insertBefore(d, ref);
        this.lineMeta.set(d, { idx: i, text: null, key: null });
        fresh.push(d);
      }
      this.lineEls = this.lineEls.slice(0, s).concat(fresh, this.lineEls.slice(eo));
    }
    this.rendered = neu.slice();
    const kinds = computeKinds(neu);
    this.highlightCode(neu, kinds);
    for (let i = 0; i < neu.length; i++) {
      const el = this.lineEls[i];
      let m = this.lineMeta.get(el);
      if (!m) { m = { idx: i, text: null, key: null }; this.lineMeta.set(el, m); }
      m.idx = i;
      const k = kinds[i];
      if (m.text !== neu[i] || m.key !== k.key) this.paintLine(el, m, neu[i], k);
    }
    this.kinds = kinds;
    this.content.toggleClass('mj-empty', neu.length === 1 && neu[0] === '');
  }

  private paintLine(el: HTMLDivElement, m: LineMeta, text: string, k: LineKind): void {
    el.className = lineClass(k) + (this.activeEls.has(el) ? ' mj-active' : '');
    el.empty();
    appendNodes(el, renderLine(text, k, this.host.resolveImage));
    m.text = text;
    m.key = k.key;
  }

  private fitImage(img: HTMLImageElement, quiet: boolean): void {
    const g = this.geo;
    if (!g) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    let h = Math.min(g.colW, nw) * nh / nw;
    h = Math.min(h, g.contentH - g.lh);
    h = Math.max(g.lh, Math.floor(h / g.lh) * g.lh); // keep the text on the ruling
    img.setCssProps({ height: String(h) + 'px', width: String(Math.min(g.colW, h * nw / nh)) + 'px' });
    if (!quiet) this.measure();
  }

  private lineElOf(node: Node | null): HTMLDivElement | null {
    let el: Node | null = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode);
    while (el && el.parentNode !== this.content) el = el.parentNode;
    if (!el) return null;
    const m = this.lineMeta.get(el as HTMLElement);
    const line = m ? this.lineEls[m.idx] : undefined;
    return line === el ? line : null;
  }

  private lineIndex(el: HTMLElement): number {
    return this.lineMeta.get(el)?.idx ?? -1;
  }

  posFromDOM(node: Node, offset: number): Pos | null {
    if (node === this.content) {
      if (offset >= this.lineEls.length) return this.endPos();
      return { line: offset, ch: 0 };
    }
    const el = this.lineElOf(node);
    if (!el) return null;
    const line = this.lineIndex(el);
    const r = this.doc.createRange();
    r.setStart(el, 0);
    try { r.setEnd(node, offset); } catch { return { line, ch: 0 }; }
    return { line, ch: Math.min(r.toString().length, this.lines[line].length) };
  }

  private domPoint(pos: Pos): [Node, number] {
    const el = this.lineEls[pos.line];
    if (!el) return [this.content, 0];
    const w = this.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let last: Text | null = null;
    for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
      const len = t.data.length;
      if (pos.ch <= acc + len) return [t, pos.ch - acc];
      acc += len;
      last = t;
    }
    return last ? [last, last.data.length] : [el, 0];
  }

  private readSelection(): Selection2 | null {
    const s = this.doc.getSelection();
    if (!s || !s.rangeCount || !s.anchorNode || !s.focusNode) return null;
    if (!this.content.contains(s.anchorNode) || !this.content.contains(s.focusNode)) return null;
    const anchor = this.posFromDOM(s.anchorNode, s.anchorOffset);
    const head = this.posFromDOM(s.focusNode, s.focusOffset);
    return anchor && head ? { anchor, head } : null;
  }

  hasFocus(): boolean { return this.doc.activeElement === this.content; }

  focus(): void {
    this.content.focus({ preventScroll: true });
    const c = this.sel ?? { anchor: this.endPos(), head: this.endPos() };
    this.setSelection(this.clampPos(c.anchor), this.clampPos(c.head));
    this.revealCaret(false);
  }

  setSelection(anchor: Pos, head: Pos = anchor): void {
    this.sel = { anchor, head };
    this.updateActive(this.sel);
    this.expected = this.sel;
    const [an, ao] = this.domPoint(anchor);
    const [hn, ho] = this.domPoint(head);
    this.doc.getSelection()?.setBaseAndExtent(an, ao, hn, ho);
  }

  /* Lines that hold the caret show their Markdown marks; the rest hide them. */
  private updateActive(sel: Selection2 | null): boolean {
    const want = new Set<HTMLElement>();
    if (sel) {
      for (const p of [sel.anchor, sel.head]) { const el = this.lineEls[p.line]; if (el) want.add(el); }
    }
    let changed = false;
    for (const el of this.activeEls) if (!want.has(el)) { el.removeClass('mj-active'); changed = true; }
    for (const el of want) if (!this.activeEls.has(el)) { el.addClass('mj-active'); changed = true; }
    this.activeEls = want;
    return changed;
  }

  rectAt(pos: Pos): CaretRect | null {
    const [node, off] = this.domPoint(pos);
    const r = this.doc.createRange();
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).data.length;
      r.setStart(node, off);
      r.collapse(true);
      let rs = r.getClientRects();
      if (rs.length) return rs[rs.length - 1];
      if (off < len) {
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

  private revealCaret(animate: boolean): void {
    if (!this.sel || !this.laidOut) return;
    const r = this.rectAt(this.sel.head);
    if (!r) return;
    const s = Math.floor(this.pageOfRect(r) / this.n);
    if (s !== this.spread) this.showSpread(s, animate);
  }

  /* First caret position on page p (for flipping with the editor focused). */
  posAtPageStart(p: number): Pos {
    const els = this.lineEls;
    const pageOf = (r: CaretRect): number => this.pageOfRect(r);
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
    for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
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
      return this.posFromDOM(t, k) ?? { line: found, ch: 0 };
    }
    return { line: found, ch: 0 };
  }

  /* ---------- editing ---------- */

  private snapshot(): Snapshot {
    return { lines: this.lines.slice(), sel: this.sel ? { anchor: { ...this.sel.anchor }, head: { ...this.sel.head } } : null };
  }

  private pushUndo(kind: UndoKind): void {
    const now = Date.now();
    const coalesce = (kind === 'type' || kind === 'delete') && kind === this.lastUndoKind && now - this.lastUndoTime < 1200;
    this.lastUndoKind = kind;
    this.lastUndoTime = now;
    if (coalesce) return;
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this.snapshot());
    this.restore(snap);
  }

  redo(): void {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this.snapshot());
    this.restore(snap);
  }

  private restore(snap: Snapshot): void {
    this.lastUndoKind = null;
    this.lines = snap.lines;
    const sel = snap.sel ?? { anchor: this.endPos(), head: this.endPos() };
    this.commit(this.clampPos(sel.anchor), this.clampPos(sel.head));
  }

  private replaceRange(fromIn: Pos, toIn: Pos, text: string): Pos {
    const from = this.clampPos(fromIn);
    const to = this.clampPos(toIn);
    const before = this.lines[from.line].slice(0, from.ch);
    const after = this.lines[to.line].slice(to.ch);
    const parts = text.split('\n');
    const endCh = parts[parts.length - 1].length + (parts.length === 1 ? before.length : 0);
    parts[0] = before + parts[0];
    parts[parts.length - 1] += after;
    this.lines = this.lines.slice(0, from.line).concat(parts, this.lines.slice(to.line + 1));
    return { line: from.line + parts.length - 1, ch: endCh };
  }

  edit(a: Pos, b: Pos, text: string, kind: UndoKind): void {
    const [from, to] = ordered(a, b);
    this.pushUndo(kind === 'type' && !samePos(from, to) ? 'replace' : kind);
    const caret = this.replaceRange(from, to, text);
    this.commit(caret, caret);
  }

  private commit(anchor: Pos, head: Pos = anchor): void {
    this.syncDOM();
    if (this.hasFocus()) this.setSelection(anchor, head);
    else { this.sel = { anchor, head }; this.updateActive(this.sel); }
    this.measure();
    this.revealCaret(true);
    this.changed();
  }

  private changed(): void {
    this.scheduleWordCount();
    this.host.onChange?.();
  }

  private currentSel(): Selection2 | null {
    return this.readSelection() ?? this.sel;
  }

  private getRangeText(a: Pos, b: Pos): string {
    const [from, to] = ordered(a, b);
    if (from.line === to.line) return this.lines[from.line].slice(from.ch, to.ch);
    const out = [this.lines[from.line].slice(from.ch)];
    for (let l = from.line + 1; l < to.line; l++) out.push(this.lines[l]);
    out.push(this.lines[to.line].slice(0, to.ch));
    return out.join('\n');
  }

  private insertNewline(sel: Selection2, plain: boolean): void {
    const [from, to] = ordered(sel.anchor, sel.head);
    if (!plain && samePos(from, to)) {
      const line = this.lines[from.line];
      const next = continuationPrefix(line, this.kinds[from.line], from.ch);
      if (next === null && from.ch === line.length) { // Enter on an empty item ends the list
        this.edit({ line: from.line, ch: 0 }, { line: from.line, ch: line.length }, '', 'other');
        return;
      }
      if (next) { this.edit(from, to, '\n' + next, 'other'); return; }
    }
    this.edit(from, to, '\n', 'other');
  }

  private deleteBackward(sel: Selection2, unit: Unit): void {
    const [from, to] = ordered(sel.anchor, sel.head);
    if (!samePos(from, to)) { this.edit(from, to, '', 'other'); return; }
    const p = from;
    if (p.ch === 0) {
      if (p.line > 0) this.edit({ line: p.line - 1, ch: this.lines[p.line - 1].length }, p, '', 'delete');
      return;
    }
    const line = this.lines[p.line];
    const k = this.kinds[p.line];
    if (unit === 'char' && isList(k) && p.ch === k.prefix) {
      this.edit({ line: p.line, ch: k.indent.length }, p, '', 'other'); // Backspace right after "- " drops the bullet
      return;
    }
    const start = unit === 'word' ? prevWordStart(line, p.ch) : unit === 'line' ? 0 : prevBoundary(line, p.ch);
    this.edit({ line: p.line, ch: start }, p, '', 'delete');
  }

  private deleteForward(sel: Selection2, unit: Unit): void {
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

  private indent(sel: Selection2, outdent: boolean): void {
    const [from, to] = ordered(sel.anchor, sel.head);
    if (!outdent && samePos(from, to) && !isList(this.kinds[from.line])) { this.edit(from, to, '\t', 'other'); return; }
    this.pushUndo('other');
    const shift = new Map<number, number>();
    for (let l = from.line; l <= to.line; l++) {
      if (outdent) {
        const m = /^(\t| {1,4})/.exec(this.lines[l]);
        if (!m) continue;
        this.lines[l] = this.lines[l].slice(m[0].length);
        shift.set(l, -m[0].length);
      } else {
        this.lines[l] = '\t' + this.lines[l];
        shift.set(l, 1);
      }
    }
    const move = (p: Pos): Pos => ({ line: p.line, ch: Math.max(0, p.ch + (shift.get(p.line) ?? 0)) });
    this.commit(move(sel.anchor), move(sel.head));
  }

  private toggleWrap(marker: string): void {
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
  insertBlock(text: string): void {
    const sel = this.currentSel() ?? { anchor: this.endPos(), head: this.endPos() };
    this.content.focus({ preventScroll: true });
    const to = ordered(sel.anchor, sel.head)[1];
    const line = this.lines[to.line];
    if (!line.trim()) {
      this.edit({ line: to.line, ch: 0 }, { line: to.line, ch: line.length }, text + '\n', 'other');
    } else {
      this.edit({ line: to.line, ch: line.length }, { line: to.line, ch: line.length }, '\n' + text + '\n', 'other');
    }
  }

  private toggleTask(lineIdx: number): void {
    const k = this.kinds[lineIdx];
    if (k?.type !== 'task') return;
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

  private onBeforeInput(e: InputEvent): void {
    if (this.composing || e.isComposing || e.inputType === 'insertCompositionText') return;
    if (!e.cancelable) { this.pushUndo('type'); return; } // let it happen, read it back in onInput
    const sel = this.readSelection() ?? this.sel;
    e.preventDefault();
    if (!sel) return;
    const t = e.inputType;
    let range: [Pos, Pos] | null = null;
    const tr = e.getTargetRanges();
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
        const raw = e.data ?? e.dataTransfer?.getData('text/plain') ?? null;
        if (raw === null) return;
        const text = raw.replace(/\r\n?/g, '\n');
        const r: [Pos, Pos] = t === 'insertText' ? [from, to] : (range ?? [from, to]);
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

  private onInput(e: InputEvent): void {
    if (this.composing || e.isComposing) return;
    this.resyncFromDOM(); // only reached for input we could not intercept
  }

  private onCompositionStart(): void {
    this.pushUndo('type');
    this.composing = true;
  }

  private onCompositionEnd(): void {
    this.composing = false;
    this.resyncFromDOM();
  }

  /* The browser changed the DOM by itself (IME, some mobile keyboards): read the
     text back, then repaint so the DOM is ours again. */
  resyncFromDOM(): void {
    const s = this.doc.getSelection();
    const { lines, caret } = domToLines(this.content, s?.focusNode ?? null, s?.focusOffset ?? 0);
    const kids = this.content.childNodes;
    let intact = kids.length === this.lineEls.length && lines.length === this.lineEls.length;
    for (let i = 0; intact && i < kids.length; i++) if (kids[i] !== this.lineEls[i]) intact = false;
    if (intact) {
      let same = true;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== this.rendered[i]) {
          const m = this.lineMeta.get(this.lineEls[i]);
          if (m) m.text = null;
          same = false;
        }
      }
      if (same) return;
      this.rendered = lines.slice();
    } else {
      this.content.empty();
      this.lineEls = [];
      this.rendered = [];
      this.activeEls.clear();
    }
    this.lines = lines;
    const c = this.clampPos(caret ?? this.sel?.head ?? this.endPos());
    this.commit(c, c);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing || e.key === 'Process') return;
    const isMac = !!this.host.platform?.isMacOS;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const k = e.key;
    const stop = (): void => { e.preventDefault(); e.stopPropagation(); };
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

  private onSelectionChange(): void {
    if (this.composing) return;
    const sel = this.readSelection();
    if (!sel) return;
    const exp = this.expected;
    this.expected = null;
    if (!exp || !samePos(exp.anchor, sel.anchor) || !samePos(exp.head, sel.head)) this.lastUndoKind = null;
    this.sel = sel;
    if (this.updateActive(sel)) this.measure();
    this.revealCaret(true);
    this.host.onCaret?.(sel.head);
  }

  private onCopy(e: ClipboardEvent, cut: boolean): void {
    const sel = this.readSelection();
    if (!sel || samePos(sel.anchor, sel.head) || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', this.getRangeText(sel.anchor, sel.head));
    if (cut) this.edit(sel.anchor, sel.head, '', 'other');
  }

  private onPaste(e: ClipboardEvent): void {
    e.preventDefault();
    const dt = e.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.files).filter((f) => /^image\//.test(f.type));
    if (files.length && this.host.saveAttachment) { void this.insertFiles(files); return; }
    const text = dt.getData('text/plain');
    const sel = this.currentSel();
    if (!text || !sel) return;
    this.edit(sel.anchor, sel.head, text.replace(/\r\n?/g, '\n'), 'other');
  }

  private onDrop(e: DragEvent): void {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => /^image\//.test(f.type));
    if (!files.length || !this.host.saveAttachment) return; // text drops arrive as beforeinput
    e.preventDefault();
    const at = this.doc.caretPositionFromPoint(e.clientX, e.clientY);
    const pos = at ? this.posFromDOM(at.offsetNode, at.offset) : null;
    if (pos) { this.content.focus({ preventScroll: true }); this.setSelection(pos, pos); }
    void this.insertFiles(files);
  }

  private async insertFiles(files: File[]): Promise<void> {
    const save = this.host.saveAttachment;
    if (!save) return;
    const embeds: string[] = [];
    for (const f of files) {
      try {
        const md = await save(f);
        if (md) embeds.push(md);
      } catch (err) {
        console.error('MD Journal: could not save the attachment', err);
      }
    }
    const sel = this.sel;
    if (!embeds.length || !sel) return;
    const [from, to] = ordered(sel.anchor, sel.head);
    let text = embeds.join('\n');
    if (from.ch > 0) text = '\n' + text;
    if (to.ch < this.lines[to.line].length) text += '\n';
    this.edit(from, to, text, 'other');
  }

  private onContentMouseDown(e: MouseEvent): void {
    const t = e.target as Element | null;
    const chk = t?.closest('.mj-check') ?? null;
    if (chk && this.content.contains(chk)) {
      e.preventDefault();
      const el = this.lineElOf(chk);
      if (el) this.toggleTask(this.lineIndex(el));
      return;
    }
    const link = t?.closest<HTMLElement>('.mj-link') ?? null;
    const href = link?.dataset.href;
    if (href && (e.ctrlKey || e.metaKey) && this.host.openLink) {
      e.preventDefault();
      this.host.openLink(href, e.shiftKey || e.altKey);
    }
  }

  /* A click on paper where there is no text (below the last line of a page, or a
     blank page) puts the caret at the end of the writing on that page. */
  private onPaperMouseDown(e: MouseEvent): void {
    e.preventDefault();
    const paper = (e.target as Element | null)?.closest<HTMLDivElement>('.mj-paper') ?? null;
    const page = paper ? this.paperEls.indexOf(paper) : -1;
    this.content.focus({ preventScroll: true });
    let pos: Pos;
    if (page < 0 || page >= this.totalPages - 1) pos = this.endPos();
    else {
      pos = this.posAtPageStart(page + 1);
      if (pos.ch > 0) pos = { line: pos.line, ch: prevBoundary(this.lines[pos.line], pos.ch) };
      else if (pos.line > 0) pos = { line: pos.line - 1, ch: this.lines[pos.line - 1].length };
    }
    this.setSelection(pos, pos);
    this.revealCaret(true);
  }

  private onWheel(e: WheelEvent): void {
    if (e.ctrlKey) return;
    e.preventDefault();
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 6) return;
    const now = Date.now();
    if (now - this.lastWheel < 450) return;
    this.lastWheel = now;
    this.flip(d > 0 ? 1 : -1);
  }

  private onTouchStart(e: TouchEvent): void {
    const t = e.touches[0];
    this.touch = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, time: Date.now() } : null;
  }

  private onTouchEnd(e: TouchEvent): void {
    const s = this.touch;
    this.touch = null;
    const t = e.changedTouches[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    const sel = this.doc.getSelection();
    if (sel && !sel.isCollapsed) return; // the user was selecting text
    if (Date.now() - s.time < 500 && Math.abs(dx) > 60 && Math.abs(dy) < 45) this.flip(dx < 0 ? 1 : -1);
  }
}
