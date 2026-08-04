// One flat config for the whole workspace.
//
// Not `next lint`: it is deprecated in Next 15, and with no config present it drops
// into an interactive "how would you like to configure ESLint?" prompt — which in
// CI is a job that hangs until it times out rather than a job that fails.
//
// The rule set is deliberately small. Lint is here to catch the mistakes a
// typechecker cannot see, not to enforce a house style; anything it flags should be
// worth stopping a build for.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.expo/**',
      '.backups/**',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // `_prev` is the required first parameter of every `useActionState` server
      // action and is never read. Underscore means deliberate.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // The mapping layer casts PostgREST responses to row interfaces, which is the
      // one place `as` is doing real work rather than hiding a problem.
      '@typescript-eslint/no-explicit-any': 'error',

      // Guards like `if (!childId) return { error: … }` on a string are the point.
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // This one earns its place: a stale closure in a hook is invisible to tsc and
      // showed up for real in this codebase as panels closing on the wrong render.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // Scripts are run by hand with tsx and legitimately talk to the console.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
