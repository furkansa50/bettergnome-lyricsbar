import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['.kilo/**', 'node_modules/**', 'dist/**', 'coverage/**'],
  },
});
