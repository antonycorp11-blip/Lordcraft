import { defineConfig } from 'vite';

export default defineConfig({
  // caminhos relativos: o build funciona na raiz do domínio ou numa subpasta (ex.: GitHub Pages)
  base: './',
  server: { port: 8765, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', testTimeout: 120000 },
} as any);
