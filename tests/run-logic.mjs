// npm test — bundles tests/logic.mjs (which imports the TypeScript sources) and runs it.
import esbuild from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = fileURLToPath(new URL('./.out/logic.mjs', import.meta.url));
await esbuild.build({
  entryPoints: [fileURLToPath(new URL('./logic.mjs', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  logLevel: 'warning',
});
await import(pathToFileURL(out).href);
