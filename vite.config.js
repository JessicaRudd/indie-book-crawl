import { defineConfig } from 'vite';

export default defineConfig({
  // Custom domain https://bookhopatl.com/ serves the app from root '/'.
  base: process.env.GITHUB_ACTIONS ? '/' : './',
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
});
