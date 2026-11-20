import React, { useRef, useState } from 'react';
import { api, fmt, Icon } from './ui.jsx';

export const actionLabels = {
  create: 'Review opened',
  propose: 'Propose disposition',
  approve: 'Approve plan',
  reject: 'Reject plan',
  cancel: 'Cancel approved plan',
  execute: 'Execute approved plan',
};
const help = {
  propose:
    'Choose how many units to consume and explain the intended use. A manager will review your proposal.',
  approve:
    'Check the proposed quantity and rationale, then record your decision.',
  reject: 'Explain why this proposal should be closed.',
  cancel:
    'Close the unissued plan and release its reserved units. Record why it can no longer proceed.',
  execute:
    'Record the approved stock consumption. Execution updates the ledger and closes the case.',
};
export default function ReviewAction({ review, index, onSaved, onRefresh }) {
  const actions = review.availableActions || [];
  const [action, setAction] = useState(actions[0] || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const intent = useRef(null);
  const active = actions.includes(action) ? action : actions[0];
  const quantityAvailable =
    review.followUp?.remainingUnits ??
    index.item.get(review.currentItemId)?.quantity;
  if (!active) {
    if (index.status.get(review.status)?.terminal) return null;
    const stage =
      review.dispositionStage ?? index.status.get(review.status)?.stage;
    return (
      <section className="detail-section">
        <h3>Next step</h3>
        <p className="workflow-guidance">
          {stage === 'approved'
            ? 'A planner can execute the approved disposition.'
            : stage === 'proposed'
              ? 'A manager can approve or reject the proposed disposition.'
              : 'A planner can propose a quantity and disposition for this case.'}
        </p>
      </section>
    );
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const fields = new FormData(e.currentTarget);
    const body = {
      action: active,
      note: String(fields.get('note') || '').trim(),
      expectedUpdatedAt: review.updatedAt,
    };
    if (active === 'propose') body.quantity = Number(fields.get('quantity'));
    const content = JSON.stringify(body);
    if (intent.current?.content !== content)
      intent.current = { content, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const updated = await api(
        '/api/inventory/reviews/' + encodeURIComponent(review.id) + '/actions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': intent.current.key,
          },
          body: content,
        }
      );
      onSaved(updated);
    } catch (err) {
      setError({ message: err.message, status: err.status });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-section">
      <h3>Disposition workflow</h3>
      <form className="form" onSubmit={submit}>
        <fieldset disabled={busy} className="workflow-fields">
          {actions.length > 1 && (
            <label>
              Decision
              <select
                value={active}
                onChange={(e) => {
                  setAction(e.target.value);
                  setError(null);
                }}
              >
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {actionLabels[a] || a}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="workflow-guidance">{help[active]}</p>
          {active === 'propose' && (
            <label>
              Proposed units
              <input
                type="number"
                name="quantity"
                inputMode="numeric"
                min="1"
                max={quantityAvailable ?? undefined}
                step="1"
                required
                aria-describedby="available-units"
              />
              {quantityAvailable != null && (
                <small id="available-units">
                  {fmt(quantityAvailable)} units currently on hand
                </small>
              )}
            </label>
          )}
          <label>
            {active === 'execute'
              ? 'Execution note (optional)'
              : active === 'propose'
                ? 'Proposal rationale'
                : 'Decision rationale'}
            <textarea
              name="note"
              key={active}
              rows="3"
              maxLength={1500}
              required={active !== 'execute'}
            />
          </label>
        </fieldset>
        {error && (
          <div role="alert">
            <p className="inline-error">{error.message}</p>
            {error.status === 409 && (
              <button type="button" onClick={onRefresh} className="text-button">
                <Icon name="refresh" size={13} />
                Reload case
              </button>
            )}
          </div>
        )}
        <button
          className={
            ['reject', 'cancel'].includes(active)
              ? 'secondary-btn'
              : 'primary-btn'
          }
          disabled={busy}
        >
          {busy ? 'Saving…' : actionLabels[active] || active}
        </button>
      </form>
    </section>
  );
}
