import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveInventory, positionKey } from './ledger.mjs';
import { createOperations } from './operations.mjs';
import { enrichReviews, mergeReviews, refersToPosition } from './projection.mjs';
import {
  RequestError, actionPermissions, allowedActions, checkBody, normalizedAction,
  requirePermission, stageOf, statusDefinitions, textField
} from './disposition.mjs';

export { RequestError };

const defaultLedger = fileURLToPath(new URL('./data/inventory.json', import.meta.url));
const defaultWorkflow = fileURLToPath(new URL('./data/disposition.json', import.meta.url));

async function recordCase(tx, review, actor, action, note, quantity) {
  const event = {
    id: randomUUID(), at: review.updatedAt, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
    action, reviewId: review.id, itemId: review.itemId, sku: review.stockAtCreation?.sku,
    warehouseId: review.stockAtCreation?.warehouseId, status: review.status, note, quantity, version: review.version
  };
  await tx.execute({
    sql: 'INSERT INTO reviews(id, document) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
    args: [review.id, JSON.stringify(review)]
  });
  await tx.execute({ sql: 'INSERT INTO audit(id, document) VALUES(?, ?)', args: [event.id, JSON.stringify(event)] });
}

export function createInventoryStore({
  dataFile = process.env.INVENTORY_DATA_FILE || defaultLedger,
  workflowFile = process.env.INVENTORY_WORKFLOW_FILE || defaultWorkflow,
  reviewsFile = process.env.INVENTORY_REVIEWS_FILE || join(dirname(dataFile), 'reviews.state.json'),
  dbFile = process.env.INVENTORY_DB_FILE || (reviewsFile === join(dirname(dataFile), 'reviews.state.json')
    ? join(dirname(dataFile), 'operations.sqlite') : reviewsFile + '.sqlite')
} = {}) {
  const transaction = createOperations(dbFile, reviewsFile, records => mergeReviews([], records));

  async function load(tx) {
    const [ledgerJSON, workflowJSON, stored, movements] = await Promise.all([
      readFile(dataFile, 'utf8'), readFile(workflowFile, 'utf8'),
      tx.execute('SELECT document FROM reviews'), tx.execute('SELECT document, position FROM movements ORDER BY rowid')
    ]);
    const data = JSON.parse(ledgerJSON);
    const positions = new Map(data.accounts.map(account => [account.id, positionKey(account)]));
    const postedIssues = [];
    for (const row of movements.rows) {
      const movement = JSON.parse(row.document);
      // Earlier postings stored the warehouse in the immutable position key.
      postedIssues.push({ ...movement, warehouseId: movement.warehouseId ?? JSON.parse(row.position)[1] });
      // Archived or replaced accounts keep their audit history, without charging the replacement SKU.
      if (positions.get(movement.itemId) === row.position) data.movements.push(movement);
    }
    const snapshot = deriveInventory(data);
    const { statuses, definition } = statusDefinitions(snapshot.statuses, JSON.parse(workflowJSON));
    snapshot.statuses = statuses;
    snapshot.reviews = mergeReviews(data.seedReviews ?? [], stored.rows.map(row => JSON.parse(row.document)));
    return { snapshot, definition, data, postedIssues };
  }

  function insightData(actor) {
    return transaction('read', async tx => {
      const { snapshot, data, postedIssues } = await load(tx);
      enrichReviews(snapshot, data);
      snapshot.reviews = snapshot.reviews.map(review => ({
        ...review, availableActions: allowedActions(review, snapshot.statuses, actor)
      }));
      return { snapshot, data, postedIssues };
    });
  }

  return {
    insightData,
    async snapshot(actor) { return (await insightData(actor)).snapshot; },

    async audit(actor, { before = null, limit = 30, q = '' } = {}) {
      requirePermission(actor, 'audit:read');
      if (!/^\d+$/.test(String(limit)) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) {
        throw new RequestError(400, 'Audit page size must be between 1 and 100.');
      }
      if (before != null && (!/^\d+$/.test(String(before)) || !Number.isSafeInteger(Number(before)) || Number(before) < 1)) {
        throw new RequestError(400, 'Invalid audit cursor.');
      }
      if (typeof q !== 'string' || q.length > 200) throw new RequestError(400, 'Audit search may contain up to 200 characters.');
      const pageSize = Number(limit);
      const filters = [];
      const args = [];
      if (before != null) {
        filters.push('sequence < ?');
        args.push(Number(before));
      }
      if (q.trim()) {
        const searchable = ['actorName', 'sku', 'note', 'action', 'reviewId']
          .map(field => "coalesce(json_extract(document, '$." + field + "'), '')").join(' || char(31) || ');
        filters.push('instr(lower(' + searchable + '), lower(?)) > 0');
        args.push(q.trim());
      }
      return transaction('read', async tx => {
        const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
        const records = await tx.execute({
          sql: 'SELECT sequence, document FROM audit' + where + ' ORDER BY sequence DESC LIMIT ?',
          args: [...args, pageSize + 1]
        });
        const events = records.rows.slice(0, pageSize).map(row => ({ ...JSON.parse(row.document), sequence: row.sequence }));
        return { events, nextCursor: records.rows.length > pageSize ? events.at(-1).sequence : null };
      });
    },

    async createReview(payload, actor) {
      requirePermission(actor, 'review:create');
      checkBody(payload, ['itemId', 'owner', 'route', 'note']);
      const owner = textField(payload.owner, 'Owner', 100);
      const note = textField(payload.note, 'Review note', 2000);
      return transaction('write', async tx => {
        const { snapshot, data } = await load(tx);
        const { asOf, items, reviews, routes, statuses } = snapshot;
        const item = items.find(record => record.id === payload.itemId);
        if (!item) throw new RequestError(404, 'Stock item is unavailable.');
        if (!routes.some(route => route.id === payload.route)) throw new RequestError(400, 'Select a valid review route.');
        const openCase = reviews.find(review => refersToPosition(review, item) && !statuses.find(status => status.id === review.status)?.terminal);
        if (openCase) throw new RequestError(409, 'This stock item already has an open review.');
        const status = statuses.find(s => s.initial).id;
        const now = new Date().toISOString();
        const knownIssuesOnBaseline = data.movements
          .filter(m => m.itemId === item.id && m.type === 'consumption' && m.date === asOf)
          .map(m => m.id);
        const review = {
          id: randomUUID(), itemId: item.id, owner, route: payload.route, status, note, outcome: '',
          version: 1, dispositionStage: 'open', createdAt: now, updatedAt: now,
          stockAtCreation: { ...item, asOf, knownIssuesOnBaseline },
          history: [{ status, at: now, note, action: 'create', actorId: actor.id, actorName: actor.name }]
        };
        await recordCase(tx, review, actor, 'create', note);
        return { ...review, availableActions: allowedActions(review, statuses, actor) };
      });
    },

    async applyAction(id, payload, actor, requestKey) {
      const command = normalizedAction(payload);
      const { action, expectedUpdatedAt, note } = command;
      requirePermission(actor, actionPermissions[action]);
      const key = textField(requestKey, 'Idempotency-Key', 128);
      const fingerprint = JSON.stringify([id, command]);
      return transaction('write', async tx => {
        const prior = await tx.execute({
          sql: 'SELECT fingerprint, response FROM requests WHERE actor_id=? AND request_key=?', args: [actor.id, key]
        });
        if (prior.rows.length) {
          if (prior.rows[0].fingerprint !== fingerprint) throw new RequestError(409, 'This request key belongs to a different action.');
          return JSON.parse(prior.rows[0].response);
        }
        const { snapshot, definition, data } = await load(tx);
        const { items, reviews, statuses, asOf } = snapshot;
        const review = reviews.find(record => record.id === id);
        if (!review) throw new RequestError(404, 'Review was not found.');
        if (expectedUpdatedAt !== review.updatedAt) throw new RequestError(409, 'Review changed. Refresh it and try again.');
        if ((action === 'approve' || action === 'reject') && review.proposal?.actorId === actor.id) {
          throw new RequestError(403, 'A different person must decide this proposal.');
        }
        if (action === 'execute' && review.decision?.actorId === actor.id) {
          throw new RequestError(403, 'A different person must execute the approved plan.');
        }
        if (!allowedActions(review, statuses, actor).includes(action)) throw new RequestError(409, 'This action is unavailable at the current stage.');
        const item = items.find(account => refersToPosition(review, account));
        const quantity = action === 'propose' ? command.quantity : review.proposal?.quantity;
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new RequestError(409, 'This plan has no valid quantity.');
        if (action !== 'reject' && action !== 'cancel') {
          if (!item) throw new RequestError(409, 'The original stock position is unavailable.');
          if (review.stockAtCreation?.asOf > asOf || data.movements.some(m => m.reviewId && m.itemId === item.id && m.date > asOf)) {
            throw new RequestError(409, 'The reporting date precedes the current disposition history.');
          }
          const reserved = reviews
            .filter(other => other.id !== id && refersToPosition(other, item) && stageOf(other, statuses) === 'approved')
            .reduce((sum, other) => sum + other.proposal.quantity, 0);
          if (quantity > item.quantity - reserved) throw new RequestError(409, 'Insufficient uncommitted stock for this quantity.');
        }
        const stage = { propose: 'proposed', approve: 'approved', reject: 'rejected', execute: 'executed', cancel: 'cancelled' }[action];
        const status = definition[stage].id;
        const at = new Date(Math.max(Date.now(), Date.parse(review.updatedAt) + 1)).toISOString();
        const event = { action, status, at, note, quantity, actorId: actor.id, actorName: actor.name };
        const changed = {
          ...review, status, dispositionStage: stage, updatedAt: at, version: (review.version ?? review.history.length) + 1,
          history: [...review.history, event]
        };
        if (action === 'propose') changed.proposal = { quantity, note, actorId: actor.id, actorName: actor.name, at };
        if (action === 'approve' || action === 'reject') changed.decision = event;
        if (action === 'cancel') changed.cancellation = event;
        if (action === 'reject' || action === 'execute' || action === 'cancel') changed.outcome = note;
        if (action === 'execute') {
          const movement = { id: randomUUID(), reviewId: id, itemId: item.id, warehouseId: item.warehouseId,
            date: asOf, type: 'consumption', units: quantity };
          // A report can be backdated. An issue must leave later postings for the same position valid.
          const later = data.movements.filter(m => m.itemId === item.id && m.date > asOf)
            .sort((a, b) => a.date.localeCompare(b.date));
          let projected = item.quantity - quantity;
          for (const posting of later) {
            projected += posting.type === 'receipt' ? posting.units : -posting.units;
            if (projected < 0) throw new RequestError(409, 'This issue conflicts with a later stock posting.');
          }
          await tx.execute({
            sql: 'INSERT INTO movements(id, review_id, position, document) VALUES(?, ?, ?, ?)',
            args: [movement.id, id, positionKey(item), JSON.stringify(movement)]
          });
          changed.execution = { ...event, movementId: movement.id, postingDate: asOf };
        }
        await recordCase(tx, changed, actor, action, note, quantity);
        const response = { ...changed, availableActions: allowedActions(changed, statuses, actor) };
        await tx.execute({
          sql: 'INSERT INTO requests(actor_id, request_key, fingerprint, response) VALUES(?, ?, ?, ?)',
          args: [actor.id, key, fingerprint, JSON.stringify(response)]
        });
        return response;
      });
    }
  };
}
