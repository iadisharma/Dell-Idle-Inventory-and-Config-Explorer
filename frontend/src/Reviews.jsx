import React, { useState } from 'react';
import {
  reviewItemId,
  Empty,
  Icon,
  Search,
  Select,
  matches,
  dateText,
} from './ui.jsx';

export default function Reviews({
  data,
  index,
  open,
  navigate,
  user,
  initiallyActionable = false,
}) {
  const [term, setTerm] = useState(''),
    [status, setStatus] = useState('');
  const [actionable, setActionable] = useState(initiallyActionable);
  const reviews = data.inventory.reviews
    .filter(
      (r) =>
        (!status || r.status === status) &&
        (!actionable || r.availableActions?.length > 0) &&
        matches(
          term,
          r.owner,
          r.note,
          r.stockAtCreation?.sku,
          index.item.get(reviewItemId(r))?.sku,
          index.product.get(
            index.item.get(reviewItemId(r))?.sku ?? r.stockAtCreation?.sku
          )?.name
        )
    )
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Review queue</h1>
          <p>
            Track disposition cases from investigation through approval and
            execution.
          </p>
        </div>
      </div>
      <section className="list-panel">
        <div className="panel-heading">
          <h2>Review cases</h2>
          <span className="muted">{data.inventory.reviews.length} total</span>
        </div>
        <div className="toolbar">
          <Search
            value={term}
            onChange={setTerm}
            placeholder="Search product, SKU or owner"
          />
          {(user.permissions.includes('plan:propose') ||
            user.permissions.includes('plan:decide') ||
            user.permissions.includes('plan:execute')) && (
            <label className="action-filter">
              <input
                type="checkbox"
                checked={actionable}
                onChange={(e) => setActionable(e.target.checked)}
              />
              My available actions
            </label>
          )}
          <Select
            icon="filter"
            label="Review status"
            value={status}
            onChange={setStatus}
          >
            <option value="">All statuses</option>
            {data.inventory.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        {reviews.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Owner</th>
                  <th>Review route</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>
                    <span className="sr-only">Case details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => {
                  const sku =
                    index.item.get(reviewItemId(r))?.sku ??
                    r.stockAtCreation?.sku;
                  return (
                    <tr key={r.id}>
                      <td>
                        <button
                          className="product-cell"
                          onClick={() => open('review', r.id)}
                        >
                          <span>
                            <b>
                              {index.product.get(sku)?.name || sku || r.itemId}
                            </b>
                            <code>{sku}</code>
                          </span>
                        </button>
                      </td>
                      <td>{r.owner}</td>
                      <td>{index.route.get(r.route)?.label || r.route}</td>
                      <td>
                        <span
                          className={
                            'status-pill ' +
                            (index.status.get(r.status)?.terminal
                              ? 'complete'
                              : '')
                          }
                        >
                          {index.status.get(r.status)?.label || r.status}
                        </span>
                      </td>
                      <td>{dateText(r.updatedAt)}</td>
                      <td>
                        <button
                          className="row-open"
                          aria-label={'Open review for ' + (sku || r.itemId)}
                          onClick={() => open('review', r.id)}
                        >
                          <Icon name="arrow" size={16} />
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
            title={
              data.inventory.reviews.length
                ? 'No matching reviews'
                : 'No review cases yet'
            }
            message={
              data.inventory.reviews.length
                ? 'Try another status or search term.'
                : user.permissions.includes('review:create')
                  ? 'Open a stock position to assign the first follow-up.'
                  : 'Analysts can open review cases from stock positions.'
            }
            action={
              <button
                className="text-button"
                onClick={() => navigate('inventory')}
              >
                Explore inventory <Icon name="arrow" size={14} />
              </button>
            }
          />
        )}
      </section>
    </>
  );
}
