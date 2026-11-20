import React, { useEffect, useState } from 'react';
import { api, dateText, Empty, Icon, Select } from './ui.jsx';
import './insights.css';

function Trend({ points }) {
  const [selected, setSelected] = useState(null);
  const current = Math.min(selected ?? points.length - 1, points.length - 1);
  const point = points[current];
  if (!point) return <Empty title="No reporting history" />;
  const maximum = Math.max(1, ...points.map((p) => p.onHandUnits));
  const x = (i) => 30 + (i * 540) / Math.max(1, points.length - 1);
  const y = (n) => 135 - (n * 107) / maximum;
  const line = (key) => points.map((p, i) => x(i) + ',' + y(p[key])).join(' ');
  return (
    <section className="ins-panel trend-panel">
      <div className="ins-title">
        <h2>Stock over time</h2>
        <span>{points.length} weekly checkpoints</span>
      </div>
      <div className="trend-legend">
        <span>On hand</span>
        <span>Idle</span>
      </div>
      <svg
        className="trend-chart"
        viewBox="0 0 600 160"
        role="img"
        aria-label="Weekly on-hand and idle units. Exact values are available in the weekly data table."
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="30"
              x2="570"
              y1={y(f * maximum)}
              y2={y(f * maximum)}
              stroke="#dce5ec"
              strokeDasharray="3 3"
            />
            <text x="25" textAnchor="end" y={y(f * maximum) + 4}>
              {Math.round(f * maximum)}
            </text>
          </g>
        ))}
        <polygon
          points={`30,135 ${line('idleUnits')} 570,135`}
          fill="#dbf0ef"
        />
        <polyline
          points={line('onHandUnits')}
          fill="none"
          stroke="#1e64a6"
          strokeWidth="3"
        />
        <polyline
          points={line('idleUnits')}
          fill="none"
          stroke="#007e78"
          strokeWidth="3"
        />
        <line
          x1={x(current)}
          x2={x(current)}
          y1="19"
          y2="137"
          stroke="#657b89"
          strokeDasharray="3 4"
        />
        <circle
          cx={x(current)}
          cy={y(point.onHandUnits)}
          r="4.5"
          fill="#1e64a6"
        />
        <circle
          cx={x(current)}
          cy={y(point.idleUnits)}
          r="4.5"
          fill="#007e78"
        />
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={x(i) - 270 / (points.length - 1)}
            y="10"
            width={540 / (points.length - 1)}
            height="130"
            fill="transparent"
            onMouseEnter={() => setSelected(i)}
            onClick={() => setSelected(i)}
          />
        ))}
      </svg>
      <div className="trend-readout">
        <label>
          Week ending{' '}
          <select
            aria-label="Trend checkpoint"
            value={current}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {points.map((p, i) => (
              <option key={p.date} value={i}>
                {dateText(p.date)}
              </option>
            ))}
          </select>
        </label>
        <span>
          <b>{point.onHandUnits}</b> on hand · <b>{point.idleUnits}</b> idle
        </span>
      </div>
      <details className="trend-table">
        <summary>View weekly data</summary>
        <table>
          <thead>
            <tr>
              <th>Week ending</th>
              <th>On hand</th>
              <th>Idle</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <td>{dateText(p.date)}</td>
                <td>{p.onHandUnits}</td>
                <td>{p.idleUnits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export default function Insights({ data, index, open }) {
  const [warehouse, setWarehouse] = useState('');
  const [version, setVersion] = useState(0);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [onlyUncovered, setOnlyUncovered] = useState(false);
  const location = data.inventory.warehouses.some((w) => w.id === warehouse)
    ? warehouse
    : '';
  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setError('');
    const query = location
      ? '?' + new URLSearchParams({ warehouseId: location })
      : '';
    api('/api/inventory/insights' + query, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setReport(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [location, version, data.inventory]);
  const fmt = (n) => n.toLocaleString();
  const money = (cents) => {
    if (cents == null || !report.currency) return 'Unpriced';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: report.currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  };
  const s = report?.summary;
  const priorities =
    report?.priorities.filter((p) => !onlyUncovered || !p.reviewId) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Inventory insights</h1>
          <p>
            Find where idle stock is concentrated and measure what approved
            plans actually issued.
          </p>
        </div>
        <Select
          label="Insights warehouse"
          value={location}
          onChange={setWarehouse}
          icon="warehouse"
        >
          <option value="">All warehouses</option>
          {data.inventory.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="secondary-btn"
            onClick={() => setVersion((v) => v + 1)}
          >
            Retry report
          </button>
        </div>
      )}
      {!report && !error && (
        <div className="loading" role="status">
          Calculating inventory insights…
        </div>
      )}
      {report && (
        <>
          <div className="ins-metrics">
            {[
              [
                'Idle inventory value',
                s.idleUnits > 0 && s.unpricedUnits === s.idleUnits
                  ? 'Unpriced'
                  : money(s.valueCents),
                s.unpricedUnits
                  ? fmt(s.unpricedUnits) + ' units without cost data'
                  : 'Estimated from demo unit costs',
              ],
              [
                'Idle share',
                s.onHandUnits
                  ? ((100 * s.idleUnits) / s.onHandUnits).toFixed(1) + '%'
                  : '—',
                fmt(s.idleUnits) +
                  ' of ' +
                  fmt(s.onHandUnits) +
                  ' units on hand',
              ],
              [
                'Without an open review',
                fmt(s.uncoveredPositions),
                'Idle stock positions',
              ],
              [
                'Issued through plans',
                fmt(s.executedUnits),
                'Units posted from approved cases',
              ],
            ].map(([label, value, detail]) => (
              <section className="ins-metric" key={label}>
                <h2>{label}</h2>
                <strong>{value}</strong>
                <small>{detail}</small>
              </section>
            ))}
          </div>
          <div className="ins-grid">
            <Trend points={report.trend} />
            <section className="ins-panel">
              <div className="ins-title">
                <h2>Warehouse exposure</h2>
              </div>
              <p className="ins-desc">
                Idle units as a share of stock at each location.
              </p>
              {report.warehouses.map((w) => (
                <div key={w.id} className="exposure-row">
                  <div>
                    <strong>{w.name}</strong>
                    <span>
                      {w.idleUnits} / {w.onHandUnits} units
                    </span>
                  </div>
                  <progress
                    max={w.onHandUnits || 1}
                    value={w.idleUnits}
                    aria-label={w.name + ' idle units'}
                  />
                </div>
              ))}
            </section>
          </div>
          <section className="list-panel">
            <div className="panel-heading">
              <div>
                <h2>Priority stock</h2>
                <p className="ins-desc">
                  Idle positions ranked by estimated inventory value as of{' '}
                  {dateText(report.asOf)}.
                </p>
              </div>
              <label className="review-filter">
                <input
                  type="checkbox"
                  checked={onlyUncovered}
                  onChange={(e) => setOnlyUncovered(e.target.checked)}
                />{' '}
                Without an open review
              </label>
            </div>
            {priorities.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Stock position</th>
                      <th>Warehouse</th>
                      <th>Idle units</th>
                      <th>Days idle</th>
                      <th>Estimated value</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priorities.map((p) => (
                      <tr key={p.itemId}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => open('stock', p.itemId)}
                          >
                            {index.product.get(p.sku)?.name ?? p.sku}
                          </button>
                        </td>
                        <td>
                          {index.warehouse.get(p.warehouseId)?.name ??
                            p.warehouseId}
                        </td>
                        <td>{fmt(p.quantity)}</td>
                        <td>{p.idleDays}</td>
                        <td>{money(p.valueCents)}</td>
                        <td>
                          {p.reviewId ? (
                            <button
                              className="text-button"
                              onClick={() => open('review', p.reviewId)}
                            >
                              View case <Icon name="arrow" size={13} />
                            </button>
                          ) : (
                            'Unassigned'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No matching idle positions" />
            )}
          </section>
        </>
      )}
    </>
  );
}
