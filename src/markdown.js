/*
 * Markdown, one line at a time — pure functions, no DOM and no Obsidian API.
 *
 * Lines render to a small node tree instead of HTML: a node is either a string
 * (a text node) or { cls, kids, tag?, attrs? } (an element). Every character of
 * the source line ends up in exactly one text node, in order, so the editor can
 * rely on a line element's textContent being exactly its Markdown source.
 */

const RE_FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const RE_HEADING = /^(#{1,6})[ \t]+/;
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_TASK = /^([ \t]*)([-*+])([ \t]+)\[([ xX])\]([ \t]+|$)/;
const RE_UL = /^([ \t]*)([-*+])([ \t]+)/;
const RE_OL = /^([ \t]*)(\d{1,9})([.)])([ \t]+)/;
const RE_QUOTE = /^(?:[ \t]*>[ \t]?)+/;
const RE_PAGEBREAK = /^\s*<!--\s*page-?break\s*-->\s*$/i;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const RE_IMAGE_WIKI = /^\s*!\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/;
const RE_IMAGE_MD = /^\s*!\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)\s*$/;

export function splitFrontmatter(text) {
  const m = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { front: '', body: text };
  return { front: m[0], body: text.slice(m[0].length) };
}

export function lineKind(t) {
  if (!t.trim()) return { type: 'blank', key: 'blank' };
  if (RE_PAGEBREAK.test(t)) return { type: 'pagebreak', key: 'pagebreak' };
  let m = RE_IMAGE_WIKI.exec(t) || RE_IMAGE_MD.exec(t);
  if (m && (IMAGE_EXT.test(m[1]) || /^https?:/i.test(m[1]))) {
    return { type: 'image', src: m[1], key: 'image' };
  }
  if ((m = RE_HEADING.exec(t))) {
    const level = m[1].length;
    return { type: 'h', level, prefix: m[0].length, key: 'h' + level };
  }
  if (RE_HR.test(t)) return { type: 'hr', key: 'hr' };
  if ((m = RE_TASK.exec(t))) {
    const checkAt = m[1].length + m[2].length + m[3].length;
    const checked = m[4] !== ' ';
    return { type: 'task', indent: m[1], checkAt, checked, prefix: m[0].length, key: 'task' + (checked ? 'x' : '') };
  }
  if ((m = RE_UL.exec(t))) return { type: 'ul', indent: m[1], prefix: m[0].length, key: 'ul' };
  if ((m = RE_OL.exec(t))) {
    return { type: 'ol', indent: m[1], num: Number(m[2]), delim: m[3], space: m[4], prefix: m[0].length, key: 'ol' };
  }
  if ((m = RE_QUOTE.exec(t))) return { type: 'quote', prefix: m[0].length, key: 'quote' };
  return { type: 'p', key: 'p' };
}

export function computeKinds(lines) {
  const out = new Array(lines.length);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const f = RE_FENCE.exec(t);
    if (fence) {
      if (f && f[2][0] === fence.ch && f[2].length >= fence.len && !f[3].trim()) {
        out[i] = { type: 'fence', key: 'fence' };
        fence = null;
      } else {
        out[i] = { type: 'code', key: 'code' };
      }
      continue;
    }
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) {
      fence = { ch: f[2][0], len: f[2].length };
      out[i] = { type: 'fence', key: 'fence', lang: (f[3].trim().split(/\s+/)[0] || '').toLowerCase() };
      continue;
    }
    out[i] = lineKind(t);
  }
  return out;
}

/* ---------- node tree ---------- */

const span = (cls, kids, attrs) => (attrs ? { cls, kids, attrs } : { cls, kids });
const mark = (s) => span('mj-mark', [s]);
const link = (text, href, cls = 'mj-link') => span(cls, [text], { 'data-href': href });
const BR = { tag: 'br' };

/* The source text of a node tree (what the DOM's textContent will be). */
export function nodesText(nodes) {
  let s = '';
  for (const n of nodes) s += typeof n === 'string' ? n : n.kids ? nodesText(n.kids) : '';
  return s;
}

/* A compact, stable string for a node tree — used as a repaint key. */
export function nodesKey(nodes) {
  let s = '';
  for (const n of nodes) {
    if (typeof n === 'string') s += JSON.stringify(n);
    else s += '<' + (n.tag || '') + '.' + (n.cls || '') + (n.attrs ? JSON.stringify(n.attrs) : '') + (n.kids ? nodesKey(n.kids) : '') + '>';
  }
  return s;
}

const isWordChar = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);

const RE_CODE_SPAN = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/y;
const RE_WIKILINK = /(!?\[\[)([^[\]\n]+?)(\]\])/y;
const RE_MDLINK = /(!?\[)([^[\]\n]*)(\]\()([^()\n]*)(\))/y;
const RE_STRONG = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/y;
const RE_STRIKE = /~~(?=\S)([\s\S]*?\S)~~/y;
const RE_HIGHLIGHT = /==(?=\S)([\s\S]*?\S)==/y;
const RE_EM = /([*_])(?=[^\s*_])([\s\S]*?[^\s*_]|[^\s*_])\1/y;
const RE_TAG = /#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*/uy;
const RE_URL = /https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/y;

function at(re, s, i) {
  re.lastIndex = i;
  return re.exec(s);
}

/* One line of inline Markdown: bold, italic, code, links, tags… with their marks. */
export function renderInline(s) {
  const out = [];
  let buf = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const prev = i > 0 ? s[i - 1] : '';
    let m = null;
    let nodes = null;
    if (c === '`' && (m = at(RE_CODE_SPAN, s, i))) {
      nodes = [mark(m[1]), span('mj-ic', [m[2]]), mark(m[1])];
    } else if ((c === '[' || c === '!') && (m = at(RE_WIKILINK, s, i))) {
      const inner = m[2];
      const bar = inner.indexOf('|');
      const cls = m[1][0] === '!' ? 'mj-link mj-embed' : 'mj-link';
      nodes = bar >= 0
        ? [mark(m[1]), mark(inner.slice(0, bar + 1)), link(inner.slice(bar + 1), inner.slice(0, bar), cls), mark(m[3])]
        : [mark(m[1]), link(inner, inner, cls), mark(m[3])];
    } else if ((c === '[' || c === '!') && (m = at(RE_MDLINK, s, i))) {
      nodes = [mark(m[1]), link(m[2], m[4]), mark(m[3] + m[4] + m[5])];
    } else if ((c === '*' || c === '_') && (m = at(RE_STRONG, s, i)) && (c === '*' || !isWordChar(prev))) {
      nodes = [mark(m[1]), span('mj-b', renderInline(m[2])), mark(m[1])];
    } else if (c === '~' && (m = at(RE_STRIKE, s, i))) {
      nodes = [mark('~~'), span('mj-s', renderInline(m[1])), mark('~~')];
    } else if (c === '=' && (m = at(RE_HIGHLIGHT, s, i))) {
      nodes = [mark('=='), span('mj-hlt', renderInline(m[1])), mark('==')];
    } else if ((c === '*' || c === '_') && (m = at(RE_EM, s, i))
      && (c === '*' || (!isWordChar(prev) && !isWordChar(s[i + m[0].length])))) {
      nodes = [mark(m[1]), span('mj-i', renderInline(m[2])), mark(m[1])];
    } else if (c === '#' && (!prev || /\s/.test(prev)) && (m = at(RE_TAG, s, i))) {
      nodes = [span('mj-tag', [m[0]])];
    } else if (c === 'h' && !isWordChar(prev) && (m = at(RE_URL, s, i))) {
      nodes = [link(m[0], m[0])];
    }
    if (nodes) {
      if (buf) { out.push(buf); buf = ''; }
      out.push(...nodes);
      i += m[0].length;
    } else {
      buf += c;
      i++;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function renderLine(text, k, resolveImage) {
  const orBr = (nodes) => (nodes.length ? nodes : [BR]);
  const pre = (s) => (s ? [s] : []);
  switch (k.type) {
    case 'code':
      if (k.nodes) return orBr(k.nodes);
      return text ? [text] : [BR];
    case 'blank':
      return text ? [text] : [BR];
    case 'fence':
    case 'pagebreak':
      return [mark(text)];
    case 'hr':
      return [span('mj-hr-src', [text])];
    case 'h':
    case 'quote':
      return [mark(text.slice(0, k.prefix)), ...renderInline(text.slice(k.prefix))];
    case 'ul':
      return [...pre(k.indent), span('mj-bullet', [text.slice(k.indent.length, k.prefix)]), ...renderInline(text.slice(k.prefix))];
    case 'ol':
      return [...pre(k.indent), span('mj-olmark', [text.slice(k.indent.length, k.prefix)]), ...renderInline(text.slice(k.prefix))];
    case 'task':
      return [...pre(k.indent), mark(text.slice(k.indent.length, k.checkAt)), span('mj-check', [text.slice(k.checkAt, k.checkAt + 3)]),
        ...pre(text.slice(k.checkAt + 3, k.prefix)), ...renderInline(text.slice(k.prefix))];
    case 'image': {
      const src = resolveImage ? resolveImage(k.src) : null;
      const nodes = [span('mj-imgsrc', [text])];
      if (src) nodes.push({ tag: 'img', cls: 'mj-img', attrs: { src, alt: '', contenteditable: 'false', draggable: 'false' } });
      return nodes;
    }
    default:
      return orBr(renderInline(text));
  }
}

export function lineClass(k) {
  let c = 'mj-line mj-' + k.type;
  if (k.type === 'h') c += ' mj-h' + k.level;
  if (k.type === 'task' && k.checked) c += ' mj-task-done';
  return c;
}

/* ---------- code highlighting ---------- */

const PRISM_ALIASES = {
  ps1: 'powershell', ps: 'powershell', pwsh: 'powershell', sh: 'bash', shell: 'bash', zsh: 'bash', js: 'javascript',
  ts: 'typescript', py: 'python', 'c++': 'cpp', cs: 'csharp', 'c#': 'csharp', md: 'markdown', yml: 'yaml',
  html: 'markup', xml: 'markup', svg: 'markup', rb: 'ruby', rs: 'rust', kt: 'kotlin',
};

/* Highlights a fenced block with Prism and splits the tokens back into one node
   list per source line (tokens may span lines, e.g. here-strings). */
export function prismLines(Prism, code, lang) {
  if (!Prism || !Prism.languages || !Prism.tokenize) return null;
  const grammar = Prism.languages[lang] || Prism.languages[PRISM_ALIASES[lang]];
  if (!grammar) return null;
  let tokens;
  try { tokens = Prism.tokenize(code, grammar); } catch { return null; }
  const lines = [[]];
  const walk = (tok, cls) => {
    if (typeof tok === 'string') {
      tok.split('\n').forEach((part, i) => {
        if (i) lines.push([]);
        if (part) lines[lines.length - 1].push(cls ? span(cls, [part]) : part);
      });
    } else if (Array.isArray(tok)) {
      for (const t of tok) walk(t, cls);
    } else if (tok) {
      const own = 'token ' + tok.type + (tok.alias ? ' ' + [].concat(tok.alias).join(' ') : '');
      walk(tok.content, cls ? cls + ' ' + own : own);
    }
  };
  walk(tokens, '');
  return lines;
}

/* ---------- editing helpers ---------- */

/* What a new line after `line` should start with (list continuation). Returns
   null when Enter should end the list instead, '' for a plain new line. */
export function continuationPrefix(line, k, ch) {
  if (!k || !['ul', 'ol', 'task', 'quote'].includes(k.type) || ch < k.prefix) return '';
  if (!line.slice(k.prefix).trim()) return null;
  if (k.type === 'task') return line.slice(0, k.checkAt) + '[ ] ';
  if (k.type === 'ol') return k.indent + (k.num + 1) + k.delim + k.space;
  return line.slice(0, k.prefix);
}

let graphemes = null;
function segmenter() {
  if (graphemes === null) {
    graphemes = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : false;
  }
  return graphemes;
}

export function prevBoundary(s, ch) {
  if (ch <= 0) return 0;
  const seg = segmenter();
  if (seg) {
    const base = Math.max(0, ch - 64);
    let last = base;
    for (const x of seg.segment(s.slice(base, ch))) last = base + x.index;
    return last;
  }
  const c = s.charCodeAt(ch - 1);
  return c >= 0xdc00 && c <= 0xdfff && ch >= 2 ? ch - 2 : ch - 1;
}

export function nextBoundary(s, ch) {
  if (ch >= s.length) return s.length;
  const seg = segmenter();
  if (seg) {
    for (const x of seg.segment(s.slice(ch, ch + 64))) return ch + x.segment.length;
  }
  const c = s.charCodeAt(ch);
  return c >= 0xd800 && c <= 0xdbff && ch + 2 <= s.length ? ch + 2 : ch + 1;
}

const isSpace = (c) => /\s/.test(c);
export function prevWordStart(s, ch) {
  let i = ch;
  while (i > 0 && isSpace(s[i - 1])) i--;
  if (i > 0 && isWordChar(s[i - 1])) while (i > 0 && isWordChar(s[i - 1])) i--;
  else while (i > 0 && !isWordChar(s[i - 1]) && !isSpace(s[i - 1])) i--;
  return i;
}

export function nextWordEnd(s, ch) {
  let i = ch;
  while (i < s.length && isSpace(s[i])) i++;
  if (i < s.length && isWordChar(s[i])) while (i < s.length && isWordChar(s[i])) i++;
  else while (i < s.length && !isWordChar(s[i]) && !isSpace(s[i])) i++;
  return i;
}

export function countWords(text) {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return m ? m.length : 0;
}
