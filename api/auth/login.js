// POST /api/auth/login {username, password}
const db = require('../_db');
const auth = require('../_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  if (req.headers['x-glitch-csrf'] !== '1') return res.status(403).json({ error: 'Missing CSRF header.' });

  try {
    const body = req.body || {};
    const username = String(body.username || '').trim().toLowerCase().slice(0, 64);
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = auth.clientIp(req);
    const bad = () => res.status(401).json({ error: 'Wrong username or password.' });

    if (!username || !password || password.length > 128) return bad();

    if (await auth.tooManyAttempts(username, ip)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }

    const { rows } = await db.query('SELECT id, username, role, password_hash FROM users WHERE username = $1', [username]);
    const user = rows[0];
    let ok = false;
    if (user) ok = await auth.verifyPassword(password, user.password_hash);
    else await auth.burnTime(password);

    if (!ok) {
      await auth.recordFailure(username, ip);
      return bad();
    }

    await auth.clearFailures(username);
    await auth.startSession(res, user.id);
    return res.status(200).json({ user: { username: user.username, role: user.role } });
  } catch (e) {
    return res.status(500).json({ error: `Sign-in failed: ${e.message}` });
  }
};
