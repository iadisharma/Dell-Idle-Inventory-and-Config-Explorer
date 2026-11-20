import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createIdentityServer } from '../backend/identity/server.mjs';
import { hashPassword } from '../backend/identity/accounts.mjs';
import { createCatalogServer } from '../backend/catalog/server.mjs';
import { createInventoryServer } from '../backend/inventory/server.mjs';
import { createInventoryStore } from '../backend/inventory/store.mjs';

async function serve(t, server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      })
  );
  return 'http://127.0.0.1:' + server.address().port;
}

test('three authenticated services preserve real stock across option paths, approvals and repeated execution', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'inventory-workflow-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const catalogFile = join(folder, 'catalog.json');
  const inventoryFile = join(folder, 'inventory.json');
  const sku = 'part-test';
  const product = {
    sku,
    name: 'Test component',
    category: 'Storage',
    model: 'Test model',
    specs: {},
    description: 'A component in an isolated fixture.',
    status: 'Active',
    sourceUrl: 'https://www.dell.com/',
  };
  const primary = { sku, module: 'Storage', option: 'Primary' };
  const alternate = { sku, module: 'Storage', option: 'Alternate' };
  const catalog = {
    products: [product],
    configurations: [
      {
        id: 'a',
        orderCode: 'order-a',
        name: 'System A',
        chassis: 'A',
        paths: [primary, alternate],
      },
      {
        id: 'b',
        orderCode: 'order-b',
        name: 'System B',
        chassis: 'B',
        paths: [primary],
      },
    ],
  };
  const ledger = {
    asOf: '2026-11-20',
    defaultIdleDays: 90,
    idleWindows: [90],
    warehouses: [{ id: 'loc', code: 'L', name: 'Warehouse' }],
    accounts: [{ id: 'stock', sku, warehouseId: 'loc' }],
    movements: [
      {
        id: 'r',
        itemId: 'stock',
        type: 'receipt',
        date: '2026-06-01',
        units: 40,
      },
    ],
    routes: [{ id: 'planning', label: 'Planning' }],
    statuses: [
      {
        id: 'new',
        label: 'New',
        initial: true,
        terminal: false,
        next: ['done'],
      },
      { id: 'done', label: 'Done', initial: false, terminal: true, next: [] },
    ],
    seedReviews: [],
  };
  await Promise.all([
    writeFile(catalogFile, JSON.stringify(catalog)),
    writeFile(inventoryFile, JSON.stringify(ledger)),
  ]);
  const roles = [
    {
      id: 'analyst',
      label: 'Analyst',
      permissions: ['workspace:read', 'review:create'],
    },
    {
      id: 'planner',
      label: 'Planner',
      permissions: ['workspace:read', 'plan:propose', 'plan:execute'],
    },
    {
      id: 'manager',
      label: 'Manager',
      permissions: ['workspace:read', 'plan:decide', 'audit:read'],
    },
  ];
  const users = await Promise.all(
    roles.map(async (role) => ({
      id: role.id,
      name: role.label,
      email: role.id + '@example.test',
      role: role.id,
      password: await hashPassword('A local integration fixture'),
    }))
  );
  const identities = join(folder, 'identities.json');
  const demoFile = join(folder, 'demo.json');
  await writeFile(identities, JSON.stringify({ users, roles }));
  await writeFile(demoFile, JSON.stringify({ enabled: false }));
  const authUrl = await serve(
    t,
    createIdentityServer({ dataFile: identities, demoFile })
  );
  const previousOrigin = process.env.IDENTITY_ORIGIN;
  process.env.IDENTITY_ORIGIN = authUrl;
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.IDENTITY_ORIGIN;
    else process.env.IDENTITY_ORIGIN = previousOrigin;
  });
  const catalogUrl = await serve(
    t,
    createCatalogServer({ dataFile: catalogFile })
  );
  const inventoryUrl = await serve(
    t,
    createInventoryServer(
      createInventoryStore({
        dataFile: inventoryFile,
        reviewsFile: join(folder, 'reviews.json'),
        dbFile: join(folder, 'operations.sqlite'),
      })
    )
  );
  const send = (url, method, cookie, body, key) =>
    fetch(url, {
      method,
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Workspace-Request': '1',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const cookie = {};
  for (const user of users) {
    const response = await send(authUrl + '/api/auth/login', 'POST', '', {
      email: user.email,
      password: 'A local integration fixture',
    });
    assert.equal(response.status, 200);
    cookie[user.id] = response.headers.get('set-cookie').split(';')[0];
  }
  async function read(url, role = 'analyst') {
    const response = await send(url, 'GET', cookie[role]);
    assert.equal(response.status, 200);
    return response.json();
  }
  const stockUrl = inventoryUrl + '/api/inventory';
  assert.equal((await fetch(stockUrl)).status, 401);
  assert.equal((await fetch(catalogUrl + '/api/catalog')).status, 401);
  const stock = await read(stockUrl);
  const lookup = catalogUrl + '/api/catalog/products/' + sku;
  assert.equal(stock.items[0].quantity, 40);
  assert.ok(stock.items[0].isIdle);
  const reverse = await read(lookup);
  assert.equal(reverse.configurations.length, 2);
  assert.equal(
    reverse.configurations.flatMap((config) => config.paths).length,
    3
  );

  const caseBody = {
    itemId: 'stock',
    owner: 'Planner',
    route: 'planning',
    note: 'Check upcoming demand.',
  };
  assert.equal(
    (await send(stockUrl + '/reviews', 'POST', cookie.planner, caseBody))
      .status,
    403
  );
  const created = await send(
    stockUrl + '/reviews',
    'POST',
    cookie.analyst,
    caseBody
  );
  assert.equal(created.status, 201);
  const review = await created.json();
  assert.equal(review.history[0].actorId, 'analyst');
  const actionUrl = stockUrl + '/reviews/' + review.id + '/actions';
  const propose = {
    action: 'propose',
    quantity: 5,
    note: 'Confirmed repair demand.',
    expectedUpdatedAt: review.updatedAt,
  };
  assert.equal(
    (await send(actionUrl, 'POST', cookie.analyst, propose, 'blocked-proposal'))
      .status,
    403
  );
  async function act(role, body, key) {
    const response = await send(actionUrl, 'POST', cookie[role], body, key);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  const proposed = await act('planner', propose, 'plan-submit-001');
  const decision = {
    action: 'approve',
    note: 'Demand verified.',
    expectedUpdatedAt: proposed.updatedAt,
  };
  assert.equal(
    (
      await send(
        actionUrl,
        'POST',
        cookie.planner,
        decision,
        'blocked-decision'
      )
    ).status,
    403
  );
  const approved = await act('manager', decision, 'manager-approve-001');
  assert.equal((await read(stockUrl)).items[0].quantity, 40);
  const execution = {
    action: 'execute',
    note: 'Issued to repair.',
    expectedUpdatedAt: approved.updatedAt,
  };
  await Promise.all([
    act('planner', execution, 'planner-execute-001'),
    act('planner', execution, 'planner-execute-001'),
  ]);
  catalog.configurations[0].archived = true;
  product.name = 'Renamed component';
  ledger.asOf = '2026-11-21';
  await Promise.all([
    writeFile(catalogFile, JSON.stringify(catalog)),
    writeFile(inventoryFile, JSON.stringify(ledger)),
  ]);
  const current = await read(lookup),
    refreshed = await read(stockUrl);
  assert.equal(current.product.name, product.name);
  assert.deepEqual(
    current.configurations.map((config) => config.id),
    ['b']
  );
  assert.equal(refreshed.items[0].quantity, 35);
  assert.equal(refreshed.items[0].isIdle, false);
  assert.equal(refreshed.reviews[0].followUp.consumedUnits, 5);
  assert.equal(refreshed.reviews[0].status, 'done');
  assert.equal((await read(stockUrl + '/insights')).summary.executedUnits, 5);
  assert.deepEqual(
    (await read(stockUrl + '/audit', 'manager')).events.map((e) => e.action),
    ['execute', 'approve', 'propose', 'create']
  );
  assert.equal(
    (await send(stockUrl + '/audit', 'GET', cookie.analyst)).status,
    403
  );
  await send(authUrl + '/api/auth/logout', 'POST', cookie.analyst);
  assert.equal((await send(stockUrl, 'GET', cookie.analyst)).status, 401);
});
