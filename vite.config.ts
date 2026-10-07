import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()],
  base: './',
  server: { watch: { usePolling: true } },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { target: 'es2022' },
});
