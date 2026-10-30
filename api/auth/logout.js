// POST /api/auth/logout
const auth = require('../_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  if (req.headers['x-glitch-csrf'] !== '1') return res.status(403).json({ error: 'Missing CSRF header.' });
  try {
    await auth.endSession(req, res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
