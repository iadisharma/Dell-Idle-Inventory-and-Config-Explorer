import React, { useEffect, useRef, useState } from 'react';

const paths = {
  insights: (
    <>
      <path d="M4 20h17M7 16v-4m5 4V7m5 9v-7" />
    </>
  ),
  audit: (
    <>
      <path d="M4 4h12l4 4v13H4zM16 4v5h4M8 12h8m-8 4h6" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-1a7 7 0 0 1 14 0v1" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  inventory: (
    <>
      <path d="m3 7 9-4 9 4-9 4z" />
      <path d="M3 7v10l9 4 9-4V7M12 11v10M7.5 5l9 4" />
    </>
  ),
  catalog: (
    <>
      <rect x="3" y="4" width="7" height="7" rx="1" />
      <rect x="14" y="4" width="7" height="7" rx="1" />
      <rect x="3" y="15" width="7" height="6" rx="1" />
      <rect x="14" y="15" width="7" height="6" rx="1" />
    </>
  ),
  reviews: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  warehouse: (
    <>
      <path d="m3 9 9-6 9 6v11H3zM7 20v-8h10v8M7 15h10M7 18h10" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 10h18" />
    </>
  ),
  filter: (
    <>
      <path d="M3 7h6m4 0h8M3 17h10m4 0h4" />
      <circle cx="11" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6" />
    </>
  ),
  layers: (
    <>
      <path d="m3 7 9-4 9 4-9 4zm0 5 9 4 9-4m-18 5 9 4 9-4" />
    </>
  ),
  arrow: (
    <>
      <path d="m9 6 6 6-6 6" />
    </>
  ),
  down: (
    <>
      <path d="m7 10 5 5 5-5" />
    </>
  ),
  sort: (
    <>
      <path d="m7 10 3-3 3 3m-2 4 3 3 3-3" />
    </>
  ),
  left: (
    <>
      <path d="m14 6-6 6 6 6" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12m0-12L6 18" />
    </>
  ),
  external: (
    <>
      <path d="M13 4h7v7m0-7-9 9M9 5H5v14h14v-4" />
    </>
  ),
  map: (
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="18" cy="5" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M7 12h3c3 0 2-7 6-7m-6 7c3 0 2 7 6 7" />
    </>
  ),
  box: (
    <>
      <path d="M4 6h16v14H4zM3 3h18v4H3zm6 8h6" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  note: (
    <>
      <path d="M4 4h16v13l-4 4H4zM8 9h8m-8 4h6" />
    </>
  ),
};
export function Icon({ name, size = 18, ...props }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
export const reviewItemId = (review) =>
  Object.hasOwn(review, 'currentItemId') ? review.currentItemId : review.itemId;
export const fmt = (value) => Number(value).toLocaleString();
export function dateText(value, long = false) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: long ? 'long' : 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
}
export const matches = (term, ...values) =>
  values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(term.trim().toLowerCase())
  );
export function Search({ value, onChange, placeholder }) {
  return (
    <label className="search">
      <Icon name="search" size={17} />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function Select({ value, onChange, label, icon, children }) {
  return (
    <label className="select">
      {icon && <Icon name={icon} size={16} />}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <Icon name="down" size={13} />
    </label>
  );
}
export function ProductArt({ product, large = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product?.imageUrl]);
  return (
    <span className={'product-art' + (large ? ' large' : '')}>
      {product?.imageUrl && !failed ? (
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name="inventory" size={large ? 48 : 21} />
      )}
    </span>
  );
}
export function Empty({ title = 'No matches', message, action }) {
  return (
    <div className="empty">
      <Icon name="search" size={24} />
      <strong>{title}</strong>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}
export function Modal({ children, title, onClose, back }) {
  const ref = useRef(null);
  useEffect(() => {
    const modal = ref.current,
      trigger = document.activeElement;
    modal.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      modal.close();
      document.body.style.overflow = previous;
      trigger?.focus?.();
    };
  }, []);
  useEffect(() => {
    ref.current?.querySelector('[data-drawer-scroll]')?.scrollTo(0, 0);
  }, [title]);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (
          e.target === ref.current &&
          e.clientX < ref.current.getBoundingClientRect().left
        )
          onClose();
      }}
    >
      <div className="drawer-top">
        {back ? (
          <button className="text-button" onClick={back}>
            <Icon name="left" size={15} />
            Back
          </button>
        ) : (
          <span>Workspace details</span>
        )}
        <button
          className="icon-btn"
          aria-label="Close details"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="drawer-scroll" data-drawer-scroll>
        {children}
      </div>
    </dialog>
  );
}
export async function api(url, options = {}) {
  const headers = new Headers(options.headers);
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method))
    headers.set('X-Workspace-Request', '1');
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('workspace:session-expired'));
    }
    const error = new Error(
      typeof data?.error === 'string'
        ? data.error
        : data?.error?.message ||
            data?.message ||
            'Request failed (' + response.status + ').'
    );
    error.status = response.status;
    throw error;
  }
  if (data === null)
    throw new Error('The service returned an unreadable response.');
  return data;
}
