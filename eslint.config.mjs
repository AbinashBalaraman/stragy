import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.verify-cjs/**', '.verification-client/**', '.tool-registry/**'] },
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { '@typescript-eslint': tseslint.plugin }, rules: {
    'no-debugger': 'error',
    'no-restricted-imports': ['error', { patterns: [{ group: ['**/server/**'], message: 'Client/shared modules must not import server code.' }] }],
  } },
  { files: ['server.ts', 'src/server/**/*.ts', 'src/test/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': 'off' } },
];
