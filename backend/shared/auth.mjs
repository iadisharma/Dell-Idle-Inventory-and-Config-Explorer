/** Only the opaque session cookie crosses the service boundary. */
export const SESSION_COOKIE = 'inventory_session';

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireWorkspaceRequest(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['x-workspace-request'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') {
    throw new AuthError(403, 'Submit changes through the workspace.');
  }
}

export function sessionToken(req) {
  const cookies = (req.headers.cookie || '').split(';').map(value => value.trim());
  const tokens = cookies.filter(cookie => cookie.startsWith(SESSION_COOKIE + '='));
  if (tokens.length !== 1) return null;
  const token = tokens[0].slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function authorize(req, permission) {
  requireWorkspaceRequest(req);
  const token = sessionToken(req);
  if (!token) throw new AuthError(401, 'Sign in to continue.');
  const origin = process.env.IDENTITY_ORIGIN || `http://127.0.0.1:${process.env.IDENTITY_PORT || 4103}`;
  let user;
  try {
    const response = await fetch(new URL('/api/auth/session', origin), {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` }, redirect: 'error',
      signal: AbortSignal.timeout(3000)
    });
    if (response.status === 401) throw new AuthError(401, 'Your session has expired. Sign in again.');
    if (!response.ok) throw new Error('Identity lookup failed');
    ({ user } = await response.json());
    if (!user?.id || !Array.isArray(user.permissions)) throw new Error('Invalid session');
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(503, 'Sign-in service is temporarily unavailable.');
  }
  if (!user.permissions.includes(permission)) throw new AuthError(403, 'Your role cannot perform this action.');
  return user;
}
