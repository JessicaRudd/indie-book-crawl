import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this repository at https://jessicarudd.github.io/indie-book-crawl/ (use '/' for a custom domain).
  base: process.env.GITHUB_ACTIONS ? '/indie-book-crawl/' : './',
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
});
