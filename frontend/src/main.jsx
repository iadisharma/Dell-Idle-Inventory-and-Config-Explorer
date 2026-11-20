import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, dateText, Icon, Modal } from './ui.jsx';
import Inventory from './Inventory.jsx';
import Catalog from './Catalog.jsx';
import Reviews from './Reviews.jsx';
import Details from './Details.jsx';
import Session from './Session.jsx';
import Insights from './Insights.jsx';
import Audit from './Audit.jsx';
import './styles.css';

const pages = [
  { id: 'inventory', name: 'Inventory' },
  { id: 'catalog', name: 'Product catalog' },
  { id: 'reviews', name: 'Review queue' },
  { id: 'insights', name: 'Insights' },
  { id: 'audit', name: 'Audit trail', permission: 'audit:read' },
];
const getPage = (homePage) =>
  pages.some((p) => p.id === window.location.hash.slice(1))
    ? window.location.hash.slice(1)
    : homePage;
const toMap = (records, key) =>
  new Map(records.map((record) => [record[key], record]));
function buildIndex({ catalog, inventory }) {
  const bySku = new Map(),
    config = toMap(catalog.configurations, 'id');
  for (const c of catalog.configurations) {
    const skus = new Set(c.paths.map((p) => p.sku));
    if (c.systemSku) skus.add(c.systemSku);
    for (const sku of skus) {
      if (!bySku.has(sku)) bySku.set(sku, []);
      bySku.get(sku).push(c);
    }
  }
  return {
    bySku,
    config,
    product: toMap(catalog.products, 'sku'),
    warehouse: toMap(inventory.warehouses, 'id'),
    item: toMap(inventory.items, 'id'),
    status: toMap(inventory.statuses, 'id'),
    route: toMap(inventory.routes, 'id'),
    configsFor: (item) =>
      item.configurationId
        ? [config.get(item.configurationId)].filter(Boolean)
        : bySku.get(item.sku) || [],
  };
}
function Workspace({ user, logout, signingOut, signOutError }) {
  const accessiblePages = pages.filter(
    (p) => !p.permission || user.permissions.includes(p.permission)
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const homePage = user.permissions.some((permission) =>
    ['plan:propose', 'plan:decide', 'plan:execute'].includes(permission)
  )
    ? 'reviews'
    : 'inventory';
  const [page, setPage] = useState(() => getPage(homePage)),
    [stack, setStack] = useState([]);
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const request = useRef(null);
  useEffect(() => {
    const change = () => {
      setPage(getPage(homePage));
      setStack([]);
      setNotice('');
    };
    window.addEventListener('hashchange', change);
    refresh();
    return () => {
      window.removeEventListener('hashchange', change);
      request.current?.abort();
    };
  }, []);
  async function refresh() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const [catalog, inventory] = await Promise.all(
        ['/api/catalog', '/api/inventory'].map((url) =>
          api(url, { signal: controller.signal })
        )
      );
      if (!controller.signal.aborted) {
        setData({ catalog, inventory });
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function saved(review) {
    // Apply the successful mutation immediately and refresh derived follow-up data.
    setData((old) => ({
      ...old,
      inventory: {
        ...old.inventory,
        reviews: [
          review,
          ...old.inventory.reviews.filter((r) => r.id !== review.id),
        ],
      },
    }));
    setStack((current) =>
      current.at(-1)?.kind === 'review'
        ? current
        : [...current, { kind: 'review', id: review.id }]
    );
    setNotice('Review saved.');
    refresh();
  }
  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  const open = (kind, id) => setStack((current) => [...current, { kind, id }]);
  function navigate(id) {
    window.location.hash = id;
    setStack([]);
    setPage(id);
  }
  const active = stack.at(-1);
  const common = { data, index, open, navigate, user, refreshKey, refresh };
  const visiblePage = accessiblePages.some((p) => p.id === page)
    ? page
    : 'inventory';
  return (
    <>
      <a
        className="skip"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="masthead">
        <div className="shell header-inner">
          <img
            className="brand"
            src="/dell-technologies.svg"
            alt="Dell Technologies"
          />
          <span className="app-brand">Inventory workspace</span>
          <div className="header-right">
            <span className="session-person">
              <Icon name="user" size={17} />
              <span>
                <b>{user.name}</b>
                <small>{user.roleLabel || user.role}</small>
              </span>
            </span>
            {data && (
              <span className="snapshot">
                <i />
                Snapshot &nbsp;{dateText(data.inventory.asOf)}
              </span>
            )}
            <button
              className={'header-refresh' + (loading ? ' busy' : '')}
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh workspace data"
              title="Reload catalog and inventory data"
            >
              <Icon name="refresh" size={16} />
              <span>Refresh</span>
            </button>
            <button
              className="header-refresh"
              aria-label="Sign out"
              title="Sign out"
              onClick={logout}
              disabled={signingOut}
            >
              <Icon name="logout" size={16} />
              <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </div>
      </header>
      <nav className="main-nav" aria-label="Workspace">
        <div className="shell nav-inner">
          {accessiblePages.map((p) => (
            <a
              key={p.id}
              className={p.id === visiblePage ? 'active' : ''}
              href={'#' + p.id}
              aria-current={p.id === visiblePage ? 'page' : undefined}
            >
              <Icon name={p.id} size={17} />
              {p.name}
            </a>
          ))}
        </div>
      </nav>
      <main id="main-content" tabIndex={-1} className="shell main-content">
        {signOutError && (
          <div className="error-banner" role="alert">
            Sign out failed. {signOutError}
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <div>
              <b>Workspace refresh failed</b>
              <p>
                {error}
                {data ? ' The last loaded snapshot is shown.' : ''}
              </p>
            </div>
            <button className="secondary-btn" onClick={refresh}>
              Try again
            </button>
          </div>
        )}
        {!data && loading && (
          <div role="status" className="loading">
            <Icon name="refresh" />
            Loading workspace…
          </div>
        )}
        {data &&
          (visiblePage === 'audit' ? (
            <Audit {...common} />
          ) : visiblePage === 'insights' ? (
            <Insights {...common} />
          ) : visiblePage === 'catalog' ? (
            <Catalog {...common} />
          ) : visiblePage === 'reviews' ? (
            <Reviews
              {...common}
              initiallyActionable={
                !window.location.hash && homePage === 'reviews'
              }
            />
          ) : (
            <Inventory {...common} />
          ))}
      </main>
      <footer className="shell page-footer">
        <span>Dell inventory workspace</span>
        <span>Portfolio demo · Synthetic inventory data</span>
      </footer>
      {active && data && (
        <Modal
          title={active.kind + ' details'}
          onClose={() => setStack([])}
          back={stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : null}
        >
          <Details
            key={active.kind + ':' + active.id}
            kind={active.kind}
            id={active.id}
            {...common}
            onSaved={saved}
          />
        </Modal>
      )}
      <div role="status" className="sr-only">
        {notice}
      </div>
    </>
  );
}
createRoot(document.getElementById('root')).render(
  <Session>
    {(auth) => (
      <Workspace
        key={JSON.stringify([
          auth.user.id,
          auth.user.role,
          auth.user.permissions,
        ])}
        {...auth}
      />
    )}
  </Session>
);
