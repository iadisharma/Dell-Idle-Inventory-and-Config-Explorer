# Idle Inventory & Configuration Explorer

The app follows an inventory analyst from a warehouse balance through configuration lookup to a documented review outcome. The architecture follows two different records of truth. Inventory owns what is physically on hand. Catalog owns which configurations reference a product.

| Deliverable | Interface | Acceptance check |
| --- | --- | --- |
| Product catalog | Catalog service reads a JSON document with products and configurations | A reverse lookup returns two order codes and preserves three valid option paths. Retired paths are excluded from current options. |
| Warehouse inventory | Inventory service applies dated receipts and consumption to stock accounts | Forty idle units stay forty through fan-out to multiple configurations. A later receipt after stockout starts a new holding period. |
| Reviews | Inventory service persists the owner, reason, status transitions and outcome | Retrying a create does not create a second open case. A stale edit cannot overwrite another analyst's update. |
| React workspace | Inventory, product catalog and review queue use the same two HTTP APIs | Filter a warehouse, inspect a part or a finished system, open a review, resolve it, and reload the browser. |
| Data maintenance | JSON fixtures, linked source records and a local validation command | Adding a new product, location or option path takes effect on refresh. Validate broken cross-service identifiers before demoing. |
