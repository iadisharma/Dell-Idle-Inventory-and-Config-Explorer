const MS_PER_DAY = 86_400_000;

function check(condition, message) {
  if (!condition) throw new Error('Inventory data: ' + message);
}

function records(list, label) {
  check(Array.isArray(list), label + ' must be an array');
  const found = new Map();
  for (const record of list) {
    check(typeof record?.id === 'string' && record.id.trim(), label + ' contains an empty id');
    check(!found.has(record.id), label + ' contains duplicate id ' + record.id);
    found.set(record.id, record);
  }
  return found;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateBuild(build) {
  check(nonempty(build?.orderCode) && nonempty(build.chassis), 'recorded build needs an order code and chassis');
  check(Array.isArray(build.components) && build.components.length > 0, 'recorded build needs installed components');
  for (const part of build.components) {
    check(nonempty(part?.sku) && nonempty(part.module) && nonempty(part.option), 'invalid recorded build component');
  }
}

export function positionKey(account) {
  const build = account.recordedBuild;
  // Source order and JSON property order do not change the identity of a build.
  const installed = build?.components.map(part => JSON.stringify([part.sku, part.module, part.option])).sort();
  return JSON.stringify([account.sku, account.warehouseId, account.configurationId ?? null,
    build?.orderCode ?? null, build?.chassis ?? null, installed ?? null]);
}

function validateWorkflow(data) {
  const routes = records(data.routes, 'routes');
  const statuses = records(data.statuses, 'statuses');
  check(routes.size > 0, 'define at least one route');
  for (const route of routes.values()) check(typeof route.label === 'string' && route.label.trim(), 'invalid route label');
  check(data.statuses.filter(s => s.initial === true).length === 1, 'define one initial status');
  check(data.statuses.some(s => s.terminal === true), 'define a terminal status');
  for (const status of statuses.values()) {
    check(typeof status.label === 'string' && status.label.trim(), 'invalid status label');
    check(typeof status.initial === 'boolean' && typeof status.terminal === 'boolean', 'invalid status flags');
    check(Array.isArray(status.next) && status.next.every(id => statuses.has(id) && id !== status.id), 'invalid transitions for ' + status.id);
    check(!status.terminal || (!status.initial && !status.next.length), 'invalid terminal status');
  }
}

function prepareLedger(data) {
  check(validDate(data.asOf), 'asOf requires a calendar date');
  check(Array.isArray(data.idleWindows) && data.idleWindows.every(n => Number.isSafeInteger(n) && n > 0), 'invalid idle windows');
  check(data.idleWindows.includes(data.defaultIdleDays), 'idleWindows must include defaultIdleDays');
  validateWorkflow(data);
  const warehouses = records(data.warehouses, 'warehouses');
  for (const warehouse of warehouses.values()) {
    check(typeof warehouse.name === 'string' && warehouse.name.trim(), 'invalid warehouse name');
    check(typeof warehouse.code === 'string' && warehouse.code.trim(), 'invalid warehouse code');
  }
  const accounts = records(data.accounts, 'accounts');
  const movements = records(data.movements, 'movements');
  const balance = new Map();
  const combinations = new Set();
  for (const account of accounts.values()) {
    check(typeof account.sku === 'string' && account.sku.trim(), 'invalid SKU for ' + account.id);
    check(warehouses.has(account.warehouseId), 'unknown warehouse for ' + account.id);
    check(account.configurationId === undefined || (typeof account.configurationId === 'string' && account.configurationId.trim()), 'invalid configuration ID');
    if (account.recordedBuild !== undefined) validateBuild(account.recordedBuild);
    const key = positionKey(account);
    check(!combinations.has(key), 'duplicate stock account for ' + key);
    combinations.add(key);
    balance.set(account.id, { ...account, quantity: 0, stockedSince: null, lastUsedAt: null });
  }
  for (const movement of movements.values()) {
    check(accounts.has(movement.itemId), 'unknown stock account in ' + movement.id);
    check(validDate(movement.date), 'invalid date in ' + movement.id);
    check(['receipt', 'consumption'].includes(movement.type), 'invalid type in ' + movement.id);
    check(Number.isSafeInteger(movement.units) && movement.units > 0, 'invalid units in ' + movement.id);
  }
  // Stable date ordering preserves posting order within each calendar day.
  const visible = data.movements.filter(m => m.date <= data.asOf).sort((a, b) => a.date.localeCompare(b.date));
  return { visible, balance };
}

function applyMovement(balance, movement) {
  const item = balance.get(movement.itemId);
  if (movement.type === 'receipt') {
    if (item.quantity === 0) item.stockedSince = movement.date;
    item.quantity += movement.units;
    check(Number.isSafeInteger(item.quantity), 'stock quantity exceeds supported integer range');
  } else {
    item.quantity -= movement.units;
    check(item.quantity >= 0, movement.id + ' consumes more than on hand');
    item.lastUsedAt = movement.date;
    if (item.quantity === 0) item.stockedSince = null;
  }
}

function stockAtDate(balance, asOf, threshold) {
  const items = [];
  for (const item of balance.values()) {
    if (item.quantity === 0) continue;
    const idleSince = item.lastUsedAt && item.lastUsedAt > item.stockedSince ? item.lastUsedAt : item.stockedSince;
    const idleDays = (Date.parse(asOf) - Date.parse(idleSince)) / MS_PER_DAY;
    items.push({ ...item, idleSince, idleDays, isIdle: idleDays >= threshold });
  }

  return items;
}

// All checkpoints share the same policy and immutable posting order. Each movement is applied once.
export function stockSeries(data, dates) {
  const { visible, balance } = prepareLedger(data);
  const checkpoints = [...new Set(dates)].sort();
  let cursor = 0;
  return checkpoints.map(date => {
    check(validDate(date) && date <= data.asOf, 'invalid reporting checkpoint');
    while (cursor < visible.length && visible[cursor].date <= date) {
      applyMovement(balance, visible[cursor++]);
    }
    return { date, items: stockAtDate(balance, date, data.defaultIdleDays) };
  });
}

export function deriveInventory(data) {
  const [{ items }] = stockSeries(data, [data.asOf]);
  return {
    asOf: data.asOf, defaultIdleDays: data.defaultIdleDays, idleWindows: data.idleWindows,
    warehouses: data.warehouses, items, routes: data.routes, statuses: data.statuses
  };
}
