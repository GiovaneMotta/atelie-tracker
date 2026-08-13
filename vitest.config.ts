import { defineConfig } from 'vitest/config';

// Testes do backend (camada Frenet/expedição). Só lógica pura + chamadas
// externas MOCKADAS. Nunca gera etiqueta real (§40).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['netlify/**/*.test.ts'],
  },
});
