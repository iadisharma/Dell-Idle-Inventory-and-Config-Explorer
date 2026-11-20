import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const catalog = process.env.CATALOG_ORIGIN || `http://127.0.0.1:${process.env.CATALOG_PORT || 4101}`;
const inventory = process.env.INVENTORY_ORIGIN || `http://127.0.0.1:${process.env.INVENTORY_PORT || 4102}`;
const identity = process.env.IDENTITY_ORIGIN || `http://127.0.0.1:${process.env.IDENTITY_PORT || 4103}`;
const options = {
  host: '127.0.0.1',
  port: Number(process.env.WEB_PORT || 5173),
  strictPort: true,
  proxy: {
    '/api/auth': identity,
    '/api/catalog': catalog,
    '/product-images': catalog,
    '/api/inventory': inventory
  }
};

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: {
    ...options,
    fs: {
      strict: true,
      allow: [
        fileURLToPath(new URL('./', import.meta.url)),
        fileURLToPath(new URL('../node_modules/', import.meta.url))
      ]
    }
  },
  preview: options
});
