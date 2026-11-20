import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInsights } from '../insights.mjs';
import { deriveInventory, stockSeries } from '../ledger.mjs';

function example() {
  return {
    asOf: '2026-03-15',
    defaultIdleDays: 7,
    idleWindows: [7],
    analytics: { currency: 'USD', trendWeeks: 3, unitCostCents: { part: 235 } },
    warehouses: [
      { id: 'north', name: 'North', code: 'N' },
      { id: 'south', name: 'South', code: 'S' },
    ],
    routes: [{ id: 'r', label: 'Review' }],
    statuses: [
      {
        id: 'open',
        initial: true,
        terminal: false,
        label: 'Open',
        next: ['closed'],
      },
      {
        id: 'closed',
        initial: false,
        terminal: true,
        label: 'Closed',
        next: [],
      },
    ],
    accounts: [
      { id: 'bin', sku: 'part', warehouseId: 'north' },
      { id: 'other', sku: 'unknown-cost', warehouseId: 'south' },
    ],
    movements: [
      {
        id: 'receipt',
        type: 'receipt',
        date: '2026-03-01',
        itemId: 'bin',
        units: 10,
      },
      {
        id: 'restock',
        type: 'receipt',
        date: '2026-03-14',
        itemId: 'bin',
        units: 5,
      },
      {
        id: 'south-receipt',
        type: 'receipt',
        date: '2026-03-01',
        itemId: 'other',
        units: 6,
      },
      {
        id: 'issue',
        type: 'consumption',
        date: '2026-03-08',
        itemId: 'other',
        units: 2,
        reviewId: 'case',
      },
      {
        id: 'future',
        type: 'consumption',
        date: '2026-03-16',
        itemId: 'bin',
        units: 1,
        reviewId: 'later',
      },
    ],
  };
}
test('weekly checkpoints agree with direct as-of reads, survive stockouts and exclude future postings', () => {
  const data = example();
  data.movements.push({
    id: 'deplete',
    type: 'consumption',
    date: '2026-03-07',
    itemId: 'bin',
    units: 10,
  });
  const dates = ['2026-03-01', '2026-03-08', '2026-03-15'];
  const series = stockSeries(data, dates);
  for (const checkpoint of series)
    assert.deepEqual(
      checkpoint.items,
      deriveInventory({ ...data, asOf: checkpoint.date }).items
    );
  assert.equal(
    series[1].items.some((i) => i.id === 'bin'),
    false
  );
  assert.equal(series.at(-1).items.find((i) => i.id === 'bin').idleDays, 1);
});
test('warehouse scopes, ledger-only executions, cost coverage and open reviews reconcile', () => {
  const data = example(),
    snapshot = {
      ...deriveInventory(data),
      reviews: [
        { id: 'old', itemId: 'other', currentItemId: null, status: 'open' },
        { id: 'current', itemId: 'bin', currentItemId: 'bin', status: 'open' },
      ],
    };
  const all = buildInsights({ data, snapshot });
  assert.deepEqual(
    all.trend.map((p) => [p.onHandUnits, p.idleUnits]),
    [
      [16, 0],
      [14, 10],
      [19, 19],
    ]
  );
  assert.deepEqual(all.summary, {
    onHandUnits: 19,
    idleUnits: 19,
    valueCents: 3525,
    unpricedUnits: 4,
    uncoveredPositions: 1,
    executedUnits: 2,
  });
  const south = buildInsights({ data, snapshot }, 'south');
  assert.equal(south.priorities[0].valueCents, null);
  assert.equal(south.priorities[0].reviewId, null);
  assert.equal(south.summary.executedUnits, 2);
  assert.equal(
    buildInsights({ data, snapshot }, 'north').summary.executedUnits,
    0
  );
  assert.throws(
    () => buildInsights({ data, snapshot }, 'unknown'),
    (error) => error.status === 400
  );
});
test('posted units keep their original warehouse after an account is removed and appear once while it exists', () => {
  const data = example();
  const snapshot = { ...deriveInventory(data), reviews: [] };
  const postedIssues = [
    {
      id: 'issue',
      reviewId: 'case',
      warehouseId: 'south',
      date: '2026-03-08',
      units: 2,
    },
    {
      id: 'archived',
      reviewId: 'historic-case',
      warehouseId: 'north',
      date: '2026-02-28',
      units: 4,
    },
    {
      id: 'future-archive',
      reviewId: 'historic-case-2',
      warehouseId: 'north',
      date: '2026-03-16',
      units: 1,
    },
  ];
  assert.equal(
    buildInsights({ data, snapshot, postedIssues }).summary.executedUnits,
    6
  );
  assert.equal(
    buildInsights({ data, snapshot, postedIssues }, 'north').summary
      .executedUnits,
    4
  );
});
