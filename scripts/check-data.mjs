import { access, readFile } from 'node:fs/promises';
import { readCatalog } from '../backend/catalog/catalog.mjs';
import { deriveInventory } from '../backend/inventory/ledger.mjs';
import { statusDefinitions } from '../backend/inventory/disposition.mjs';
import { enrichReviews, mergeReviews } from '../backend/inventory/projection.mjs';
import { buildInsights } from '../backend/inventory/insights.mjs';
import { readAccounts, readDemo } from '../backend/identity/accounts.mjs';

async function checkData() {
  const inventoryFile = process.env.INVENTORY_DATA_FILE ||
    new URL('../backend/inventory/data/inventory.json', import.meta.url);
  const workflowFile = process.env.INVENTORY_WORKFLOW_FILE ||
    new URL('../backend/inventory/data/disposition.json', import.meta.url);
  const [catalog, ledger, workflow, identities, demo] = await Promise.all([
    readCatalog(), readFile(inventoryFile, 'utf8').then(JSON.parse),
    readFile(workflowFile, 'utf8').then(JSON.parse), readAccounts(), readDemo()
  ]);
  const inventory = deriveInventory(ledger);
  inventory.statuses = statusDefinitions(inventory.statuses, workflow).statuses;
  inventory.reviews = mergeReviews(ledger.seedReviews ?? [], []);
  enrichReviews(inventory, ledger);
  buildInsights({ data: ledger, snapshot: inventory });
  if (demo.enabled && demo.accountIds.some(id => !identities.users.some(u => u.id === id && u.demoOnly))) {
    throw new Error('Demo account list contains a missing or non-demo account.');
  }
  const skus = new Set(catalog.products.map(product => product.sku));
  const configurations = new Map(catalog.configurations.map(config => [config.id, config]));
  const problems = [];
  await Promise.all(catalog.products.map(async product => {
    if (!product.imageUrl?.startsWith('/product-images/')) return;
    const image = new URL('../backend/catalog' + product.imageUrl, import.meta.url);
    try {
      await access(image);
    } catch {
      problems.push(`Product ${product.sku} references missing photo ${product.imageUrl}.`);
    }
  }));
  for (const account of ledger.accounts) {
    if (!skus.has(account.sku)) {
      problems.push(`Stock account ${account.id} references missing SKU ${account.sku}.`);
    }
    if (!account.configurationId) continue;
    const config = configurations.get(account.configurationId);
    if (!config && !account.recordedBuild) {
      problems.push(`Stock account ${account.id} has no current configuration or recorded build.`);
    } else if (config?.systemSku && config.systemSku !== account.sku) {
      problems.push(`Stock account ${account.id} references a configuration for a different system SKU.`);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Validated ${skus.size} products, ${configurations.size} current configurations, ` +
    `${ledger.accounts.length} stock accounts and ${inventory.reviews.length} seeded reviews across ${identities.roles.length} roles.`);
}

checkData().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
