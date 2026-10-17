// Bundled by tests/build-harness.mjs (with `obsidian` aliased to the stub) for harness.html.
import { PagedEditor } from '../src/editor.js';
import { JournalView } from '../src/view.js';
import { DEFAULT_SETTINGS } from '../src/constants.js';
import { prismLines } from '../src/markdown.js';

window.J = { PagedEditor, JournalView, DEFAULT_SETTINGS, prismLines };
