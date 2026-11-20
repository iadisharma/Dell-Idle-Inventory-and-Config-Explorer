import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize } from '../shared/auth.mjs';
import { createInventoryStore, RequestError } from './store.mjs';
import { buildInsights } from './insights.mjs';

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new RequestError(415, 'Use application/json for review data.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16384) throw new RequestError(413, 'Review data is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Invalid JSON body.');
  }
}

export function createInventoryServer(store = createInventoryStore(), guard = authorize) {
  return http.createServer(async (req, res) => {
    function send(status, data, extra = {}) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
      res.end(JSON.stringify(data));
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (path === '/health' && req.method === 'GET') return send(200, { status: 'ok', service: 'inventory' });
      if (path === '/api/inventory') {
        const actor = await guard(req, 'workspace:read');
        if (req.method !== 'GET') return send(405, { error: 'Use GET.' }, { Allow: 'GET' });
        return send(200, await store.snapshot(actor));
      }
      if (path === '/api/inventory/insights') {
        const actor = await guard(req, 'workspace:read');
        if (req.method !== 'GET') return send(405, { error: 'Use GET.' }, { Allow: 'GET' });
        return send(200, buildInsights(await store.insightData(actor), url.searchParams.get('warehouseId')));
      }
      if (path === '/api/inventory/audit') {
        const actor = await guard(req, 'audit:read');
        if (req.method !== 'GET') return send(405, { error: 'Use GET.' }, { Allow: 'GET' });
        return send(200, await store.audit(actor, {
          before: url.searchParams.get('before'), limit: url.searchParams.get('limit') ?? 30, q: url.searchParams.get('q') ?? ''
        }));
      }
      if (path === '/api/inventory/reviews') {
        const actor = await guard(req, 'review:create');
        if (req.method !== 'POST') return send(405, { error: 'Use POST.' }, { Allow: 'POST' });
        const review = await store.createReview(await readBody(req), actor);
        return send(201, review);
      }
      const match = path.match(/^\/api\/inventory\/reviews\/([^/]+)\/actions$/);
      if (match && req.method === 'POST') {
        // Authenticate before consuming the payload. The store then enforces the permission for its action.
        const actor = await guard(req, 'workspace:read');
        const body = await readBody(req);
        let id;
        try { id = decodeURIComponent(match[1]); } catch { throw new RequestError(400, 'Invalid review ID.'); }
        const review = await store.applyAction(id, body, actor, req.headers['idempotency-key']);
        return send(200, review);
      }
      if (match || /^\/api\/inventory\/reviews\/[^/]+$/.test(path)) {
        await guard(req, 'workspace:read');
        return send(405, { error: 'Submit a disposition action to the review actions endpoint.' });
      }
      return send(404, { error: 'Route was not found.' });
    } catch (error) {
      if (Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
        return send(error.status, { error: error.message });
      }
      console.error('Inventory service:', error.message);
      return send(500, { error: 'Inventory data could not be loaded or saved. Check the service log.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.INVENTORY_PORT ?? 4102);
  const server = createInventoryServer();
  server.listen(port, '127.0.0.1', () => console.log('Inventory service http://127.0.0.1:' + server.address().port));
}
