// Supabase bearer-token authentication and account allow-list checks.
const { missingEnv, supabaseUrl } = require('./supabase');

async function getUser(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && user.id
    ? { id: user.id, email: String(user.email || '').toLowerCase(), isAnonymous: Boolean(user.is_anonymous), accessToken: token }
    : null;
}

function emailAllowed(email) {
  const list = String(process.env.ALLOWED_EMAILS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(email);
}

async function requireUser(req, res) {
  const missing = missingEnv();
  if (missing.length) {
    res.status(500).json({ error: `Server isn't configured yet. Missing: ${missing.join(', ')}.` });
    return null;
  }
  let user;
  try {
    user = await getUser(req);
  } catch (error) {
    res.status(502).json({ error: `Couldn't reach Supabase: ${error.message}` });
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

module.exports = { getUser, emailAllowed, requireUser };
