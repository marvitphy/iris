import babelParser from '@babel/eslint-parser'

// Harness metric rules (docs/golden-principles.md #5). All 'warn' — they never break the build.
// Uses @babel/eslint-parser so it works with this repo's TypeScript 7 (typescript-eslint doesn't
// support TS 7 yet). The metric rules below are ESLint core, parser-agnostic.
export default [
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        ecmaFeatures: { jsx: true },
        babelOptions: {
          presets: ['@babel/preset-typescript', ['@babel/preset-react', { runtime: 'automatic' }]],
        },
      },
    },
    rules: {
      complexity: ['warn', 10],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
      'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['warn', 3],
    },
  },
]
