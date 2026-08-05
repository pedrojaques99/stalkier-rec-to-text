import { defineConfig } from 'vitest/config';

// Um comando de teste pro repo inteiro: o app e os pacotes. Suíte separada por
// workspace daria dois comandos e, na prática, um deles pararia de rodar.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
  },
});
