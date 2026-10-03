import { defineConfig as taocauhinh } from 'vite';
import phanmorongreact from '@vitejs/plugin-react';

const chuyentiep = { '/api': 'http://127.0.0.1:4003' };

export default taocauhinh({
  plugins: [phanmorongreact()],
  server: { proxy: chuyentiep },
  preview: { proxy: chuyentiep },
});
