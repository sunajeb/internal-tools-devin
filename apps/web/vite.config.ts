import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/auth': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/health': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/metrics': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
});
