import React, { useMemo, useState } from 'react';
import {
  reviewItemId,
  Icon,
  ProductArt,
  Search,
  Select,
  Empty,
  fmt,
  matches,
} from './ui.jsx';

function Aging({ items, windows }) {
  const ranges = [
    0,
    ...new Set(windows.filter((value) => value > 0).map(Number)),
  ].sort((a, b) => a - b);
  const counts = ranges.map((min, i) =>
    items.reduce(
      (sum, item) =>
        sum +
        (item.idleDays >= min &&
        (ranges[i + 1] === undefined || item.idleDays < ranges[i + 1])
          ? item.quantity
          : 0),
      0
    )
  );
  const total = counts.reduce((sum, value) => sum + value, 0);
  const color = (i) =>
    'hsl(205 75% ' + (85 - (58 * i) / Math.max(ranges.length - 1, 1)) + '%)';
  return (
    <section className="aging-card">
      <div className="stat-label">
        <Icon name="layers" size={17} />
        <h2>Stock aging</h2>
      </div>
      <div className="aging-caption">Units by days without use</div>
      <div className="aging-bar" aria-hidden="true">
        {counts.map(
          (count, i) =>
            count > 0 && (
              <span
                key={ranges[i]}
                style={{ flex: count, background: color(i) }}
              />
            )
        )}
      </div>
      <div className="aging-legend">
        {ranges.map((min, i) => (
          <div
            key={min}
            title={fmt(counts[i]) + ' of ' + fmt(total) + ' units'}
          >
            <i style={{ background: color(i) }} />
            <span>
              {ranges[i + 1] !== undefined
                ? min + '–' + (ranges[i + 1] - 1)
                : min + '+'}
              d
            </span>
            <b>{fmt(counts[i])}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
function SortHead({ label, field, sort, change }) {
  return (
    <th
      scope="col"
      aria-sort={
        sort.field === field ? (sort.desc ? 'descending' : 'ascending') : 'none'
      }
    >
      <button className="sort-head" onClick={() => change(field)}>
        {label}
        <Icon name="sort" size={13} />
      </button>
    </th>
  );
}
const pageSize = 8;
export default function Inventory({ data, index, open, navigate }) {
  const [warehouse, setWarehouse] = useState('');
  const [days, setDays] = useState(null);
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState('idle');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ field: 'idleDays', desc: true });
  const inventory = data.inventory;
  const threshold = days ?? inventory.defaultIdleDays;
  const windows = [
    ...new Set([...inventory.idleWindows, inventory.defaultIdleDays]),
  ].sort((a, b) => a - b);
  const localItems = inventory.items.filter(
    (i) => !warehouse || i.warehouseId === warehouse
  );
  const idleItems = localItems.filter((i) => i.idleDays >= threshold);
  const activeReviews = inventory.reviews.filter(
    (r) =>
      !index.status.get(r.status)?.terminal &&
      (!warehouse ||
        (index.item.get(reviewItemId(r))?.warehouseId ??
          r.stockAtCreation?.warehouseId) === warehouse)
  );
  const categories = [
    ...new Set(data.catalog.products.map((p) => p.category)),
  ].sort();
  const results = useMemo(() => {
    const items = (scope === 'idle' ? idleItems : localItems).filter((i) => {
      const p = index.product.get(i.sku),
        w = index.warehouse.get(i.warehouseId);
      return (
        (!category || p?.category === category) &&
        matches(term, p?.name, i.sku, w?.name, w?.code)
      );
    });
    const field = (i) =>
      sort.field === 'name'
        ? (index.product.get(i.sku)?.name ?? i.sku)
        : i[sort.field];
    return items.sort((a, b) => {
      const value =
        typeof field(a) === 'number'
          ? field(a) - field(b)
          : String(field(a)).localeCompare(String(field(b)));
      return (sort.desc ? -value : value) || a.sku.localeCompare(b.sku);
    });
  }, [scope, idleItems, localItems, category, term, index, sort]);
  const lastPage = Math.max(0, Math.ceil(results.length / pageSize) - 1);
  const shownPage = Math.min(page, lastPage);
  const visible = results.slice(
    shownPage * pageSize,
    (shownPage + 1) * pageSize
  );
  const update = (setter) => (value) => {
    setter(value);
    setPage(0);
  };
  const changeSort = (field) => {
    setSort({
      field,
      desc: sort.field === field ? !sort.desc : field !== 'name',
    });
    setPage(0);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Inventory overview</h1>
          <p>Find idle stock and trace it to the configurations that use it.</p>
        </div>
        <div className="heading-controls">
          <Select
            label="Warehouse"
            value={warehouse}
            onChange={update(setWarehouse)}
            icon="warehouse"
          >
            <option value="">All warehouses</option>
            {inventory.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Select
            label="Idle window"
            value={threshold}
            onChange={(value) => update(setDays)(Number(value))}
            icon="clock"
          >
            {windows.map((n) => (
              <option key={n} value={n}>
                {n}-day idle window
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="overview">
        <section className="stat-card primary-stat">
          <div className="stat-label">
            <Icon name="inventory" />
            <h2>Idle units</h2>
          </div>
          <strong>{fmt(idleItems.reduce((s, i) => s + i.quantity, 0))}</strong>
          <small>
            Across {fmt(idleItems.length)} stock{' '}
            {idleItems.length === 1 ? 'position' : 'positions'}
          </small>
        </section>
        <section className="stat-card">
          <div className="stat-label">
            <Icon name="map" />
            <h2>Linked configurations</h2>
          </div>
          <strong>
            {fmt(
              new Set(
                idleItems.flatMap((i) => index.configsFor(i).map((c) => c.id))
              ).size
            )}
          </strong>
          <small>Referenced by idle stock</small>
        </section>
        <button
          className="stat-card metric-button"
          onClick={() => navigate('reviews')}
        >
          <div className="stat-label">
            <Icon name="reviews" />
            <h2>Open reviews</h2>
          </div>
          <strong>{fmt(activeReviews.length)}</strong>
          <small>
            View review queue <Icon name="arrow" size={13} />
          </small>
        </button>
        <Aging items={localItems} windows={windows} />
      </div>
      <section className="list-panel">
        <div className="panel-heading">
          <div className="section-title">
            <h2>Stock explorer</h2>
          </div>
          <div className="toggle" aria-label="Stock scope">
            {[
              ['idle', 'Idle stock'],
              ['all', 'All stock'],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={scope === key}
                onClick={() => update(setScope)(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar">
          <Search
            value={term}
            onChange={update(setTerm)}
            placeholder="Search product, SKU or warehouse"
          />
          <Select
            label="Product category"
            value={category}
            onChange={update(setCategory)}
            icon="filter"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        {visible.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHead
                    label="Product / SKU"
                    field="name"
                    sort={sort}
                    change={changeSort}
                  />
                  <th scope="col">Warehouse</th>
                  <SortHead
                    label="Units"
                    field="quantity"
                    sort={sort}
                    change={changeSort}
                  />
                  <SortHead
                    label="Days idle"
                    field="idleDays"
                    sort={sort}
                    change={changeSort}
                  />
                  <th scope="col">Configurations</th>
                  <th scope="col">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => {
                  const p = index.product.get(i.sku),
                    w = index.warehouse.get(i.warehouseId),
                    count = index.configsFor(i).length;
                  return (
                    <tr key={i.id}>
                      <td>
                        <button
                          className="product-cell"
                          onClick={() => open('stock', i.id)}
                        >
                          <ProductArt product={p} />
                          <span>
                            <b>{p?.name || i.sku}</b>
                            <code>{i.sku}</code>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="warehouse-cell">
                          {w?.name || i.warehouseId}
                        </span>
                      </td>
                      <td className="tabular">{fmt(i.quantity)}</td>
                      <td>
                        <span
                          className={
                            'age-pill ' +
                            (i.idleDays >= threshold ? 'idle' : 'current')
                          }
                        >
                          <i />
                          {fmt(i.idleDays)} days
                        </span>
                      </td>
                      <td>
                        <span className="config-count">
                          <Icon name="map" size={15} />
                          {count === 0 ? 'No mapping' : count + ' linked'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="row-open"
                          aria-label={
                            'Inspect ' +
                            (p?.name || i.sku) +
                            ' at ' +
                            (w?.name || i.warehouseId)
                          }
                          onClick={() => open('stock', i.id)}
                        >
                          <Icon name="arrow" size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No matching stock"
            message="Try another warehouse, idle window, or search term."
            action={
              <button
                className="text-button"
                onClick={() => {
                  setTerm('');
                  setCategory('');
                  setWarehouse('');
                  setDays(null);
                  setScope('all');
                  setPage(0);
                }}
              >
                Show all stock
              </button>
            }
          />
        )}
        <div className="table-footer">
          <span>
            {results.length
              ? 'Showing ' +
                (shownPage * pageSize + 1) +
                '–' +
                Math.min((shownPage + 1) * pageSize, results.length) +
                ' of ' +
                fmt(results.length)
              : '0'}{' '}
            stock positions
          </span>
          {lastPage > 0 && (
            <div className="page-buttons">
              <button
                aria-label="Previous stock page"
                disabled={!shownPage}
                onClick={() => setPage(shownPage - 1)}
              >
                <Icon name="left" size={15} />
              </button>
              <button
                aria-label="Next stock page"
                disabled={shownPage === lastPage}
                onClick={() => setPage(shownPage + 1)}
              >
                <Icon name="arrow" size={15} />
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
