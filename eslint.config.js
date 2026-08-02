// ESLint 9/10 flat config.
// Two TS projects live side by side:
//   - src/renderer (tsconfig.json: DOM + JSX)   -> React hooks + react-refresh rules
//   - electron/ + src/scanner (tsconfig.node.json: Node) -> plain TS rules
// The two tsconfigs cannot share a single `parserOptions.project`, so we use
// the non-type-checked `recommended` preset (no type-aware rules) and skip
// `project`/`projectService` entirely. This avoids cross-project parser
// headaches and keeps the setup pragmatic.
//
// NOTE: `@typescript-eslint/no-unused-vars` defaults to ignoring names with a
// leading underscore (`argsIgnorePattern: '^_'`, `varsIgnorePattern: '^_'`,
// `destructuredArrayIgnorePattern: '^_'`) which matches the codebase's
// convention for intentionally-unused parameters.
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');
const reactRefresh = require('eslint-plugin-react-refresh');

module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      'vite.config.ts',
      '**/*.config.js',
      '**/*.config.mjs',
      'eslint.config.js',
      // Only .ts/.tsx sources exist; everything else is generated or support files.
      '**/*.{js,mjs,cjs,json,md,html,css,yaml,yml}',
    ],
  },
  // Restrict every typescript-eslint preset block to TS files so `eslint .`
  // never attempts to parse non-TS files with the TS parser.
  ...tseslint.configs.recommended.map((block) => ({
    ...block,
    files: block.files ?? ['**/*.{ts,tsx}'],
  })),
  {
    name: 'seele/renderer',
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh.reactRefresh.plugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
  {
    name: 'seele/electron',
    files: ['electron/**/*.ts', 'src/scanner/**/*.ts'],
  },
);
