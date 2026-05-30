import { defineConfig } from 'vitest/config';

// Config dedicada do Vitest (tem precedência sobre vite.config.ts), para o
// discovery de testes varrer todo o src/ — e não só src/web (root do Vite).
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
});
