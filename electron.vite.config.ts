import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // CommonJS e `.js`, não o `.mjs` que o "type": "module" do package.json
        // produziria: preload em janela com `sandbox: true` PRECISA ser CJS, e
        // o Electron não avisa — a ponte simplesmente não existe e a interface
        // abre com `window.api` indefinido.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        // Três páginas: a janela principal, a que grava (escondida) e a pílula
        // flutuante. Todas locais — o app nunca carrega conteúdo remoto.
        input: {
          index: resolve('src/renderer/index.html'),
          recorder: resolve('src/renderer/recorder.html'),
          overlay: resolve('src/renderer/overlay.html'),
        },
      },
    },
    plugins: [react()],
  },
});
