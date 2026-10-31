// Shared helpers: env, Supabase REST calls, file-type rules.
// The leading underscore keeps Vercel from exposing this file as an endpoint.

const BUCKET = 'glitch-files';

const TEXT_EXT = new Set([
  '.txt', '.md', '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.csv', '.html', '.css', '.java', '.c', '.cpp',
  '.h', '.cs', '.go', '.rs', '.sql', '.yaml', '.yml', '.xml', '.log', '.ini', '.toml', '.sh', '.bat',
]);
const DOC_EXT = new Set(['.pdf', '.docx']);
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const ALLOWED_EXT = new Set([...TEXT_EXT, ...DOC_EXT, ...Object.keys(IMAGE_MIME)]);

const extOf = (name) => {
  const i = String(name).lastIndexOf('.');
  return i < 0 ? '' : String(name).slice(i).toLowerCase();
};

// Basename only, boring characters only, allow-listed extension. '' = not acceptable.
function safeName(raw) {
  const base = String(raw || '').replace(/\\/g, '/').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+/, '');
  const ext = extOf(base);
  const stem = base.slice(0, base.length - ext.length);
  if (!stem || !ALLOWED_EXT.has(ext)) return '';
  return stem.slice(0, 80) + ext;
}

function missingEnv() {
  return ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !process.env[k]);
}

const supabaseUrl = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

// ---- who is calling? ------------------------------------------------------
// The browser sends its Supabase access token; Supabase tells us who it belongs to.
async function getUser(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const r = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: String(u.email || '').toLowerCase(), isAnonymous: Boolean(u.is_anonymous), accessToken: token } : null;
}

// ALLOWED_EMAILS (comma separated) is optional. Empty = any signed-in account may chat.
function emailAllowed(email) {
  const list = String(process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(email);
}

// Returns the user, or sends the error response and returns null.
async function requireUser(req, res) {
  const missing = missingEnv();
  if (missing.length) {
    res.status(500).json({ error: `Server isn't configured yet. Missing: ${missing.join(', ')}.` });
    return null;
  }
  let user;
  try {
    user = await getUser(req);
  } catch (e) {
    res.status(502).json({ error: `Couldn't reach Supabase: ${e.message}` });
    return null;
  }
  if (!user) {
    res.status(401).json({ error: 'Please sign in.' });
    return null;
  }
  if (!user.isAnonymous && !emailAllowed(user.email)) {
    res.status(403).json({ error: "This account isn't on the allow-list." });
    return null;
  }
  return user;
}

// ---- Storage (caller JWT: RLS enforces per-user access) -------------------
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
const userHeaders = (accessToken, extra = {}) => ({
  apikey: process.env.SUPABASE_ANON_KEY,
  Authorization: `Bearer ${accessToken}`,
  ...extra,
});

async function storageGet(path, accessToken) {
  const r = await fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
    headers: userHeaders(accessToken),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`Storage returned ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function storagePut(path, buffer, contentType, accessToken) {
  const r = await fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
    method: 'POST',
    headers: userHeaders(accessToken, { 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' }),
    body: buffer,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Storage returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function storageList(prefix, accessToken) {
  const r = await fetch(`${supabaseUrl()}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: userHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix, limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Storage returned ${r.status}`);
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).filter((o) => o && o.name && o.id !== null);
}

module.exports = {
  BUCKET, TEXT_EXT, DOC_EXT, IMAGE_MIME, ALLOWED_EXT, extOf, safeName,
  missingEnv, supabaseUrl, getUser, emailAllowed, requireUser,
  storageGet, storagePut, storageList,
};
