// POST /api/auth/register {username, password, code}
// Invite-only: needs GLITCH_SIGNUP_CODE, because every account can drive your PC's Glitch.
// The very first account created becomes the admin.
const { safeEqual } = require('../_lib');
const db = require('../_db');
const auth = require('../_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  if (req.headers['x-glitch-csrf'] !== '1') return res.status(403).json({ error: 'Missing CSRF header.' });

  try {
    const signupCode = process.env.GLITCH_SIGNUP_CODE;
    if (!signupCode) return res.status(403).json({ error: 'Sign-ups are closed (GLITCH_SIGNUP_CODE is not set).' });

    const body = req.body || {};
    const username = String(body.username || '').trim().toLowerCase();
    const password = body.password;
    const ip = auth.clientIp(req);

    if (await auth.tooManyAttempts(username, ip)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    if (!safeEqual(body.code, signupCode)) {
      await auth.recordFailure(username, ip);
      return res.status(403).json({ error: 'Wrong sign-up code.' });
    }
    if (!auth.validUsername(username)) {
      return res.status(400).json({ error: 'Username: 3-32 characters, lowercase letters, numbers, . _ -' });
    }
    const problem = auth.passwordProblem(password, username);
    if (problem) return res.status(400).json({ error: problem });

    const hash = await auth.hashPassword(password);
    let user;
    try {
      const { rows } = await db.query(
        `INSERT INTO users (username, password_hash, role)
         VALUES ($1, $2, CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'user' ELSE 'admin' END)
         RETURNING id, username, role`,
        [username, hash]
      );
      user = rows[0];
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That username is taken.' });
      throw e;
    }

    await auth.startSession(res, user.id);
    return res.status(201).json({ user: { username: user.username, role: user.role } });
  } catch (e) {
    return res.status(500).json({ error: `Sign-up failed: ${e.message}` });
  }
};
