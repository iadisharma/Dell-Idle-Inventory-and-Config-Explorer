import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const seedFile = new URL('./data/identity.json', import.meta.url);
const demoSeedFile = new URL('./data/demo.json', import.meta.url);
const dummy = { salt: randomBytes(16).toString('hex'), hash: randomBytes(64).toString('hex') };

export async function hashPassword(password) {
  if (typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 1024) {
    throw new Error('Enter a password between 1 and 1024 bytes.');
  }
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt, 64, parameters);
  return { algorithm: 'scrypt', salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export async function verifyPassword(password, stored) {
  // Unknown or disabled accounts perform the same expensive comparison.
  const record = stored ?? dummy;
  const supplied = await deriveKey(password, Buffer.from(record.salt, 'hex'), 64, parameters);
  const equal = timingSafeEqual(supplied, Buffer.from(record.hash, 'hex'));
  return !!stored && equal;
}

function ensure(value, message) {
  if (!value) throw new Error('Invalid identity data: ' + message);
}

function string(value) { return typeof value === 'string' && value.length > 0 && value.trim() === value; }

function uniqueKey(set, value, label) {
  ensure(string(value) && !set.has(value), 'missing or duplicate ' + label);
  set.add(value);
}

export async function readAccounts(file = process.env.IDENTITY_DATA_FILE || seedFile) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  ensure(Array.isArray(data?.roles) && Array.isArray(data?.users), 'roles and users must be arrays');
  const roles = new Set();
  for (const role of data.roles) {
    uniqueKey(roles, role?.id, 'role');
    ensure(string(role.label) && Array.isArray(role.permissions) && role.permissions.every(string), 'role details');
  }
  const ids = new Set(), emails = new Set(), salts = new Set();
  for (const user of data.users) {
    uniqueKey(ids, user?.id, 'user id');
    ensure(string(user.email) && user.email.includes('@'), 'email');
    uniqueKey(emails, user.email.toLowerCase(), 'email');
    ensure(string(user.name) && roles.has(user.role), 'user name or role');
    for (const flag of ['disabled', 'demoOnly']) {
      ensure(user[flag] === undefined || typeof user[flag] === 'boolean', flag);
    }
    const password = user.password;
    ensure(password?.algorithm === 'scrypt' && /^[a-f0-9]{32}$/.test(password.salt)
      && /^[a-f0-9]{128}$/.test(password.hash), 'password record');
    uniqueKey(salts, password.salt, 'password salt');
  }
  return data;
}

export async function readDemo(file = process.env.IDENTITY_DEMO_FILE || demoSeedFile) {
  if (process.env.IDENTITY_DEMO === 'false') return { enabled: false };
  const demo = JSON.parse(await readFile(file, 'utf8'));
  ensure(typeof demo.enabled === 'boolean', 'demo.enabled');
  if (demo.enabled) {
    ensure(Array.isArray(demo.accountIds) && demo.accountIds.every(string) && string(demo.passwordHint), 'demo configuration');
  }
  return demo;
}

export function enabled(user, demo) {
  return !!user && !user.disabled && (!user.demoOnly || demo.enabled);
}

export function publicUser(user, roles) {
  const role = roles.find(item => item.id === user.role);
  return { id: user.id, name: user.name, email: user.email, role: role.id, roleLabel: role.label, permissions: role.permissions };
}
