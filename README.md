# Dell Inventory Operations Workspace

A React and Node.js portfolio project for investigating idle inventory and acting on it. Trace a component to Dell system configurations, propose a stock issue, obtain an independent decision and follow the resulting units through the ledger. The catalog contains real Dell products, photos and source links. Stock, estimated costs, order codes, approvals and warehouses are illustrative data.

## Run locally

Use Node.js 18.15 or later and npm. From the project root, run

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Select a demo role, then click **Sign in**. Switch users with **Sign out** or use separate browser profiles. The login page supplies the local demo password. The accounts below all use `InventoryDemo!26`.

| User group | Demo account | Additional permissions |
| --- | --- | --- |
| Inventory Analyst | `analyst@demo.local` | Open a case against a physical stock position, assign an owner and record the reason |
| Supply Planner | `planner@demo.local` | Propose a quantity with a rationale and issue stock after approval |
| Inventory Manager | `manager@demo.local` | Approve or reject proposals, cancel unissued plans and inspect or search the operations audit trail |

A fresh analyst login opens Inventory. Planners and managers land in the review queue filtered to actions they can perform. Uncheck **My available actions** to see all cases. Each group can inspect inventory, product listings, configuration paths, cases and insights. The identity service loads role permissions from JSON. Catalog and Inventory verify the session on API requests. A separate planner executes the approved issue.

## Five-minute demonstration

1. **Analyst.** Filter inventory to Austin and open the 512 GB SSD. The fresh fixture has 40 physical units, two current order codes, and three component paths. Create a case, choose a route, enter an owner and record the demand to investigate.
2. **Planner.** Open that case in **Review queue** and propose 6 units against the identified demand. The proposal records your identity, quantity, rationale and timestamp.
3. **Manager.** Review the proposal and approve it with a reason. The position still has 40 units. Rejecting a proposal closes the case with the recorded reason. A manager can also cancel an approved, unissued plan to release its reservation.
4. **Planner.** Execute the approved plan. The position now has 34 units. Its activity clock restarts on the posting date. The case history links the execution to a stock movement. A repeated request with the same idempotency key returns the original result.
5. **Manager.** Open **Audit trail** to inspect who opened, proposed, decided and executed the case. In **Insights**, compare the idle trend, warehouse exposure, priority positions and units actually issued through review plans.

For a shorter demo, the fixture already includes a Bengaluru memory proposal awaiting a decision and an Austin dock plan awaiting execution. Each seeded case carries its own synthetic history. The audit feed records operations submitted to the running application.

## Architecture

```text
frontend/  React + Vite, same-origin API proxy
  ├── /api/auth       → Identity  :4103  → JSON accounts and role policy + expiring sessions
  ├── /api/catalog    → Catalog   :4101  → catalog.json + product photos
  └── /api/inventory  → Inventory :4102  → inventory.json + SQLite operations database
                            Catalog and Inventory consult Identity for the caller's permissions.
```

- **Authentication.** Identity verifies per-account salted scrypt password hashes and issues random opaque tokens in HttpOnly, SameSite=Strict cookies. Login attempts are throttled. Logout revokes the session. Current role assignments and account status are checked during session lookup. Mutating APIs require a same-origin application request header. Public resources are the login bootstrap, product photos and health checks.
- **Case state and stock integrity.** Opening a case captures its stock identity. Proposals carry a quantity and rationale. Decisions and execution enforce role, workflow stage, individual separation of duties, current stock availability and expected case version. Rejected cases and completed cases retain their histories.
- **Transactional execution.** Runtime reviews, stock issues, audit entries and idempotency responses are stored in SQLite using the local libSQL client. The issue, case update, audit event and response record commit in one write transaction. A unique review-to-movement constraint prevents a case from issuing stock twice. Bounded retries handle database writer contention. [SQLite isolation](https://www.sqlite.org/isolation.html)
- **Stock accounting.** On-hand quantity is the sum of dated receipts less consumption through the configured report date. Idle days start at the later of the last consumption and the start of the current positive balance. A stockout resets the holding period. Each position is counted once regardless of how many order codes or option paths reference its SKU. A finished system retains its recorded build even after catalog options change.
- **Analytics.** A single chronological replay of movements produces all the weekly checkpoints under the selected idle policy. Insights aggregate per warehouse, price idle quantities using integer cents, identify unpriced stock and rank positions by estimated value. A position can leave the idle queue after a partial issue. The separate units-issued metric counts actual plan-linked consumption and retains postings from retired stock accounts. The fixture report date drives stock calculations and the service clock timestamps user actions.
- **Tracking.** Case history records actors, reasons and transitions. The manager audit feed uses sequence-based cursor pagination and searchable events. Newer inserts do not shift the cursor used to retrieve older entries. Audit records are append-only through the application API.

## Data and configuration

| File | Responsibility |
| --- | --- |
| [catalog.json](backend/catalog/data/catalog.json) | Real product names, demo SKUs, categories, model numbers, specs, photos, official sources and configuration paths |
| [inventory.json](backend/inventory/data/inventory.json) | Warehouses, accounts, dated movements, build snapshots, seeded cases, idle thresholds, trend length and illustrative unit costs |
| [disposition.json](backend/inventory/data/disposition.json) | Status identifiers and display labels for proposal and decision stages |
| [identity.json](backend/identity/data/identity.json) | Accounts, salted password hashes and role-to-permission assignments |
| [demo.json](backend/identity/data/demo.json) | Public demo account selection and local sign-in hint |
| `backend/inventory/data/operations.sqlite` | Runtime transactions, review overrides, issue postings, audit records and idempotency keys |

To add a product, copy a catalog record with a new stable SKU, source URL and specs. To stock it, add a stock account referencing that SKU and a warehouse, then add a dated receipt referencing the account ID. Attach component paths to current configurations where applicable. Product photos can use an HTTPS URL or a local file in `backend/catalog/product-images/`. Some retired products use current Dell technical references and retain the original listing URL as provenance. A SKU without a configured unit cost remains visible as unpriced.

Run `npm run check:data` and click **Refresh**. JSON changes take effect on read. Runtime operations overlay baseline data. Existing `reviews.state.json` overrides are imported once when a new operations database initializes. Back up the SQLite database with its online backup facility, or stop the inventory service before copying its database and sidecar files.

## Commands and configuration

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend and all three services |
| `npm run build` followed by `npm start` | Build and locally serve the optimized frontend with the services |
| `npm test` | Test stock calculations, weekly insights, authentication, case transitions, transaction replay and cross-service contracts |
| `npm run check:data` | Validate source JSON, identity configuration, references and local product photos |
| `npm run identity`, `npm run catalog`, `npm run inventory` | Start services individually |
| `npm run dev --workspace frontend` | Start the standalone React development server |

Change ports with `WEB_PORT`, `CATALOG_PORT`, `INVENTORY_PORT` and `IDENTITY_PORT`. Set `CATALOG_ORIGIN`, `INVENTORY_ORIGIN` or `IDENTITY_ORIGIN` when services use different addresses. Override data locations with `CATALOG_DATA_FILE`, `INVENTORY_DATA_FILE`, `INVENTORY_WORKFLOW_FILE`, `INVENTORY_DB_FILE`, `INVENTORY_REVIEWS_FILE` (legacy import), `IDENTITY_DATA_FILE` and `IDENTITY_DEMO_FILE`.

To provision a private account, run the following command and enter its password at the hidden prompt. To rotate an existing private account’s password, supply just its email. Use a separate `IDENTITY_DATA_FILE` for private accounts. The initial template needs the role definitions and an empty `users` array.

```sh
npm run account -- --email operator@example.com --name "Warehouse Operator" --role analyst
```

## API surface

| Request | Access and result |
| --- | --- |
| `GET /api/auth/demo` | Public demo profiles when enabled |
| `POST /api/auth/login`, `POST /api/auth/logout` | Create or revoke a session |
| `GET /api/auth/session` | Signed-in user and effective permissions |
| `GET /api/catalog`, `/api/catalog/products/:sku`, `/api/catalog/configurations/:id-or-orderCode` | Authenticated catalog and configuration lookups |
| `GET /api/inventory` | Stock and reviews with actions available to the caller |
| `POST /api/inventory/reviews` | Analyst opens a case with `itemId`, `owner`, `route` and `note` |
| `POST /api/inventory/reviews/:id/actions` | Submit `propose`, `approve`, `reject`, `cancel` or `execute` with the current `expectedUpdatedAt`. Proposals include `quantity` |
| `GET /api/inventory/insights?warehouseId=…` | Historical stock checkpoints, value exposure, case coverage and issued units |
| `GET /api/inventory/audit?q=…&before=…&limit=…` | Manager-only activity feed with an exclusive cursor |
| `GET /health` on each backend port | Service health |

Use `Content-Type: application/json` for request bodies and `X-Workspace-Request: 1` on writes. Disposition commands also require an `Idempotency-Key`. Keep the same key and payload when retrying a command. HTTP 401 signals an absent or expired session, 403 a permission denial, and 409 a state or version conflict.

## Operating scope

This is a local portfolio deployment. The sign-in page intentionally publishes credentials for its demo-only accounts. Set `IDENTITY_DEMO=false` to disable those accounts and provision independent users before sharing a deployment with real data. Identity currently holds sessions and throttle counters in memory. Restarting it signs users out. Multi-replica deployment needs a shared session store, and a public deployment needs a TLS reverse proxy with `IDENTITY_COOKIE_SECURE=true`. The local SQLite database and synthetic valuations are appropriate for the included demonstration.

[Dell Technologies masthead wordmark](https://commons.wikimedia.org/wiki/File:Dell_Technologies_logo.svg)
