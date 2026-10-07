import { defineConfig } from 'vitest/config';

export default defineConfig({
  // caminhos relativos: o build funciona na raiz do domínio ou numa subpasta
  base: './',
  server: { port: 8765, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
  // prévias de arte (tools/preview) só rodam com PREVIEW=1, fora da suíte normal
  test: { environment: 'node', testTimeout: 120000, include: process.env.PREVIEW ? ['tools/preview/*.test.ts'] : ['tests/**/*.test.ts'] },
});
