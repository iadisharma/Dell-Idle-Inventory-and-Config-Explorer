import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

const schema = [
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, document TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, review_id TEXT NOT NULL UNIQUE, position TEXT NOT NULL, document TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS requests (actor_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY (actor_id, request_key))'
];

async function legacyReviews(file) {
  let json;
  try {
    json = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const { reviews } = JSON.parse(json);
  if (!Array.isArray(reviews)) throw new Error('Legacy state must contain a reviews array.');
  return reviews;
}

async function withRetry(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!String(error.code).startsWith('SQLITE_BUSY')) throw error;
      if (attempt >= 6) throw Object.assign(new Error('Inventory is busy. Please retry.'), { status: 503 });
      await delay(10 * 2 ** attempt);
    }
  }
}

export function createOperations(dbFile, legacyFile, validateLegacy) {
  let ready;

  async function initialize() {
    const client = createClient({ url: pathToFileURL(dbFile).href });
    try {
      await client.execute('PRAGMA journal_mode=WAL');
      await client.batch(schema, 'write');
      const tx = await client.transaction('write');
      try {
        const imported = await tx.execute("SELECT 1 FROM meta WHERE key = 'legacy-import-v1'");
        if (!imported.rows.length) {
          const records = await legacyReviews(legacyFile);
          validateLegacy(records);
          for (const review of records) {
            await tx.execute({ sql: 'INSERT INTO reviews(id, document) VALUES(?, ?)', args: [review.id, JSON.stringify(review)] });
            const event = {
              id: randomUUID(), at: new Date().toISOString(), actorName: 'Legacy state import', action: 'import',
              reviewId: review.id, itemId: review.itemId, sku: review.stockAtCreation?.sku,
              status: review.status, note: 'Imported local review with its original history.'
            };
            await tx.execute({ sql: 'INSERT INTO audit(id, document) VALUES(?, ?)', args: [event.id, JSON.stringify(event)] });
          }
          await tx.execute("INSERT INTO meta VALUES('legacy-import-v1', 'complete')");
        }
        await tx.commit();
      } finally {
        tx.close();
      }
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  return async function transaction(mode, operation) {
    if (!ready) ready = withRetry(initialize).catch(error => { ready = undefined; throw error; });
    const client = await ready;
    return withRetry(async () => {
      const tx = await client.transaction(mode);
      try {
        const result = await operation(tx);
        await tx.commit();
        return result;
      } finally {
        // Closing an uncommitted transaction rolls back the stock, case, audit and idempotency writes.
        tx.close();
      }
    });
  };
}
