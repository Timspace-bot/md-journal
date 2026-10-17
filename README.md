# MD Journal

Write in your Obsidian notes as if they were a journal.

MD Journal shows a note as **book pages**, one page or a two-page spread, and lets you
**write directly on them**. When a page fills up, your words carry on at the top of the
next page, mid-sentence if needed. When the spread is full, the book turns to a fresh one.
Nothing scrolls.

By default the pages use your normal Obsidian theme. Turn on **Fixed page** to keep the
same amount of text on every page whatever the window size: the page scales to fit
instead of re-flowing, so page breaks stay put. For a paper notebook, switch the layout to
**Journal pages**: ruled or dotted paper at a real size (A5 by default).

The note stays ordinary Markdown. Whatever you type is saved to the file as you wrote it,
and the regular editor, sync, search and links all keep working.

## Features

- **Pages that fill and continue.** Text flows from the bottom of one page to the top of
  the next as you type, delete or paste. The book follows the caret onto the next page or
  spread with a page turn.
- **Theme view (default).** Columns fill the pane in your theme's colours and font, with
  page buttons at the sides. The page is cut to fit the pane, so page breaks move when you
  resize, and the view keeps the caret's place.
- **Fixed page.** In the theme view, this keeps the text area of a page constant (A6 to
  A4, or a custom size) in your theme font. Resizing the window only scales the page, so
  every page always holds the same text.
- **Journal pages.** A paper notebook: A6 pocket, B6, A5, half letter, B5, A4 or a custom
  size in millimetres, in a two-page spread with a spine shadow. Ruled, dot grid, squared
  or plain paper in white, cream, sepia, gray, night or your theme's colours. Every line
  takes a whole number of rulings, so the writing stays on the lines. Big headings sit in
  a blank band, like the title space of a journal page.
- **Live preview.** `**bold**`, `*italic*`, headings, links, highlights and tags show as
  formatting. Their Markdown marks appear only on the line you are writing. Bullets and
  checkboxes are drawn in place, and you can click a checkbox to tick it.
- **Highlighted code blocks.** Fenced code with a language is coloured by Obsidian's own
  Prism, as in the reading view.
- **Writing aids.** Enter continues lists, quotes and task lists, and Enter on an empty
  item ends the list. Tab and Shift+Tab indent. **Insert date heading** starts today's
  entry. **Insert page break** (`<!-- pagebreak -->`) starts a new page, and the setting
  *New page for each top-level heading* gives every `# ` heading a page of its own.
- **Pictures.** Paste or drop an image: it is saved as an attachment, following your
  attachment settings, and shown on the page.
- **Undo and formatting keys.** Ctrl/Cmd+Z, and Ctrl/Cmd+Shift+Z or Ctrl+Y, undo and
  redo, with typing grouped as in an editor. Ctrl/Cmd+B and Ctrl/Cmd+I toggle bold and
  italic.
- **Turning pages.** Use the ‹ › buttons, PageUp and PageDown, the mouse wheel, or a swipe
  on touch screens. If the page has focus, the caret moves to the top of the new page.
  Clicking blank paper puts the caret at the end of the writing on that page.
- **Autosave.** The note is saved shortly after you stop typing. Changes made elsewhere in
  Obsidian show up in the journal; if both sides change at once, what you are typing in
  the journal is kept. Frontmatter (properties) is never shown on the page and is never
  lost.

## How to use

- Click the **book icon** in the left ribbon to open your journal note (`Journal.md` by
  default, created if needed). The caret starts at the end, ready for a new entry.
- To open any note as a journal, right-click it and choose **Open as journal**, or run
  **Open current note as journal**.
- Buttons in the view header:
  - **Pencil:** switches the tab to Obsidian's normal editor.
  - **Aa:** page settings.
  - **Monitor:** switches between the theme view and journal pages.

### Commands

| Command | What it does |
| --- | --- |
| Open journal | Opens the journal note from the settings. |
| Open current note as journal | Opens the active note as book pages. |
| Toggle between journal and editor | Switches the tab between the journal and the Markdown editor. |
| Insert date heading | Adds `## <today>` on its own line (format in settings). |
| Insert page break | Ends the page here; the writing continues on the next page. |
| Next page / Previous page | Turns the pages. |
| Journal appearance | Layout, page size, paper, colours and type. |
| Switch between theme view and journal pages | Toggles the layout. |
| Toggle fixed page in the theme view | Same text per page at any window size, or pages that fill the window. |

## Settings

| Setting | What it does |
| --- | --- |
| Journal note | The note the ribbon button opens. |
| Open at | The end of the journal (default) or where you left off. |
| Open in | New tab, current tab or split. |
| Date heading format | Moment.js format used by *Insert date heading*. |
| Spellcheck, page-turn animation | On or off. |
| Layout | Theme view (default) or journal pages on paper. |
| Columns, max column width | Theme view: one or two columns, and how wide they may get. |
| Fixed page, page size, margins | Theme view: keep a constant page and scale it to the window. |
| Pages, paper, paper colour, font, font size | Journal pages: the notebook's look. |
| Line spacing, hide Markdown marks | Both layouts. |
| Page numbers | Journal pages: shown in the outer corner of each page. |
| New page for each top-level heading | Every `# ` heading starts on a new page. |

## Privacy

MD Journal works entirely offline. It makes no network requests, collects no data, and
only reads and writes notes and attachments inside your vault.

## Limitations

- Tables, callouts, embeds of other notes and HTML are shown as their Markdown source, not
  rendered.
- An image taller than a page is shrunk to fit one page.
- On phones the on-screen keyboard shrinks the space for the page, so the page is scaled
  down while you type.

## How it works

The page is a `contenteditable` surface laid out with CSS columns at a fixed height, one
column per page. The browser's own text layout therefore decides where a page ends, and
text that no longer fits moves to the next column by itself.

The Markdown source, an array of lines, is the only document model. Edits are intercepted
(`beforeinput`, clipboard and keyboard events), applied to the model, and only the changed
lines are rebuilt with DOM calls. No HTML is parsed, and nothing is converted back from
HTML. IME composition (CJK input, many mobile keyboards) can't be intercepted, so the
browser types it and the changed lines are read back into the model.

Large notes stay responsive. A 536-page note (600k characters) took about 8 ms per
keystroke in Chromium.

## Installation

Until MD Journal is listed in **Community plugins**:

- **With BRAT:** add `Timspace-bot/md-journal` in the BRAT plugin.
- **By hand:** download `main.js`, `manifest.json` and `styles.css` from the
  [latest release](https://github.com/Timspace-bot/md-journal/releases/latest) into
  `<your vault>/.obsidian/plugins/md-journal/`, then enable **MD Journal** under
  Settings → Community plugins.

## Development

```
npm install
npm run build     # src/ -> main.js (esbuild)
npm run dev       # rebuild on change
npm run lint      # Obsidian's official ESLint rules
npm test          # Markdown, page geometry and code highlighting logic
npm run harness   # http://localhost:5178/tests/harness.html — the editor in a browser
```

The harness bundles the real source with a small stand-in for the `obsidian` module. It
offers switches for layout, fixed page, dark theme, page mode, paper colour and paper
style.

Releases are built by GitHub Actions: pushing a tag such as `0.1.0` builds `main.js` and
attaches it to a GitHub release with `manifest.json` and `styles.css`.

## Credits

Inspired by [MD Reader](https://github.com/mrrepac/obsidian-md-reader) by mrrepac, which
shows notes as e-book pages for reading. MD Journal is a separate project with its own
code, built for writing.

## License

[MIT](LICENSE) © Timspace-bot
