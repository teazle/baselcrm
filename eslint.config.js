export default [
  {
    ignores: [
      'node_modules/**',
      'apps/crm/**',
      '.next/**',
      'dist/**',
      'build/**',
      'downloads/**',
      'screenshots/**',
      'data/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // Allow console in automation scripts
      'no-undef': 'error',
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
];
