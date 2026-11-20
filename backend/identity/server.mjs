import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, SESSION_COOKIE, requireWorkspaceRequest, sessionToken } from '../shared/auth.mjs';
import { enabled, publicUser, readAccounts, readDemo, verifyPassword } from './accounts.mjs';
import { createSessions } from './sessions.mjs';

async function credentials(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AuthError(415, 'Use application/json to sign in.');
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4096) throw new AuthError(413, 'Sign-in request is too large.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AuthError(400, 'Enter an email and password.'); }
  if (typeof body?.email !== 'string' || !body.email.trim() || body.email.length > 254 ||
    typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password) > 1024) {
    throw new AuthError(400, 'Enter an email and password.');
  }
  return { email: body.email.trim().toLowerCase(), password: body.password };
}

function cookie(token, maxAge) {
  const secure = process.env.IDENTITY_COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

export function createIdentityServer({
  dataFile, demoFile, sessionTtlMs = 8 * 60 * 60 * 1000, now = Date.now
} = {}) {
  const sessions = createSessions({ now, sessionTtlMs });
  return createServer(async (req, res) => {
    function send(status, value, headers = {}) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(JSON.stringify(value));
    }
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { status: 'ok', service: 'identity' });
      const method = { '/api/auth/demo': 'GET', '/api/auth/login': 'POST',
        '/api/auth/session': 'GET', '/api/auth/logout': 'POST' }[path];
      if (!method) return send(404, { error: 'Route was not found.' });
      if (req.method !== method) return send(405, { error: 'Method unavailable.' }, { Allow: method });
      requireWorkspaceRequest(req);
      const token = sessionToken(req);
      if (path === '/api/auth/logout') {
        sessions.revoke(token);
        return send(200, { signedOut: true }, { 'Set-Cookie': cookie('', 0) });
      }
      const session = sessions.get(token);
      if (path === '/api/auth/session' && !session) throw new AuthError(401, 'Sign in to continue.');
      const [accounts, demo] = await Promise.all([readAccounts(dataFile), readDemo(demoFile)]);
      if (path === '/api/auth/demo') {
        if (!demo.enabled) return send(200, { accounts: [] });
        const visible = accounts.users.filter(user => user.demoOnly && enabled(user, demo) && demo.accountIds.includes(user.id))
          .map(user => {
            const { id, name, email, role, roleLabel } = publicUser(user, accounts.roles);
            return { id, name, email, role, roleLabel };
          });
        return send(200, visible.length ? { accounts: visible, passwordHint: demo.passwordHint } : { accounts: [] });
      }
      if (path === '/api/auth/session') {
        const user = accounts.users.find(candidate => candidate.id === session.userId);
        if (!enabled(user, demo) || user.password.hash !== session.credential) {
          sessions.revoke(token);
          throw new AuthError(401, 'Sign in again.');
        }
        return send(200, { user: publicUser(user, accounts.roles) });
      }
      const { email, password } = await credentials(req);
      const clearAttempt = sessions.reserveLogin(req.socket.remoteAddress, email);
      const user = accounts.users.find(candidate => candidate.email.toLowerCase() === email);
      if (!await verifyPassword(password, enabled(user, demo) ? user.password : undefined)) {
        throw new AuthError(401, 'Email or password is incorrect.');
      }
      clearAttempt();
      sessions.revoke(token);
      const issued = sessions.create(user);
      send(200, { user: publicUser(user, accounts.roles) },
        { 'Set-Cookie': cookie(issued, Math.ceil(sessionTtlMs / 1000)) });
    } catch (error) {
      if (error instanceof AuthError) {
        const headers = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
        return send(error.status, { error: error.message }, headers);
      }
      console.error('Identity service:', error.message);
      send(503, { error: 'Sign-in service is temporarily unavailable.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.IDENTITY_PORT ?? 4103);
  const server = createIdentityServer();
  server.listen(port, '127.0.0.1', () => console.log('Identity service http://127.0.0.1:' + server.address().port));
}
