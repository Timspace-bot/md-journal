import type { Pos } from './constants';
import type { MdNode } from './markdown';

/* Builds a node tree from markdown.ts into `parent` with Obsidian's DOM helpers
   (no HTML parsing: all text goes in as text nodes). */
export function appendNodes(parent: HTMLElement, nodes: MdNode[]): void {
  for (const n of nodes) {
    if (typeof n === 'string') {
      parent.appendText(n);
      continue;
    }
    const el = parent.createEl(n.tag ?? 'span', { cls: n.cls, attr: n.attrs });
    if (n.kids) appendNodes(el, n.kids);
  }
}

/* Reads a contenteditable DOM back into lines: block elements and <br> break
   lines, a trailing <br> in a block is only a placeholder. Also locates (fNode,
   fOff) as a { line, ch } position. */
export function domToLines(root: Node, fNode: Node | null, fOff: number): { lines: string[]; caret: Pos | null } {
  const lines: string[] = [];
  let cur: string | null = null;
  const found: { caret: Pos | null } = { caret: null };
  const here = (): Pos => ({ line: lines.length, ch: cur === null ? 0 : cur.length });
  const isBlock = (n: Node): boolean => n.nodeName === 'DIV' || n.nodeName === 'P' || n.nodeName === 'LI';
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      if (cur === null) cur = '';
      if (node === fNode) found.caret = { line: lines.length, ch: cur.length + Math.min(fOff, data.length) };
      cur += data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.nodeName === 'BR') {
      const parent = node.parentNode;
      const placeholder = !node.nextSibling && !!parent && parent !== root && isBlock(parent);
      if (!placeholder) { lines.push(cur ?? ''); cur = ''; }
      return;
    }
    const block = isBlock(node);
    if (block && cur !== null) lines.push(cur);
    if (block) cur = '';
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (node === fNode && i === fOff && !found.caret) found.caret = here();
      visit(kids[i]);
    }
    if (node === fNode && fOff >= kids.length && !found.caret) found.caret = here();
    if (block) { lines.push(cur ?? ''); cur = null; }
  };
  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i++) {
    if (root === fNode && i === fOff && !found.caret) found.caret = here();
    visit(kids[i]);
  }
  if (cur !== null) lines.push(cur);
  if (!lines.length) lines.push('');
  let caret = found.caret;
  if (caret && caret.line >= lines.length) caret = { line: lines.length - 1, ch: lines[lines.length - 1].length };
  return { lines, caret };
}
