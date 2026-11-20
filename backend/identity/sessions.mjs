import { createHash, randomBytes } from 'node:crypto';
import { AuthError } from '../shared/auth.mjs';

const digest = token => createHash('sha256').update(token).digest('hex');

export function createSessions({ now, sessionTtlMs }) {
  const sessions = new Map();
  const attempts = new Map();
  const windowMs = 15 * 60 * 1000;

  function prune(map, time) {
    for (const [key, entry] of map) if (entry.expiresAt <= time) map.delete(key);
  }

  function reserve(key, limit, time) {
    let bucket = attempts.get(key);
    if (!bucket) {
      bucket = { count: 0, expiresAt: time + windowMs };
      attempts.set(key, bucket);
    }
    if (bucket.count >= limit) {
      const error = new AuthError(429, 'Too many sign-in attempts. Try again later.');
      error.retryAfter = Math.ceil((bucket.expiresAt - time) / 1000);
      throw error;
    }
    bucket.count += 1;
    return () => { bucket.count -= 1; };
  }

  return {
    reserveLogin(address, email) {
      const time = now();
      prune(attempts, time);
      const releaseAddress = reserve('address:' + address, 40, time);
      // A blocked account attempt still counts toward the network limit.
      const releaseAccount = reserve('account:' + address + ':' + email, 8, time);
      return () => { releaseAddress(); releaseAccount(); };
    },
    create(user) {
      const token = randomBytes(32).toString('base64url');
      const time = now();
      prune(sessions, time);
      sessions.set(digest(token), { userId: user.id, credential: user.password.hash, expiresAt: time + sessionTtlMs });
      return token;
    },
    get(token) {
      if (!token) return null;
      const key = digest(token);
      const session = sessions.get(key);
      if (session && session.expiresAt > now()) return session;
      sessions.delete(key);
      return null;
    },
    revoke(token) { if (token) sessions.delete(digest(token)); }
  };
}
