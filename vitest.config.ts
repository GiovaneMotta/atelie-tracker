import { defineConfig } from 'vitest/config';

// Testes do backend (camada Frenet/expedição). Só lógica pura + chamadas
// externas MOCKADAS. Nunca gera etiqueta real (§40).
export default defineConfig({
  test: {
    environment: 'node',
    /* web/src: só lógica pura do painel (ex.: regra da Ordem da vitrine) */
    include: ['netlify/**/*.test.ts', 'web/src/**/*.test.ts'],
  },
});
