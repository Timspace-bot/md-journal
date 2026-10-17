import esbuild from 'esbuild';
import process from 'node:process';
import { builtinModules } from 'node:module';

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  format: 'cjs',
  target: 'es2021',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  banner: { js: '/* MD Journal: built with esbuild from src/. Source: https://github.com/Timspace-bot/md-journal */' },
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
