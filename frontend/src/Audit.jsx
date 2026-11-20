import React, { useEffect, useRef, useState } from 'react';
import { api, Empty, Icon, Search } from './ui.jsx';

const verbs = {
  create: 'Opened review',
  propose: 'Proposed disposition',
  approve: 'Approved plan',
  reject: 'Rejected plan',
  cancel: 'Cancelled plan',
  execute: 'Executed plan',
};
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export default function Audit({ data, index, open, refreshKey }) {
  const [term, setTerm] = useState(''),
    [rows, setRows] = useState([]),
    [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const request = useRef(null);
  async function load(query, before = null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '30' });
    if (query) {
      const exactAction = Object.entries(verbs).find(
        ([, label]) => label.toLowerCase() === query.toLowerCase()
      );
      params.set('q', exactAction?.[0] || query);
    }
    if (before != null) params.set('before', String(before));
    try {
      const result = await api('/api/inventory/audit?' + params, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRows((previous) =>
        before == null ? result.events : [...previous, ...result.events]
      );
      setCursor(result.nextCursor);
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    request.current?.abort();
    setRows([]);
    setCursor(null);
    setError('');
    setLoading(true);
    const timer = window.setTimeout(
      () => load(term.trim()),
      term.trim() ? 250 : 0
    );
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
    };
  }, [term, refreshKey]);
  const reviewMap = new Map(data.inventory.reviews.map((r) => [r.id, r]));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Audit trail</h1>
          <p>
            Inspect recorded inventory decisions, quantities, and the people
            responsible.
          </p>
        </div>
      </div>
      <section className="list-panel">
        <div className="panel-heading">
          <h2>Workflow activity</h2>
          <span className="muted">{rows.length} loaded</span>
        </div>
        <div className="toolbar">
          <Search
            value={term}
            onChange={setTerm}
            placeholder="Search actor, SKU, case or action"
          />
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              className="secondary-btn"
              onClick={() => load(term.trim(), cursor)}
            >
              Try again
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time (UTC)</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Review case</th>
                  <th>Units</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const r = reviewMap.get(e.reviewId),
                    sku = e.sku ?? r?.stockAtCreation?.sku;
                  return (
                    <tr key={e.id}>
                      <td className="audit-time">
                        {timeFormat.format(new Date(e.at))}
                      </td>
                      <td>{verbs[e.action] || e.action}</td>
                      <td>{e.actorName || '—'}</td>
                      <td>
                        {r ? (
                          <button
                            className="text-button"
                            onClick={() => open('review', r.id)}
                          >
                            {index.product.get(sku)?.name || sku || r.id}
                          </button>
                        ) : (
                          e.reviewId
                        )}
                      </td>
                      <td className="tabular">{e.quantity ?? '—'}</td>
                      <td className="audit-note">{e.note || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {loading && (
          <div className="loading" role="status">
            <Icon name="refresh" />
            Loading activity…
          </div>
        )}
        {!loading && !error && !rows.length && (
          <Empty
            title={term ? 'No matching events' : 'No activity recorded'}
            message={
              term
                ? 'Try another actor, SKU or action.'
                : 'Workflow activity will appear here as cases change.'
            }
          />
        )}
        {cursor != null && !loading && !error && (
          <div className="table-footer">
            <button
              className="secondary-btn"
              onClick={() => load(term.trim(), cursor)}
            >
              Load more
            </button>
          </div>
        )}
      </section>
    </>
  );
}
