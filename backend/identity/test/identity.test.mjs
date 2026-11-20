import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { authorize, requireWorkspaceRequest } from '../../shared/auth.mjs';
import { hashPassword, readAccounts, verifyPassword } from '../accounts.mjs';
import { provisionAccount } from '../provision.mjs';
import { createIdentityServer } from '../server.mjs';
import { createSessions } from '../sessions.mjs';

const password = 'test-only-password';

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'workspace-identity-'));
  t.after(() => rm(folder, { force: true, recursive: true }));
  const dataFile = join(folder, 'identity.json'), demoFile = join(folder, 'demo.json');
  const data = { roles: [{ id: 'test', label: 'Test user', permissions: ['workspace:read'] }], users: [
    { id: 'one', email: 'worker@example.test', name: 'Test worker', role: 'test', password: await hashPassword(password) }
  ] };
  await Promise.all([writeFile(dataFile, JSON.stringify(data)), writeFile(demoFile, JSON.stringify({ enabled: false }))]);
  let time = 1750000000000;
  const server = createIdentityServer({ dataFile, demoFile, now: () => time, sessionTtlMs: 3000 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  function request(path, method = 'GET', body, cookie = '', headers = {}) {
    return fetch(origin + '/api/auth/' + path, { method,
      headers: { 'content-type': 'application/json', 'x-workspace-request': '1', cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const login = () => request('login', 'POST', { email: ' Worker@example.test ', password });
  return { dataFile, demoFile, data, request, login, origin, advance: ms => { time += ms; } };
}

test('sign-in issues an opaque cookie, checks permissions with identity, and revokes it on logout', async t => {
  const f = await fixture(t);
  const previous = process.env.IDENTITY_ORIGIN;
  process.env.IDENTITY_ORIGIN = f.origin;
  t.after(() => {
    if (previous === undefined) delete process.env.IDENTITY_ORIGIN;
    else process.env.IDENTITY_ORIGIN = previous;
  });
  assert.equal((await f.request('session')).status, 401);
  const login = await f.login();
  assert.equal(login.status, 200);
  const issued = login.headers.get('set-cookie');
  assert.match(issued, /HttpOnly/); assert.match(issued, /SameSite=Strict/);
  assert.doesNotMatch(issued, /worker|test-only-password|workspace:read/);
  assert.equal((await login.json()).user.password, undefined);
  const cookie = issued.split(';')[0];
  const req = { method: 'GET', headers: { cookie, 'x-role': 'manager' } };
  assert.equal((await authorize(req, 'workspace:read')).id, 'one');
  await assert.rejects(authorize(req, 'plan:decide'), { status: 403 });
  assert.equal((await f.request('logout', 'POST', undefined, cookie)).status, 200);
  await assert.rejects(authorize(req, 'workspace:read'), { status: 401 });
  const second = await f.login();
  f.advance(3000);
  assert.equal((await f.request('session', 'GET', undefined, second.headers.get('set-cookie').split(';')[0])).status, 401);
});

test('demo disclosure is explicit and demo identities cannot sign in when disabled', async t => {
  const f = await fixture(t);
  f.data.users[0].demoOnly = true;
  await writeFile(f.dataFile, JSON.stringify(f.data));
  assert.deepEqual(await (await f.request('demo')).json(), { accounts: [] });
  assert.equal((await f.login()).status, 401);
  if (process.env.IDENTITY_DEMO !== 'false') {
    await writeFile(f.demoFile, JSON.stringify({ enabled: true, accountIds: ['one'], passwordHint: password }));
    const demo = await (await f.request('demo')).json();
    assert.equal(demo.accounts[0].email, 'worker@example.test');
    assert.equal(demo.accounts[0].password, undefined);
    assert.equal(demo.passwordHint, password);
    assert.equal((await f.login()).status, 200);
  }
});

test('throttle reserves attempts before password verification and resets after the window', () => {
  let time = 1000;
  const sessions = createSessions({ now: () => time, sessionTtlMs: 2000 });
  for (let i = 0; i < 8; i++) sessions.reserveLogin('address', 'mail');
  assert.throws(() => sessions.reserveLogin('address', 'mail'), { status: 429 });
  time += 15 * 60 * 1000;
  assert.doesNotThrow(() => sessions.reserveLogin('address', 'mail'));
});

test('sensitive writes require a same-site workspace request', () => {
  assert.throws(() => requireWorkspaceRequest({ method: 'PATCH', headers: {} }), { status: 403 });
  assert.throws(() => requireWorkspaceRequest({ method: 'POST', headers: {
    'x-workspace-request': '1', 'sec-fetch-site': 'cross-site' } }), { status: 403 });
  assert.doesNotThrow(() => requireWorkspaceRequest({ method: 'POST', headers: { 'x-workspace-request': '1' } }));
});

test('provisioning adds a private account and password rotation preserves IDs and revokes sessions', async t => {
  const f = await fixture(t);
  const created = await provisionAccount({ dataFile: f.dataFile, email: 'new@example.test', name: 'New worker',
    role: 'test', password });
  assert.equal(created.email, 'new@example.test');
  const persisted = await readAccounts(f.dataFile);
  assert.equal(persisted.users.length, 2);
  assert.notEqual(persisted.users[0].password.salt, persisted.users[1].password.salt);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const rotated = await provisionAccount({ dataFile: f.dataFile, email: 'worker@example.test', password: 'rotated-password' });
  assert.equal(rotated.id, 'one');
  assert.equal((await f.request('session', 'GET', undefined, cookie)).status, 401);
  assert.equal((await f.login()).status, 401);
  const updated = await readAccounts(f.dataFile);
  assert.ok(await verifyPassword('rotated-password', updated.users[0].password));
  assert.deepEqual(updated.users[1], persisted.users[1]);
});
