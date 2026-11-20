import React, { useState } from 'react';
import ReviewAction from './ReviewAction.jsx';
import {
  reviewItemId,
  Icon,
  ProductArt,
  Empty,
  dateText,
  fmt,
  api,
} from './ui.jsx';

function Section({ title, children }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function Fields({ rows }) {
  return (
    <dl className="fields">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
function LinkRow({ name, description, onClick, icon = 'map' }) {
  return (
    <button className="link-row" onClick={onClick}>
      <Icon name={icon} />
      <span>
        <b>{name}</b>
        {description && <small>{description}</small>}
      </span>
      <Icon name="arrow" size={14} />
    </button>
  );
}
function ConfigLinks({ configs, sku, open }) {
  if (!configs.length)
    return (
      <p className="detail-hint">
        This SKU has no current configuration mapping.
      </p>
    );
  return (
    <div className="related">
      {configs.map((c) => {
        const paths = c.paths.filter((p) => p.sku === sku);
        return (
          <div className="mapping" key={c.id}>
            <LinkRow
              name={c.name}
              description={c.orderCode + ' · ' + c.chassis}
              onClick={() => open('configuration', c.id)}
            />
            {paths.length > 0 && (
              <ul>
                {paths.map((p, i) => (
                  <li key={i}>
                    {p.module}
                    <span aria-hidden="true"> › </span>
                    {p.option}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
function CreateReview({ data, item, onSaved }) {
  const [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError('');
    try {
      const review = await api('/api/inventory/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, itemId: item.id }),
      });
      onSaved(review);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (!active)
    return (
      <button className="primary-btn" onClick={() => setActive(true)}>
        <Icon name="reviews" size={16} />
        Create review
      </button>
    );
  return (
    <form className="form" onSubmit={submit}>
      <label>
        Review route
        <select name="route" required>
          {data.inventory.routes.map((r) => (
            <option value={r.id} key={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Owner
        <input
          name="owner"
          required
          maxLength={100}
          placeholder="Enter a name"
        />
      </label>
      <label>
        Reason for review
        <textarea
          name="note"
          required
          maxLength={1500}
          rows="3"
          placeholder="Describe what needs investigation"
        />
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          className="secondary-btn"
          disabled={busy}
          type="button"
          onClick={() => setActive(false)}
        >
          Cancel
        </button>
        <button className="primary-btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save review'}
        </button>
      </div>
    </form>
  );
}
export default function Details({
  kind,
  id,
  data,
  index,
  open,
  onSaved,
  user,
  refresh,
}) {
  if (kind === 'stock') {
    const item = index.item.get(id);
    if (!item) return <Empty title="Stock position unavailable" />;
    const product = index.product.get(item.sku),
      warehouse = index.warehouse.get(item.warehouseId);
    const reviews = data.inventory.reviews.filter(
      (r) => reviewItemId(r) === id
    );
    const current = reviews.find((r) => !index.status.get(r.status)?.terminal);
    return (
      <>
        <div className="detail-hero">
          <div className="detail-type">
            <Icon name="warehouse" size={15} />
            Stock position
          </div>
          <h2>{product?.name || item.sku}</h2>
          <code>{item.sku}</code>
        </div>
        <div className="detail-content">
          <div className="detail-stats">
            <div>
              <small>On hand</small>
              <strong>
                {fmt(item.quantity)} <em>units</em>
              </strong>
            </div>
            <div>
              <small>Time without use</small>
              <strong>
                {fmt(item.idleDays)} <em>days</em>
              </strong>
            </div>
          </div>
          <Section title="Stock history">
            <Fields
              rows={[
                ['Warehouse', warehouse?.name || item.warehouseId],
                ['Stocked since', dateText(item.stockedSince)],
                [
                  'Last consumption',
                  item.lastUsedAt
                    ? dateText(item.lastUsedAt)
                    : 'No recorded consumption',
                ],
                ['Snapshot', dateText(data.inventory.asOf)],
              ]}
            />
          </Section>
          {product && (
            <LinkRow
              icon="catalog"
              name="View product listing"
              description={product.model}
              onClick={() => open('product', product.sku)}
            />
          )}
          {item.recordedBuild && (
            <Section title="Recorded build configuration">
              <Fields
                rows={[
                  ['Order code', item.recordedBuild.orderCode],
                  ['Chassis', item.recordedBuild.chassis],
                ]}
              />
              <h4 className="component-heading">Installed components</h4>
              {item.recordedBuild.components.map((component, i) =>
                index.product.has(component.sku) ? (
                  <LinkRow
                    key={i}
                    name={index.product.get(component.sku).name}
                    description={
                      component.module +
                      ' › ' +
                      component.option +
                      ' · ' +
                      component.sku
                    }
                    icon="layers"
                    onClick={() => open('product', component.sku)}
                  />
                ) : (
                  <div className="archived-part" key={i}>
                    <b>{component.sku}</b>
                    <small>
                      {component.module} › {component.option}
                    </small>
                  </div>
                )
              )}
            </Section>
          )}
          <Section
            title={
              item.configurationId
                ? 'Current catalog configuration'
                : 'Linked configurations'
            }
          >
            <ConfigLinks
              configs={index.configsFor(item)}
              sku={item.sku}
              open={open}
            />
          </Section>
          <Section title="Review cases">
            {reviews.map((r) => (
              <LinkRow
                key={r.id}
                icon="reviews"
                name={index.route.get(r.route)?.label || r.route}
                description={
                  r.owner +
                  ' · ' +
                  (index.status.get(r.status)?.label || r.status)
                }
                onClick={() => open('review', r.id)}
              />
            ))}
            {!current && user.permissions.includes('review:create') && (
              <CreateReview item={item} data={data} onSaved={onSaved} />
            )}
          </Section>
        </div>
      </>
    );
  }
  if (kind === 'product') {
    const p = index.product.get(id);
    if (!p) return <Empty title="Product unavailable" />;
    const configs = index.bySku.get(id) || [],
      stock = data.inventory.items.filter((i) => i.sku === id);
    return (
      <>
        <div className="detail-hero">
          <div className="detail-type">
            <Icon name="catalog" size={15} />
            {p.category}
          </div>
          <h2>{p.name}</h2>
          <code>{p.sku}</code>
        </div>
        <div className="detail-content">
          {p.imageUrl && <ProductArt product={p} large />}
          <p className="description">{p.description}</p>
          {p.sourceUrl && (
            <a
              className="text-button"
              href={p.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Dell.com <Icon name="external" size={14} />
            </a>
          )}
          <Section title="Specifications">
            <Fields
              rows={[
                ['Model', p.model],
                ['Catalog status', p.status],
                ...Object.entries(p.specs || {}).filter(
                  ([k]) => !['Model', 'Catalog status'].includes(k)
                ),
              ]}
            />
          </Section>
          <Section title="Stock by warehouse">
            {stock.length ? (
              stock.map((i) => (
                <LinkRow
                  icon="warehouse"
                  key={i.id}
                  name={
                    index.warehouse.get(i.warehouseId)?.name || i.warehouseId
                  }
                  description={
                    fmt(i.quantity) +
                    ' units · ' +
                    fmt(i.idleDays) +
                    ' days without use'
                  }
                  onClick={() => open('stock', i.id)}
                />
              ))
            ) : (
              <p className="detail-hint">
                No stock is recorded for this product.
              </p>
            )}
          </Section>
          <Section title="Linked configurations">
            <ConfigLinks configs={configs} sku={id} open={open} />
          </Section>
        </div>
      </>
    );
  }
  if (kind === 'configuration') {
    const config = index.config.get(id);
    if (!config) return <Empty title="Configuration unavailable" />;
    return (
      <>
        <div className="detail-hero">
          <div className="detail-type">
            <Icon name="map" size={15} />
            Configuration
          </div>
          <h2>{config.name}</h2>
          <code>{config.orderCode}</code>
        </div>
        <div className="detail-content">
          <Section title="Build details">
            <Fields
              rows={[
                ['Order code', config.orderCode],
                ['Chassis', config.chassis],
              ]}
            />
            {config.systemSku && (
              <LinkRow
                icon="catalog"
                name={
                  index.product.get(config.systemSku)?.name || config.systemSku
                }
                description={config.systemSku}
                onClick={() => open('product', config.systemSku)}
              />
            )}
          </Section>
          <Section title="Configuration paths">
            {config.paths.length ? (
              config.paths.map((p, i) => (
                <LinkRow
                  key={i}
                  icon="layers"
                  name={index.product.get(p.sku)?.name || p.sku}
                  description={p.module + ' › ' + p.option + ' · ' + p.sku}
                  onClick={() => open('product', p.sku)}
                />
              ))
            ) : (
              <p className="detail-hint">There are no current option paths.</p>
            )}
          </Section>
        </div>
      </>
    );
  }
  const review = data.inventory.reviews.find((r) => r.id === id);
  if (!review) return <Empty title="Review unavailable" />;
  const item = index.item.get(reviewItemId(review)),
    sku = item?.sku ?? review.stockAtCreation?.sku;
  return (
    <>
      <div className="detail-hero">
        <div className="detail-type">
          <Icon name="reviews" size={15} />
          Review case
        </div>
        <h2>{index.product.get(sku)?.name || sku || review.itemId}</h2>
        <span className="status-pill">
          {index.status.get(review.status)?.label || review.status}
        </span>
      </div>
      <div className="detail-content">
        <Section title="Case details">
          <Fields
            rows={[
              ['Owner', review.owner],
              [
                'Review route',
                index.route.get(review.route)?.label || review.route,
              ],
              ['Created', dateText(review.createdAt)],
              ['Updated', dateText(review.updatedAt)],
            ]}
          />
          <p className="description">{review.note}</p>
          {item && (
            <LinkRow
              name="View stock position"
              description={sku}
              icon="warehouse"
              onClick={() => open('stock', item.id)}
            />
          )}
        </Section>
        {review.proposal && (
          <Section title="Proposed disposition">
            <Fields
              rows={[
                ['Proposed units', fmt(review.proposal.quantity)],
                ['Proposed by', review.proposal.actorName],
                ['Submitted', dateText(review.proposal.at)],
              ]}
            />
            <p className="description">{review.proposal.note}</p>
          </Section>
        )}
        {review.decision && (
          <Section title="Management decision">
            <Fields
              rows={[
                [
                  'Decision',
                  review.decision.action ||
                    index.status.get(review.status)?.label,
                ],
                ['Decided by', review.decision.actorName],
                ['Recorded', dateText(review.decision.at)],
              ]}
            />
            <p className="description">{review.decision.note}</p>
          </Section>
        )}
        {review.cancellation && (
          <Section title="Plan cancellation">
            <Fields
              rows={[
                ['Cancelled by', review.cancellation.actorName],
                ['Recorded', dateText(review.cancellation.at)],
                ['Released units', review.cancellation.quantity],
              ]}
            />
            <p className="description">{review.cancellation.note}</p>
          </Section>
        )}
        {review.execution && (
          <Section title="Stock posting">
            <Fields
              rows={[
                [
                  'Posted units',
                  review.execution.quantity ?? review.proposal?.quantity,
                ],
                ['Posting date', dateText(review.execution.postingDate)],
                ['Movement ID', review.execution.movementId],
                ['Executed by', review.execution.actorName],
              ]}
            />
          </Section>
        )}
        {review.followUp && (
          <Section title="Stock follow-up">
            <Fields
              rows={[
                ['Baseline snapshot', dateText(review.followUp.baselineDate)],
                ['Units at review', review.stockAtCreation?.quantity],
                ['Consumed since review', review.followUp.consumedUnits],
                ['Remaining on hand', review.followUp.remainingUnits],
              ]}
            />
          </Section>
        )}
        {review.outcome && !review.cancellation && (
          <Section title="Outcome">
            <p className="description">{review.outcome}</p>
          </Section>
        )}
        <ReviewAction
          key={review.updatedAt}
          onRefresh={refresh}
          review={review}
          index={index}
          onSaved={onSaved}
        />
        <Section title="Case history">
          <ol className="timeline">
            {review.history.map((h, i) => (
              <li key={i}>
                <b>{index.status.get(h.status)?.label || h.status}</b>
                <small>
                  {dateText(h.at)}
                  {h.actorName ? ' · ' + h.actorName : ''}
                </small>
                {h.quantity != null && <p>{fmt(h.quantity)} units</p>}
                {h.note && <p>{h.note}</p>}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}
