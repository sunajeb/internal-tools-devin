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
            'apps/web/vite.config.ts',
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
