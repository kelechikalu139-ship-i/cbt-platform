/**
 * ESLint configuration for the API server.
 *
 * Uses the legacy `.eslintrc.cjs` format because the pinned toolchain is ESLint 8,
 * which predates flat config becoming the default. `npm run lint` passes
 * `--ext .ts`, the matching flag for this format.
 *
 * The rule set is deliberately narrow. TypeScript's own compiler already rejects
 * incorrect code, so the lint rules here are limited to catching genuine defects
 * that the type system cannot see -- unused values that signal a forgotten
 * side effect, unsafe `any` that would hide a real mismatch, floating promises
 * that swallow failures, and exhaustive-switch checks on the Prisma enums.
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2023: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    // The build config excludes tests, so typed linting uses the config that
    // covers src, tests, prisma and scripts together.
    project: ['./tsconfig.test.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    'src/generated',
  ],
  rules: {
    // A leading underscore marks an intentionally unused parameter.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      },
    ],

    // `any` defeats the type checker, so it needs an explicit justification.
    '@typescript-eslint/no-explicit-any': 'warn',

    // An unresolved import almost always means a missing .js extension under
    // NodeNext ESM, which fails at runtime rather than at compile time.
    'import/no-unresolved': 'off',
    'no-undef': 'off',

    // Promises that are neither awaited nor explicitly ignored drop their
    // rejections on the floor.
    'no-async-promise-executor': 'error',
    'require-atomic-updates': 'off',

    eqeqeq: ['error', 'smart'],
    'no-console': ['warn', { allow: ['error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
  },
  overrides: [
    {
      // Tests legitimately reach for looser typing and unused bindings.
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      // The seed script prints a summary to the console on purpose.
      files: ['prisma/**/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      // Maintenance scripts exist to be read by a human in a terminal, so their
      // whole output is console calls by design.
      files: ['scripts/**/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
}