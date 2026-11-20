import { stockSeries } from './ledger.mjs';

const WEEK_MS = 7 * 86_400_000;

function valuation(items, costs) {
  let valueCents = 0;
  let unpricedUnits = 0;
  for (const item of items) {
    if (Object.hasOwn(costs, item.sku))
      valueCents += costs[item.sku] * item.quantity;
    else unpricedUnits += item.quantity;
  }
  return { valueCents, unpricedUnits };
}

function units(items) {
  return items.reduce((count, item) => count + item.quantity, 0);
}

export function buildInsights(
  { data, snapshot, postedIssues = [] },
  warehouseId = null
) {
  const warehouses = data.warehouses.filter(
    (w) => !warehouseId || w.id === warehouseId
  );
  if (warehouseId && warehouses.length === 0) {
    throw Object.assign(new Error('Select a valid warehouse.'), {
      status: 400,
    });
  }
  const {
    currency = null,
    trendWeeks = 8,
    unitCostCents = {},
  } = data.analytics ?? {};
  if (!Number.isInteger(trendWeeks) || trendWeeks < 2 || trendWeeks > 52) {
    throw new Error(
      'analytics.trendWeeks must be an integer between 2 and 52.'
    );
  }
  if (currency !== null && !/^[A-Z]{3}$/.test(currency))
    throw new Error('Invalid analytics currency.');
  if (
    !unitCostCents ||
    Array.isArray(unitCostCents) ||
    typeof unitCostCents !== 'object' ||
    Object.values(unitCostCents).some(
      (cost) => !Number.isSafeInteger(cost) || cost < 0
    ) ||
    (Object.keys(unitCostCents).length && !currency)
  )
    throw new Error('Invalid estimated unit costs.');

  const inScope = (item) => !warehouseId || item.warehouseId === warehouseId;
  const items = snapshot.items.filter(inScope);
  const idle = items.filter((item) => item.isIdle);
  const terminal = new Set(
    snapshot.statuses
      .filter((status) => status.terminal)
      .map((status) => status.id)
  );
  const cases = new Map();
  for (const review of snapshot.reviews) {
    const position = Object.hasOwn(review, 'currentItemId')
      ? review.currentItemId
      : review.itemId;
    if (position && !terminal.has(review.status)) cases.set(position, review);
  }
  const priorities = idle
    .map((item) => ({
      itemId: item.id,
      sku: item.sku,
      warehouseId: item.warehouseId,
      quantity: item.quantity,
      idleDays: item.idleDays,
      valueCents: Object.hasOwn(unitCostCents, item.sku)
        ? item.quantity * unitCostCents[item.sku]
        : null,
      reviewId: cases.get(item.id)?.id ?? null,
    }))
    .sort(
      (a, b) =>
        (b.valueCents ?? -1) - (a.valueCents ?? -1) ||
        b.idleDays - a.idleDays ||
        a.itemId.localeCompare(b.itemId)
    );

  const end = Date.parse(data.asOf);
  const dates = Array.from({ length: trendWeeks }, (_, i) =>
    new Date(end - WEEK_MS * (trendWeeks - i - 1)).toISOString().slice(0, 10)
  );
  const trend = stockSeries(data, dates).map(({ date, items: positions }) => {
    const scoped = positions.filter(inScope);
    return {
      date,
      onHandUnits: units(scoped),
      idleUnits: units(scoped.filter((i) => i.isIdle)),
    };
  });
  const location = new Map(data.accounts.map((a) => [a.id, a.warehouseId]));
  // Historical postings retain the warehouse even if the current account is archived or reused.
  const issues = new Map(
    data.movements
      .filter((m) => m.type === 'consumption' && m.reviewId)
      .map((m) => [m.id, { ...m, warehouseId: location.get(m.itemId) }])
  );
  for (const movement of postedIssues) issues.set(movement.id, movement);
  let executedUnits = 0;
  for (const movement of issues.values()) {
    if (
      movement.date <= data.asOf &&
      (!warehouseId || movement.warehouseId === warehouseId)
    ) {
      executedUnits += movement.units;
    }
  }

  return {
    asOf: data.asOf,
    idleDays: data.defaultIdleDays,
    currency,
    warehouseId,
    summary: {
      onHandUnits: units(items),
      idleUnits: units(idle),
      ...valuation(idle, unitCostCents),
      uncoveredPositions: priorities.filter((i) => !i.reviewId).length,
      executedUnits,
    },
    trend,
    warehouses: warehouses.map((w) => {
      const positions = items.filter((i) => i.warehouseId === w.id);
      const idlePositions = positions.filter((i) => i.isIdle);
      return {
        id: w.id,
        name: w.name,
        onHandUnits: units(positions),
        idleUnits: units(idlePositions),
        ...valuation(idlePositions, unitCostCents),
      };
    }),
    priorities,
  };
}
