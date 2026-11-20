import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { hashPassword, readAccounts } from './accounts.mjs';

const defaultFile = fileURLToPath(new URL('./data/identity.json', import.meta.url));

async function readPassword() {
  if (!process.stdin.isTTY) {
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 1026) throw new Error('The supplied password is too long.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const silentOutput = new Writable({ write(chunk, encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
  process.stderr.write('Enter new password (hidden): ');
  try { return await input.question(''); }
  finally { input.close(); process.stderr.write('\n'); }
}

export async function provisionAccount({ email, name, role, password, dataFile = process.env.IDENTITY_DATA_FILE || defaultFile }) {
  email = email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) throw new Error('Supply a valid --email.');
  if (typeof password !== 'string' || password.length < 12) throw new Error('Use a password with at least 12 characters.');
  const filename = resolve(dataFile);
  const lockPath = filename + '.lock';
  const temporary = filename + '.' + randomUUID() + '.tmp';
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another account update holds ' + lockPath);
    throw error;
  }
  try {
    const accounts = await readAccounts(filename);
    let account = accounts.users.find(user => user.email.toLowerCase() === email);
    if (account?.demoOnly) throw new Error('Use a non-demo email for a private account.');
    if (!account) {
      if (!name?.trim() || !role) throw new Error('New accounts require --name and --role.');
      account = { id: randomUUID(), email };
      accounts.users.push(account);
    }
    if (name !== undefined) account.name = name.trim();
    if (role !== undefined) account.role = role;
    if (!accounts.roles.some(entry => entry.id === account.role)) throw new Error('Unknown role. Use a role ID from identity.json.');
    account.password = await hashPassword(password);
    const pending = await open(temporary, 'wx', 0o600);
    try {
      await pending.writeFile(JSON.stringify(accounts, null, 2) + '\n', 'utf8');
      await pending.sync();
    } finally { await pending.close(); }
    await readAccounts(temporary);
    await rename(temporary, filename);
    return { id: account.id, email: account.email, role: account.role };
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } });
    if (!values.email) throw new Error('Usage: node backend/identity/provision.mjs --email <email> [--name <name> --role <role>]');
    const result = await provisionAccount({ ...values, password: await readPassword() });
    console.log('Saved account ' + result.email + ' (' + result.role + ').');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
