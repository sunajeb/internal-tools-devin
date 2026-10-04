import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'docs/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'apps/api/drizzle.config.ts',
            'apps/web/vite.config.ts',
            'e2e/playwright.config.ts',
            'e2e/specs/refunds.spec.ts',
            'scripts/new-tool.ts',
            'vitest.config.ts',
          ],
        },
      },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
];
