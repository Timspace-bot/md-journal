// Mirrors the community directory's scanner, which also type-checks .js files:
//   npm run lint:scanner
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import base from './eslint.config.mjs';

export default defineConfig([
  ...base,
  {
    files: ['src/**/*.js'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    plugins: { obsidianmd },
    rules: {
      'obsidianmd/no-plugin-as-component': 'error',
      'obsidianmd/no-view-references-in-plugin': 'error',
      'obsidianmd/no-unsupported-api': 'error',
      'obsidianmd/prefer-create-el': 'warn',
      'obsidianmd/prefer-file-manager-trash-file': 'warn',
      'obsidianmd/prefer-instanceof': 'warn',
      '@typescript-eslint/no-deprecated': 'warn',
      // reported as warnings by the scanner for untyped JavaScript
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
    },
  },
]);
