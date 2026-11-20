import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findConfiguration, findProduct, readCatalog } from './catalog.mjs';

import { authorize } from '../shared/auth.mjs';

const images = new URL('./product-images/', import.meta.url);
const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export function createCatalogServer({ dataFile, guard = authorize } = {}) {
  return createServer(async (request, response) => {
    function send(status, payload, extra = {}) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
      response.end(JSON.stringify(payload));
    }
    try {
      if (request.method !== 'GET') return send(405, { error: 'Use GET.' }, { Allow: 'GET' });
      const { pathname } = new URL(request.url, 'http://localhost');
      if (pathname === '/health') return send(200, { service: 'catalog', status: 'ok' });
      const image = pathname.match(/^\/product-images\/([\w.-]+\.(?:jpg|jpeg|webp|png))$/i);
      if (image) {
        try {
          const content = await readFile(new URL(image[1], images));
          response.writeHead(200, { 'Content-Type': mimeTypes[extname(image[1]).toLowerCase()], 'Cache-Control': 'no-cache' });
          return response.end(content);
        } catch (error) {
          if (error.code === 'ENOENT') return send(404, { error: 'Image was not found.' });
          throw error;
        }
      }
      const detail = pathname.match(/^\/api\/catalog\/(products|configurations)\/([^/]+)$/);
      if (!detail && pathname !== '/api/catalog') return send(404, { error: 'Route was not found.' });
      await guard(request, 'workspace:read');
      const catalog = await readCatalog(dataFile);
      if (!detail) return send(200, catalog);
      const key = decodeURIComponent(detail[2]);
      const result = detail[1] === 'products' ? findProduct(catalog, key) : findConfiguration(catalog, key);
      return result ? send(200, result) : send(404, { error: 'Catalog record was not found.' });
    } catch (error) {
      if ([401, 403, 503].includes(error.status)) return send(error.status, { error: error.message });
      if (error instanceof URIError) return send(400, { error: 'Invalid URL encoding.' });
      console.error('Catalog service:', error.message);
      send(500, { error: 'Catalog data could not be loaded. Check the service log.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CATALOG_PORT ?? 4101);
  const server = createCatalogServer();
  server.listen(port, '127.0.0.1', () => console.log('Catalog service http://127.0.0.1:' + server.address().port));
}
