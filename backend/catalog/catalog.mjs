import { readFile } from 'node:fs/promises';

const seedFile = new URL('./data/catalog.json', import.meta.url);

function check(condition, message) {
  if (!condition) throw new Error(`Invalid catalog: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireFields(record, keys, location) {
  check(isRecord(record), `${location} must be an object`);
  for (const key of keys) {
    check(typeof record[key] === 'string' && record[key].trim().length > 0,
      `${location}.${key} must be a nonempty string`);
  }
}

function addKey(seen, key, label) {
  const normalized = key.toLowerCase();
  check(!seen.has(normalized), `duplicate ${label}: ${key}`);
  seen.add(normalized);
}

function isWebUrl(value) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
}

function checkArchive(record, location) {
  check(record.archived === undefined || typeof record.archived === 'boolean',
    `${location}.archived must be boolean`);
}

export function projectCatalog(document) {
  check(isRecord(document) && Array.isArray(document.products) && Array.isArray(document.configurations),
    'products and configurations must be arrays');
  const seenSkus = new Set();
  const productSkus = new Set();
  for (const [i, product] of document.products.entries()) {
    const location = `products[${i}]`;
    requireFields(product, ['sku', 'name', 'category', 'model', 'description', 'sourceUrl', 'status'], location);
    check(isWebUrl(product.sourceUrl), `${location}.sourceUrl must be a web URL`);
    if (product.imageUrl !== undefined) {
      check(typeof product.imageUrl === 'string' && (isWebUrl(product.imageUrl)
        || /^\/product-images\/[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(product.imageUrl)), `${location}.imageUrl is invalid`);
    }
    check(isRecord(product.specs) && Object.values(product.specs).every(value => typeof value === 'string'),
      `${location}.specs must map labels to string values`);
    addKey(seenSkus, product.sku, 'sku');
    productSkus.add(product.sku);
  }
  const configKeys = new Set();
  for (const [i, config] of document.configurations.entries()) {
    const location = `configurations[${i}]`;
    requireFields(config, ['id', 'orderCode', 'name', 'chassis'], location);
    addKey(configKeys, config.id, 'configuration lookup key');
    if (config.id.toLowerCase() !== config.orderCode.toLowerCase()) {
      addKey(configKeys, config.orderCode, 'configuration lookup key');
    }
    checkArchive(config, location);
    check(config.systemSku === undefined || productSkus.has(config.systemSku), `${location} has unknown systemSku`);
    check(Array.isArray(config.paths), `${location}.paths must be an array`);
    const uniquePaths = new Set();
    for (const [j, path] of config.paths.entries()) {
      const pathLocation = `${location}.paths[${j}]`;
      requireFields(path, ['sku', 'module', 'option'], pathLocation);
      check(productSkus.has(path.sku), `${pathLocation} references unknown SKU ${path.sku}`);
      checkArchive(path, pathLocation);
      if (!path.archived) addKey(uniquePaths, JSON.stringify([path.sku, path.module, path.option]), 'option path');
    }
  }
  const configurations = document.configurations.filter(config => !config.archived)
    .map(config => ({ ...config, paths: config.paths.filter(path => !path.archived) }));
  return { products: document.products, configurations };
}

export async function readCatalog(dataFile = process.env.CATALOG_DATA_FILE || seedFile) {
  return projectCatalog(JSON.parse(await readFile(dataFile, 'utf8')));
}

export function findProduct(catalog, sku) {
  const product = catalog.products.find(row => row.sku.toLowerCase() === sku.toLowerCase());
  if (!product) return undefined;
  const configurations = [];
  for (const config of catalog.configurations) {
    if (config.systemSku === product.sku) {
      configurations.push(config);
    } else {
      const paths = config.paths.filter(path => path.sku === product.sku);
      if (paths.length) configurations.push({ ...config, paths });
    }
  }
  return { product, configurations };
}

export function findConfiguration(catalog, key) {
  const value = key.toLowerCase();
  return catalog.configurations.find(config => config.id.toLowerCase() === value || config.orderCode.toLowerCase() === value);
}
