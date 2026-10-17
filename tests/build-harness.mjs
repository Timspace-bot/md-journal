// Builds tests/harness.bundle.js, then serves the harness: npm run harness
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';

await esbuild.build({
  entryPoints: [fileURLToPath(new URL('./harness-entry.js', import.meta.url))],
  bundle: true,
  format: 'iife',
  target: 'es2021',
  outfile: fileURLToPath(new URL('./harness.bundle.js', import.meta.url)),
  alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.js', import.meta.url)) },
  logLevel: 'warning',
});
