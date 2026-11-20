import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deriveInventory } from '../ledger.mjs';
import { createInventoryStore } from '../store.mjs';

const analyst = { id: 'analyst', name: 'Alex', role: 'analyst', permissions: ['review:create', 'workspace:read'] };
const planner = { id: 'planner', name: 'Morgan', role: 'planner', permissions: ['plan:propose', 'plan:execute', 'workspace:read'] };
const manager = { id: 'manager', name: 'Robin', role: 'manager', permissions: ['plan:decide', 'audit:read', 'workspace:read'] };

function sampleLedger() {
  return {
    warehouses: [{ id: 'wh', name: 'Test', code: 'TST' }],
    routes: [{ id: 'plan', label: 'Planning' }],
    statuses: [
      { id: 'new', label: 'New', initial: true, terminal: false, next: ['done'] },
      { id: 'done', label: 'Done', initial: false, terminal: true, next: [] }
    ],
    idleWindows: [30, 90],
    accounts: [{ id: 'one', sku: 'sample', warehouseId: 'wh' }],
    movements: [
      { id: 'receive', itemId: 'one', date: '2026-05-01', type: 'receipt', units: 40 },
      { id: 'use', itemId: 'one', date: '2026-08-22', type: 'consumption', units: 5 },
      { id: 'add', itemId: 'one', date: '2026-11-19', type: 'receipt', units: 3 }
    ],
    seedReviews: [],
    asOf: '2026-11-20',
    defaultIdleDays: 90
  };
}

test('counts dated consumption, leaves aging unchanged on additional receipts, includes threshold day', () => {
  const ledger = sampleLedger();
  ledger.movements.reverse();
  const [item] = deriveInventory(ledger).items;
  assert.equal(item.quantity, 38);
  assert.equal(item.idleDays, 90);
  assert.equal(item.isIdle, true);
});

test('zero balance clears the holding period and later receipts start a new period', () => {
  const ledger = sampleLedger();
  ledger.movements[1].units = 40;
  assert.deepEqual(deriveInventory({ ...ledger, asOf: '2026-08-22' }).items, []);
  const [item] = deriveInventory(ledger).items;
  assert.equal(item.quantity, 3);
  assert.equal(item.stockedSince, '2026-11-19');
  assert.equal(item.lastUsedAt, '2026-08-22');
  assert.equal(item.idleDays, 1);
  assert.equal(item.isIdle, false);
});

test('ages never-consumed stock from receipt, rejects duplicate accounts and impossible stock', () => {
  const ledger = sampleLedger();
  const [item] = deriveInventory({ ...ledger, asOf: '2026-05-03' }).items;
  assert.equal(item.lastUsedAt, null);
  assert.equal(item.idleDays, 2);
  assert.throws(() => deriveInventory({ ...ledger, accounts: [...ledger.accounts, { ...ledger.accounts[0], id: 'two' }] }));
  ledger.movements[1].units = 41;
  assert.throws(() => deriveInventory(ledger));
});

test('preserves installed parts independently and distinguishes two builds of the same order code', () => {
  const data = sampleLedger();
  const original = {
    sku: 'system', configurationId: 'config',
    recordedBuild: {
      orderCode: 'order', chassis: 'chassis',
      components: [{ sku: 'ram', module: 'memory', option: '16 GB' }, { sku: 'ssd', module: 'disk', option: '512 GB' }]
    }
  };
  const first = { ...original, id: 'one', warehouseId: 'wh' };
  data.accounts = [first, structuredClone({ ...first, id: 'two' })];
  data.accounts[1].recordedBuild.components.reverse();
  assert.throws(() => deriveInventory(data), /duplicate stock account/);
  data.accounts[1].recordedBuild.components[0].sku = 'different-installation';
  data.movements.push({ id: 'receive-second', itemId: 'two', date: data.asOf, type: 'receipt', units: 1 });
  const report = deriveInventory(data);
  assert.equal(report.items.length, 2);
  assert.deepEqual(report.items[0].recordedBuild.components, original.recordedBuild.components);
  data.accounts[1].recordedBuild.components[0].module = '';
  assert.throws(() => deriveInventory(data), /invalid recorded build component/);
});

test('JSON edits take effect on read and open reviews survive concurrent requests, restart and resolution', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'inventory-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'inventory.json');
  const reviewsFile = join(directory, 'reviews.json');
  const data = sampleLedger();
  await writeFile(dataFile, JSON.stringify(data));
  const store = createInventoryStore({ dataFile, reviewsFile });
  const payload = { itemId: 'one', owner: 'Analyst', route: data.routes[0].id, note: 'Verify demand' };
  const results = await Promise.allSettled([store.createReview(payload, analyst), store.createReview(payload, analyst)]);
  const review = results.find(result => result.status === 'fulfilled').value;
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await store.snapshot()).reviews.length, 1);
  const restarted = createInventoryStore({ dataFile, reviewsFile });
  const propose = { action: 'propose', note: 'Use on build', quantity: 4, expectedUpdatedAt: review.updatedAt };
  await assert.rejects(restarted.applyAction(review.id, { ...propose, expectedUpdatedAt: 'old' }, planner, 'old'), { status: 409 });
  const proposed = await restarted.applyAction(review.id, propose, planner, 'proposal');
  const approve = { action: 'approve', expectedUpdatedAt: proposed.updatedAt, note: 'Verified demand' };
  await assert.rejects(restarted.applyAction(review.id, approve, planner, 'decide'), { status: 403 });
  await assert.rejects(restarted.applyAction(review.id, approve, { ...manager, id: planner.id }, 'decide'), { status: 403 });
  const approved = await restarted.applyAction(review.id, approve, manager, 'decide');
  assert.equal((await restarted.snapshot()).items[0].quantity, 38);
  const page = await restarted.audit(manager, { limit: 2 });
  assert.deepEqual(page.events.map(e => e.action), ['approve', 'propose']);
  const execute = { action: 'execute', expectedUpdatedAt: approved.updatedAt };
  const [result, replayed] = await Promise.all([
    store.applyAction(review.id, execute, planner, 'issue-once'), restarted.applyAction(review.id, execute, planner, 'issue-once')
  ]);
  assert.deepEqual(result, replayed);
  assert.equal(result.history.length, 4);
  assert.equal(result.status, 'done');
  assert.equal(result.execution.quantity, 4);
  const nextPage = await restarted.audit(manager, { limit: 2, before: page.nextCursor });
  assert.deepEqual(nextPage.events.map(e => e.action), ['create']);
  assert.equal(nextPage.nextCursor, null);
  const searched = await restarted.audit(manager, { q: 'mOrGaN' });
  assert.deepEqual(searched.events.map(e => e.action), ['execute', 'propose']);
  assert.deepEqual((await restarted.audit(manager, { q: '%' })).events, []);
  await assert.rejects(restarted.audit(manager, { limit: 101 }), { status: 400 });
  await assert.rejects(restarted.audit(analyst), { status: 403 });
  await assert.rejects(restarted.applyAction(review.id, { ...execute, note: 'changed intent' }, planner, 'issue-once'), { status: 409 });
  data.warehouses[0].name = 'Renamed warehouse';
  data.asOf = '2026-11-22';
  data.movements.push({ id: 'later-build', itemId: 'one', date: '2026-11-21', type: 'consumption', units: 3 });
  await writeFile(dataFile, JSON.stringify(data));
  const refreshed = await restarted.snapshot();
  assert.equal(refreshed.warehouses[0].name, 'Renamed warehouse');
  assert.equal(refreshed.reviews[0].followUp.consumedUnits, 7);
  assert.equal(refreshed.reviews[0].followUp.remainingUnits, 31);
});

test('includes new consumption posted on the snapshot day exactly once and keeps history tied to the original stock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'inventory-cutoff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'ledger.json');
  const data = sampleLedger();
  const persist = () => writeFile(dataFile, JSON.stringify(data));
  const store = createInventoryStore({ dataFile, reviewsFile: join(directory, 'state.json') });
  const issue = { itemId: 'one', type: 'consumption', units: 1 };
  data.movements.push({ ...issue, id: 'known', date: data.asOf });
  await persist();
  const payload = { itemId: 'one', owner: 'Planner', route: data.routes[0].id, note: 'Check stock' };
  await store.createReview(payload, analyst);
  data.movements.push({ ...issue, id: 'new', date: data.asOf }, { ...issue, id: 'backfill', date: '2026-11-19' });
  await persist();
  assert.equal((await store.snapshot()).reviews[0].followUp.consumedUnits, 1);
  data.accounts[0].sku = 'replacement';
  await persist();
  assert.equal((await store.snapshot()).reviews[0].followUp.consumedUnits, null);
  await store.createReview(payload, analyst);
  assert.equal((await store.snapshot()).reviews.length, 2);
});

test('patching a seeded case concurrently preserves one winning event across source edits and restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'inventory-seeds-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'ledger.json');
  const options = { dataFile, reviewsFile: join(directory, 'state.json') };
  const data = sampleLedger();
  const at = '2026-11-15T00:00:00.000Z';
  const seed = {
    id: 'seed-open', itemId: 'one', owner: 'Planner', route: 'plan',
    status: 'new', note: 'Check demand', outcome: '', createdAt: at, updatedAt: at,
    history: [{ status: 'new', at, note: 'Check demand' }]
  };
  const untouched = {
    ...seed, id: 'seed-complete', status: 'done', outcome: 'Confirmed',
    history: [{ status: 'done', at, note: 'Confirmed' }]
  };
  data.seedReviews = [seed, untouched];
  await writeFile(dataFile, JSON.stringify(data));
  const store = createInventoryStore(options);
  const patch = { action: 'propose', quantity: 1, note: 'Route stock', expectedUpdatedAt: seed.updatedAt };
  const updates = await Promise.allSettled([store.applyAction(seed.id, patch, planner, 'one'), store.applyAction(seed.id, patch, planner, 'two')]);
  assert.deepEqual(updates.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(updates.find(result => result.status === 'rejected').reason.status, 409);
  untouched.owner = 'New seed owner';
  data.seedReviews = [untouched];
  await writeFile(dataFile, JSON.stringify(data));
  const snapshot = await createInventoryStore(options).snapshot();
  assert.equal(snapshot.reviews.length, 2);
  assert.equal(snapshot.reviews.find(review => review.id === seed.id).history.length, seed.history.length + 1);
  assert.equal(snapshot.reviews.find(review => review.id === untouched.id).owner, untouched.owner);
  data.seedReviews.push(untouched);
  await writeFile(dataFile, JSON.stringify(data));
  await assert.rejects(store.snapshot(), /duplicate ID/);
});

test('imports old reviews once, serializes competing reservations and rolls back a failed stock issue', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'inventory sqlite migration '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { dataFile: join(directory, 'ledger.json'), reviewsFile: join(directory, 'legacy.json') };
  const data = sampleLedger();
  const date = '2026-11-16T12:00:00.000Z';
  const original = {
    id: 'old-a', itemId: 'one', owner: 'Planner', route: 'plan', status: 'new',
    note: 'Check parts', outcome: '', createdAt: date, updatedAt: date,
    history: [{ status: 'new', at: date, note: 'Check parts' }],
    stockAtCreation: { sku: 'sample', warehouseId: 'wh', quantity: 38, idleDays: 86 }
  };
  const legacy = [original, { ...original, id: 'old-b' }];
  const persist = () => writeFile(options.dataFile, JSON.stringify(data));
  await persist();
  await writeFile(options.reviewsFile, JSON.stringify({ reviews: legacy }));
  const store = createInventoryStore(options);
  assert.equal((await store.snapshot()).reviews.length, 2);
  await writeFile(options.reviewsFile, JSON.stringify({ reviews: [{ ...original, id: 'post-migration' }] }));
  const second = createInventoryStore(options);
  assert.deepEqual((await second.snapshot()).reviews.map(r => r.id).sort(), ['old-a', 'old-b']);

  const proposals = await Promise.all(legacy.map((review, i) =>
    [store, second][i].applyAction(review.id, {
      action: 'propose', expectedUpdatedAt: date, quantity: 25, note: 'Build request'
    }, planner, 'p-' + i)
  ));
  const decisions = await Promise.allSettled(proposals.map((proposal, i) =>
    [store, second][i].applyAction(proposal.id, {
      action: 'approve', expectedUpdatedAt: proposal.updatedAt, note: 'Authorized request'
    }, manager, 'd-' + i)
  ));
  const approved = decisions.find(r => r.status === 'fulfilled').value;
  assert.equal(decisions.find(r => r.status === 'rejected').reason.status, 409);
  const leftover = proposals.find(proposal => proposal.id !== approved.id);
  const rejected = await store.applyAction(leftover.id, {
    action: 'reject', expectedUpdatedAt: leftover.updatedAt, note: 'Balance reserved elsewhere'
  }, manager, 'rejection');
  assert.equal(rejected.status, 'rejected');
  assert.deepEqual(rejected.availableActions, []);
  assert.equal((await store.snapshot()).items[0].quantity, 38);

  const command = { action: 'execute', expectedUpdatedAt: approved.updatedAt };
  data.movements.push({ id: 'later', itemId: 'one', type: 'consumption', units: 14, date: '2026-11-21' });
  await persist();
  await assert.rejects(store.applyAction(approved.id, command, planner, 'stock-posting'), /later stock posting/);
  data.movements.pop();
  data.movements.push({ id: 'external-issue', itemId: 'one', type: 'consumption', units: 18, date: data.asOf });
  await persist();
  await assert.rejects(store.applyAction(approved.id, command, planner, 'stock-posting'), { status: 409 });
  assert.equal((await store.audit(manager)).events.filter(e => e.action === 'execute').length, 0);
  data.movements.push({ id: 'replenish', itemId: 'one', type: 'receipt', units: 5, date: data.asOf });
  await persist();
  const execution = await second.applyAction(approved.id, command, planner, 'stock-posting');
  const report = await store.insightData();
  assert.equal(report.snapshot.items.length, 0);
  assert.deepEqual(report.data.movements.filter(m => m.reviewId).map(m => m.id), [execution.execution.movementId]);
  assert.equal((await store.audit(manager)).events.filter(e => e.action === 'execute').length, 1);
  data.accounts = [];
  data.movements = [];
  await persist();
  const archived = await second.insightData();
  assert.equal(archived.data.movements.length, 0);
  assert.equal(archived.postedIssues[0].warehouseId, 'wh');
  assert.equal(archived.postedIssues[0].units, 25);
});

test('manager cancels a stranded reservation without posting consumption and the remaining stock can be reviewed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'inventory-cancel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'inventory.json');
  const data = sampleLedger();
  const persist = () => writeFile(dataFile, JSON.stringify(data));
  await persist();
  const store = createInventoryStore({ dataFile });
  const payload = { itemId: 'one', owner: 'Analyst', route: 'plan', note: 'Check demand' };
  const review = await store.createReview(payload, analyst);
  const proposal = await store.applyAction(review.id, {
    action: 'propose', expectedUpdatedAt: review.updatedAt, quantity: 25, note: 'Requested build'
  }, planner, 'propose');
  const approved = await store.applyAction(review.id, {
    action: 'approve', expectedUpdatedAt: proposal.updatedAt, note: 'Authorized'
  }, manager, 'approve');
  assert.deepEqual(approved.availableActions, ['cancel']);
  data.movements.push({ id: 'elsewhere', date: data.asOf, itemId: 'one', units: 28, type: 'consumption' });
  await persist();
  await assert.rejects(store.applyAction(review.id, {
    action: 'execute', expectedUpdatedAt: approved.updatedAt
  }, planner, 'blocked'), { status: 409 });
  const cancel = { action: 'cancel', expectedUpdatedAt: approved.updatedAt, note: 'Stock changed' };
  await assert.rejects(store.applyAction(review.id, cancel, planner, 'cancel'), { status: 403 });
  await assert.rejects(store.applyAction(review.id, { ...cancel, note: '' }, manager, 'cancel'), { status: 400 });
  const cancelled = await store.applyAction(review.id, cancel, manager, 'cancel');
  assert.deepEqual(await store.applyAction(review.id, cancel, manager, 'cancel'), cancelled);
  assert.deepEqual(cancelled.decision, approved.decision);
  assert.equal(cancelled.dispositionStage, 'cancelled');
  assert.equal(cancelled.cancellation.note, 'Stock changed');
  assert.equal((await store.insightData()).postedIssues.length, 0);
  assert.equal((await store.audit(manager)).events.filter(event => event.action === 'cancel').length, 1);
  const successor = await store.createReview(payload, analyst);
  assert.equal((await store.applyAction(successor.id, {
    action: 'propose', expectedUpdatedAt: successor.updatedAt, note: 'Revised demand', quantity: 10
  }, planner, 'revised')).proposal.quantity, 10);
});
