import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build só transpila (esbuild) — não faz typecheck, então nits de tipo não
// quebram o deploy. Rode `npm run typecheck` para checar tipos manualmente.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
});
