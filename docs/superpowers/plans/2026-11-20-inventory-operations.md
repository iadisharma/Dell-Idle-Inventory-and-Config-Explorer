# Inventory operations upgrade

The analyst opens a case on an idle stock position. The planner proposes the number of units to issue. A manager reviews the proposal. Execution posts the approved consumption, updates the case and records an attributable event in one transaction.

| Area | Acceptance check |
| --- | --- |
| Identity | Password verification, session expiry and logout are enforced by the identity service. Catalog and Inventory authorize direct HTTP requests. |
| Operations | Role checks, maker/checker separation, stock availability and case version checks precede writes. Repeating a successful execution request produces one stock movement. |
| Insights | Replay the ledger for historical idle balances. Rank idle positions by estimated carrying value and identify those without an open case. Compare consumed units with actual stock postings. |
| User interface | Sign in separately as analyst, planner and manager. Complete the handoffs, follow the history and inspect the changed inventory and metrics. |
| Compatibility | Keep JSON as the source for baseline catalog, inventory and policy. Preserve earlier review records and identities in the transition to SQLite. |
