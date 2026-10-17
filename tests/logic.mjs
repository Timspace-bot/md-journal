// Pure-logic tests: npm test (no Obsidian, no DOM).
import assert from 'node:assert/strict';
import {
  renderInline, renderLine, computeKinds, lineKind, splitFrontmatter, continuationPrefix, prevBoundary, nextBoundary,
  prevWordStart, nextWordEnd, countWords, prismLines, nodesText, nodesKey,
} from '../src/markdown';
import { pageGeometry, screenGeometry } from '../src/geometry';
import { DEFAULT_SETTINGS, PAGE_SIZES } from '../src/constants';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error('FAIL ' + name); throw e; }
};
const has = (nodes, cls) => JSON.stringify(nodes).includes('"cls":"' + cls + '"');

test('inline rendering keeps every source character, in order', () => {
  const samples = [
    'plain text', '**bold** and *italic* and _under_ and __strong__', 'a `code` span with ``double `tick``',
    '[[Note]] and [[Note|alias]] and ![[embed.png]]', '[text](https://example.com/a_(b)) after',
    '~~gone~~ ==marked== #tag #2024 not#tag', 'snake_case_word and 2*3*4', 'https://obsidian.md/x?y=1, then',
    '**unclosed and *also', '<b>& "quotes"</b><script>alert(1)</script>', '***both***', 'emoji 👩‍👩‍👧 and ✍️', '',
  ];
  for (const s of samples) assert.equal(nodesText(renderInline(s)), s, s);
});

test('inline rendering recognises the usual Markdown', () => {
  assert.ok(has(renderInline('**b**'), 'mj-b'));
  assert.ok(has(renderInline('*i*'), 'mj-i'));
  assert.ok(has(renderInline('a `c` d'), 'mj-ic'));
  assert.match(JSON.stringify(renderInline('[[Page|Alias]]')), /"kids":\["Alias"\],"attrs":\{"data-href":"Page"\}/);
  assert.ok(has(renderInline('see #idea'), 'mj-tag'));
  assert.ok(!has(renderInline('snake_case_word'), 'mj-i'));
  assert.ok(!has(renderInline('issue #12'), 'mj-tag'));
  // markup in the text stays text: there is no element for it
  assert.deepEqual(renderInline('<b>x</b>'), ['<b>x</b>']);
});

test('every line kind renders back to its exact source', () => {
  const lines = ['# Title', '## Monday', '- item', '  * nested', '1. first', '- [ ] todo', '- [x] done', '> quote',
    '> > deeper', '---', '```js', 'const a = 1 < 2;', '```', '<!-- pagebreak -->', '![[photo.jpg]]', '![alt](pic.png)', '', '   ', 'text'];
  const kinds = computeKinds(lines);
  lines.forEach((l, i) => assert.equal(nodesText(renderLine(l, kinds[i], () => 'app://img')), l, l));
  assert.deepEqual(renderLine('', kinds[16]), [{ tag: 'br' }]);
  assert.ok(JSON.stringify(renderLine('![[photo.jpg]]', kinds[14], () => 'app://img')).includes('"tag":"img"'));
});

test('line kinds', () => {
  const k = computeKinds(['# H', 'text', '```', '# not heading', '```', '- [x] t', '3) n', '#tag']);
  assert.deepEqual(k.map((x) => x.type), ['h', 'p', 'fence', 'code', 'fence', 'task', 'ol', 'p']);
  assert.equal(k[5].checked, true);
  assert.equal(k[6].num, 3);
  assert.equal(lineKind('![[a.pdf]]').type, 'p');
  assert.equal(lineKind('![[a.PNG|200]]').type, 'image');
  assert.equal(lineKind('<!-- page-break -->').type, 'pagebreak');
  assert.equal(computeKinds(['```PowerShell extra', 'x', '```'])[0].lang, 'powershell');
});

test('frontmatter is kept apart and round-trips', () => {
  const t = '---\ntags: [a]\n---\n# Entry\n';
  const { front, body } = splitFrontmatter(t);
  assert.equal(front, '---\ntags: [a]\n---\n');
  assert.equal(front + body, t);
  assert.equal(splitFrontmatter('---\n---\nx').body, 'x');
  assert.equal(splitFrontmatter('no front\n---\n').front, '');
  assert.equal(splitFrontmatter('---\r\na: 1\r\n---\r\nbody').body, 'body');
});

test('list continuation on Enter', () => {
  const cont = (line) => continuationPrefix(line, lineKind(line), line.length);
  assert.equal(cont('- milk'), '- ');
  assert.equal(cont('\t* eggs'), '\t* ');
  assert.equal(cont('9. nine'), '10. ');
  assert.equal(cont('- [x] done'), '- [ ] ');
  assert.equal(cont('> said'), '> ');
  assert.equal(cont('- '), null);
  assert.equal(cont('plain'), '');
  assert.equal(continuationPrefix('- milk', lineKind('- milk'), 1), '');
});

test('grapheme and word boundaries', () => {
  const s = 'ab 👩‍👩‍👧 cd';
  const afterEmoji = 3 + '👩‍👩‍👧'.length;
  assert.equal(prevBoundary(s, afterEmoji), 3);
  assert.equal(nextBoundary(s, 3), afterEmoji);
  assert.equal(prevWordStart('hello wor', 9), 6);
  assert.equal(prevWordStart('end.  ', 6), 3);
  assert.equal(nextWordEnd('one two', 3), 7);
  assert.equal(countWords('Dear diary — it’s 3 o’clock.'), 5);
});

test('journal page geometry keeps the writing on whole lines', () => {
  for (const pageSize of Object.keys(PAGE_SIZES).filter((k) => k !== 'custom')) {
    for (const fontSize of [11, 15, 22]) {
      const g = pageGeometry({ ...DEFAULT_SETTINGS, pageSize, fontSize });
      assert.equal(g.contentH % g.lh, 0);
      assert.ok(g.top + g.contentH + g.bottom === g.H && g.bottom >= g.top);
      assert.equal(g.colW + g.gap, g.W);
    }
  }
});

test('theme view geometry fills the pane', () => {
  const s = { ...DEFAULT_SETTINGS };
  assert.equal(s.layout, 'screen');
  const wide = screenGeometry(1700, 800, s, 16, false);
  assert.equal(wide.n, 2);
  assert.ok(wide.colW <= s.screenMaxWidth && wide.W === wide.colW + wide.gap);
  assert.ok(wide.n * wide.colW + (wide.n - 1) * wide.gap <= 1700);
  assert.equal(wide.top + wide.contentH + wide.bottom, wide.H);
  assert.equal(screenGeometry(700, 800, s, 16, false).n, 1);
  assert.equal(screenGeometry(1700, 800, s, 16, true).n, 1);
  assert.equal(screenGeometry(1700, 800, { ...s, screenMaxWidth: 0 }, 16, false).colW, Math.floor((1700 - 112 - 64) / 2));
});

test('code highlighting keeps each line\'s text', () => {
  const Prism = {
    languages: { powershell: {} },
    tokenize: () => [{ type: 'variable', content: '$s' }, ' = ', { type: 'string', content: ["@'\nhere", { type: 'x', content: '<b>' }, "\n'@"] }],
  };
  const code = "$s = @'\nhere<b>\n'@";
  const lines = prismLines(Prism, code, 'ps1');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map(nodesText), code.split('\n'));
  assert.ok(has(lines[1], 'token string token x'));
  assert.equal(prismLines(Prism, code, 'cobol'), null);
  assert.notEqual(nodesKey(lines[0]), nodesKey(lines[1]));
});

console.log('logic: ' + passed + ' passed');
