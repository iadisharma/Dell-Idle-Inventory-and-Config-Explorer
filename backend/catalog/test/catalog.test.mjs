import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findConfiguration, findProduct, projectCatalog, readCatalog } from '../catalog.mjs';

function fixture() {
  const product = sku => ({
    sku, name: sku, category: 'Fixture', model: sku + '-model', status: 'Active',
    description: 'Test product', specs: {}, sourceUrl: 'https://example.org/product',
  });
  const path = (sku, option, archived = false) => ({ sku, module: 'Module A', option, archived });
  const config = (id, paths) => ({ id, orderCode: 'ORDER-' + id, name: id, chassis: 'Chassis A', paths });
  return {
    products: ['part', 'other', 'system', 'unused'].map(product),
    configurations: [
      { ...config('one', [path('part', 'internal'), path('part', 'spare'), path('other', 'extra')]), systemSku: 'system' },
      config('two', [path('part', 'internal'), path('other', 'old', true)]),
      { ...config('old', [path('part', 'internal')]), archived: true },
    ],
  };
}

test('reverse lookup groups current paths by order code and keeps every distinct option', () => {
  const catalog = projectCatalog(fixture());
  const result = findProduct(catalog, 'PART');
  assert.deepEqual(result.configurations.map(config => config.id), ['one', 'two']);
  assert.deepEqual(result.configurations.flatMap(config => config.paths.map(path => path.option)),
    ['internal', 'spare', 'internal']);
  assert.deepEqual(findProduct(catalog, 'unused').configurations, []);
  assert.equal(findProduct(catalog, 'missing'), undefined);
});

test('looking up a configured system returns its complete current options', () => {
  const catalog = projectCatalog(fixture());
  assert.deepEqual(findProduct(catalog, 'system').configurations, [findConfiguration(catalog, 'order-ONE')]);
  assert.equal(findConfiguration(catalog, 'two').paths.length, 1);
  assert.equal(findConfiguration(catalog, 'old'), undefined);
});

test('invalid identifiers and broken cross-references cannot silently alter joins', () => {
  const document = fixture();
  document.configurations[1].orderCode = 'ONE';
  assert.throws(() => projectCatalog(document), /duplicate configuration/);
  document.configurations[1].orderCode = 'updated';
  document.configurations[1].paths[0].sku = 'removed';
  assert.throws(() => projectCatalog(document), /unknown SKU/);
});

test('valid catalog edits and an empty catalog take effect on the next read', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-test-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = join(directory, 'catalog.json');
  const data = fixture();
  await writeFile(file, JSON.stringify(data));
  assert.equal((await readCatalog(file)).products[0].name, 'part');
  data.products[0].name = 'New part name';
  await writeFile(file, JSON.stringify(data));
  assert.equal((await readCatalog(file)).products[0].name, 'New part name');
  await writeFile(file, JSON.stringify({ products: [], configurations: [] }));
  assert.deepEqual(await readCatalog(file), { products: [], configurations: [] });
});
