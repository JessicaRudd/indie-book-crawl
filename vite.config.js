import { defineConfig } from 'vite';

export default defineConfig({
  // For GitHub Pages deployment, replace '/atlanta-indie-bookshop-crawl/' with your GitHub repository name.
  base: process.env.GITHUB_ACTIONS ? '/atlanta-indie-bookshop-crawl/' : './',
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
});
