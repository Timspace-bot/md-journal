// Bundled by tests/build-harness.mjs (with `obsidian` aliased to the stub) for harness.html.
import { PagedEditor } from '../src/editor';
import { JournalView } from '../src/view';
import { DEFAULT_SETTINGS } from '../src/constants';
import { prismLines } from '../src/markdown';

window.J = { PagedEditor, JournalView, DEFAULT_SETTINGS, prismLines };
