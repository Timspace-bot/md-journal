/* Builds a node tree from markdown.js into `parent` with plain DOM calls (no HTML
   parsing: all text goes in as text nodes). */
export function appendNodes(parent, nodes) {
  const doc = parent.ownerDocument;
  for (const n of nodes) {
    if (typeof n === 'string') {
      parent.appendChild(doc.createTextNode(n));
      continue;
    }
    const el = doc.createElement(n.tag || 'span');
    if (n.cls) el.className = n.cls;
    if (n.attrs) for (const k of Object.keys(n.attrs)) el.setAttribute(k, n.attrs[k]);
    if (n.kids) appendNodes(el, n.kids);
    parent.appendChild(el);
  }
}

/* Reads a contenteditable DOM back into lines: block elements and <br> break
   lines, a trailing <br> in a block is only a placeholder. Also locates (fNode,
   fOff) as a { line, ch } position. */
export function domToLines(root, fNode, fOff) {
  const lines = [];
  let cur = null;
  let caret = null;
  const here = () => ({ line: lines.length, ch: cur === null ? 0 : cur.length });
  const isBlock = (n) => n.nodeName === 'DIV' || n.nodeName === 'P' || n.nodeName === 'LI';
  const visit = (node) => {
    if (node.nodeType === 3) {
      if (cur === null) cur = '';
      if (node === fNode) caret = { line: lines.length, ch: cur.length + Math.min(fOff, node.data.length) };
      cur += node.data;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.nodeName === 'BR') {
      const placeholder = !node.nextSibling && node.parentNode && node.parentNode !== root && isBlock(node.parentNode);
      if (!placeholder) { lines.push(cur === null ? '' : cur); cur = ''; }
      return;
    }
    const block = isBlock(node);
    if (block && cur !== null) lines.push(cur);
    if (block) cur = '';
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (node === fNode && i === fOff && !caret) caret = here();
      visit(kids[i]);
    }
    if (node === fNode && fOff >= kids.length && !caret) caret = here();
    if (block) { lines.push(cur); cur = null; }
  };
  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i++) {
    if (root === fNode && i === fOff && !caret) caret = here();
    visit(kids[i]);
  }
  if (cur !== null) lines.push(cur);
  if (!lines.length) lines.push('');
  if (caret && caret.line >= lines.length) caret = { line: lines.length - 1, ch: lines[lines.length - 1].length };
  return { lines, caret };
}
