# Contributing to MD Journal

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/Timspace-bot/md-journal/issues) with:

- your Obsidian version and platform (Windows, macOS, Linux, iOS, Android);
- the layout you were using (theme view, fixed page or journal pages);
- what you did, what you expected, and what happened;
- if the text or a page break looks wrong, a short sample of the Markdown that shows it.

Errors from the developer console (Ctrl/Cmd+Shift+I) help a lot.

## Working on the code

The plugin is TypeScript, bundled with esbuild into `main.js`.

```
npm install
npm run dev        # rebuild main.js on every change
npm run build      # type-check, then a production build
npm run lint       # Obsidian's official ESLint rules (the same ones the community directory uses)
npm test           # logic tests: Markdown rendering, page geometry, code highlighting
npm run harness    # the editor in a browser: http://localhost:5178/tests/harness.html
```

To try a build in Obsidian, copy `main.js`, `manifest.json` and `styles.css` into
`<your vault>/.obsidian/plugins/md-journal/` and reload Obsidian.

### Where things are

| File | What it does |
| --- | --- |
| `src/main.ts` | The plugin: commands, ribbon button, opening notes as journals. |
| `src/view.ts` | The Obsidian view: loading, autosaving, attachments and links. |
| `src/editor.ts` | The page editor itself (DOM only, so it also runs in the harness). |
| `src/markdown.ts` | Line-by-line Markdown parsing and rendering, and code highlighting. |
| `src/geometry.ts` | Page sizes and layout maths. |
| `src/settings.ts` | Settings, declared once for both the settings tab and the appearance window. |
| `styles.css` | Pages, paper and the theme view. |

### Before opening a pull request

- `npm run build`, `npm run lint` and `npm test` should all pass with no warnings.
- Check the change in the harness, and in Obsidian if it touches the view or settings.
- Keep the Markdown untouched: the editor must save exactly what was typed. Anything
  rendered must keep every character of the source line in its text nodes. The logic
  tests check this.
- Use sentence case for UI text, and Obsidian's CSS variables for colours.

## Releases

Releases are made by pushing a version tag such as `0.2.0` that matches
`manifest.json`. GitHub Actions builds `main.js`, signs build-provenance attestations,
and publishes the release.
