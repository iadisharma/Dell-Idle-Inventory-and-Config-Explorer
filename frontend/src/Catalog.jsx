import React, { useState } from 'react';
import { Empty, Icon, ProductArt, Search, Select, matches } from './ui.jsx';

export default function Catalog({ data, index, open }) {
  const [view, setView] = useState('products'),
    [term, setTerm] = useState(''),
    [category, setCategory] = useState('');
  const products = data.catalog.products.filter(
    (p) =>
      (!category || p.category === category) &&
      matches(term, p.name, p.sku, p.model, p.category)
  );
  const configs = data.catalog.configurations.filter((c) =>
    matches(
      term,
      c.name,
      c.id,
      c.orderCode,
      c.chassis,
      c.systemSku,
      ...c.paths.flatMap((p) => [p.module, p.option, p.sku])
    )
  );
  const categories = [
    ...new Set(data.catalog.products.map((p) => p.category)),
  ].sort();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Product catalog</h1>
          <p>Explore Dell products, configuration options, and order codes.</p>
        </div>
      </div>
      <section className="list-panel">
        <div className="panel-heading">
          <h2>Catalog explorer</h2>
          <div className="toggle">
            {[
              ['products', 'Products'],
              ['configurations', 'Configurations'],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={view === id}
                onClick={() => {
                  setView(id);
                  setTerm('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar">
          <Search
            value={term}
            onChange={setTerm}
            placeholder={
              view === 'products'
                ? 'Search product, SKU or model'
                : 'Search order code, chassis or SKU'
            }
          />
          {view === 'products' && (
            <Select
              icon="filter"
              label="Catalog category"
              value={category}
              onChange={setCategory}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </div>
        {view === 'products' ? (
          products.length ? (
            <div className="product-grid">
              {products.map((p) => (
                <button
                  key={p.sku}
                  className="product-card"
                  onClick={() => open('product', p.sku)}
                >
                  <ProductArt large product={p} />
                  <span className="card-copy">
                    <small>{p.category}</small>
                    <b>{p.name}</b>
                    <code>{p.sku}</code>
                  </span>
                  <span className="card-foot">
                    Product details
                    <Icon name="arrow" size={14} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty title="No matching products" />
          )
        ) : configs.length ? (
          <div className="config-list">
            {configs.map((c) => (
              <button
                className="config-row"
                key={c.id}
                onClick={() => open('configuration', c.id)}
              >
                {index.product.get(c.systemSku)?.imageUrl ? (
                  <ProductArt product={index.product.get(c.systemSku)} />
                ) : (
                  <span className="type-icon">
                    <Icon name="layers" />
                  </span>
                )}
                <span>
                  <b>{c.name}</b>
                  <small>
                    {c.orderCode} · {c.chassis}
                  </small>
                </span>
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        ) : (
          <Empty title="No matching configurations" />
        )}
      </section>
    </>
  );
}
