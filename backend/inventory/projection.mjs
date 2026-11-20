import { positionKey } from './ledger.mjs';

export function refersToPosition(review, account) {
  if (!account || review.itemId !== account.id) return false;
  const original = review.stockAtCreation;
  if (!original) return true;
  // Earlier records captured a configuration ID without its installed parts.
  if (!original.recordedBuild) {
    return original.sku === account.sku && original.warehouseId === account.warehouseId &&
      (original.configurationId ?? null) === (account.configurationId ?? null);
  }
  return positionKey(original) === positionKey(account);
}


export function mergeReviews(seeds, overrides) {
  const all = new Map();
  for (const layer of [seeds, overrides]) {
    if (!Array.isArray(layer)) throw new Error('Review data must be an array.');
    const ids = new Set();
    for (const review of layer) {
      if (typeof review?.id !== 'string' || !review.id.trim() || ids.has(review.id)) {
        throw new Error('Review data contains a missing or duplicate ID.');
      }
      if (typeof review.createdAt !== 'string' || typeof review.updatedAt !== 'string' ||
          !Number.isFinite(Date.parse(review.createdAt)) || !Number.isFinite(Date.parse(review.updatedAt)) ||
          !Array.isArray(review.history) || !review.history.length ||
          review.history.at(-1)?.status !== review.status || review.history.at(-1)?.at !== review.updatedAt) {
        throw new Error('Review history and timestamps are inconsistent for ' + review.id);
      }
      ids.add(review.id);
      all.set(review.id, review);
    }
  }
  return [...all.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}


export function enrichReviews(snapshot, data) {
  const consumption = new Map();
  for (const movement of data.movements) {
    if (movement.type !== 'consumption' || movement.date > data.asOf) continue;
    if (!consumption.has(movement.itemId)) consumption.set(movement.itemId, []);
    consumption.get(movement.itemId).push(movement);
  }
  const balances = new Map(snapshot.items.map(item => [item.id, item.quantity]));
  const accounts = new Map(data.accounts.map(account => [account.id, account]));
  snapshot.reviews = snapshot.reviews.map(review => {
    const baselineDate = review.stockAtCreation?.asOf ?? review.createdAt.slice(0, 10);
    const samePosition = refersToPosition(review, accounts.get(review.itemId));
    const observed = samePosition && baselineDate <= data.asOf;
    let consumedUnits = null;
    if (observed) {
      const issues = consumption.get(review.itemId) ?? [];
      const alreadyPosted = review.stockAtCreation?.knownIssuesOnBaseline;
      const seen = alreadyPosted ? new Set(alreadyPosted) : null;
      consumedUnits = 0;
      for (const issue of issues) {
        if (issue.reviewId === review.id || issue.date > baselineDate || (issue.date === baselineDate && seen && !seen.has(issue.id))) {
          consumedUnits += issue.units;
        }
      }
    }
    return { ...review, currentItemId: samePosition ? review.itemId : null, followUp: {
      baselineDate, asOf: data.asOf, consumedUnits,
      remainingUnits: observed ? balances.get(review.itemId) ?? 0 : null
    } };
  });
  return snapshot;
}
