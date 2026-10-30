// GET /api/auth/me - who am I signed in as?
const auth = require('../_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await auth.getUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    return res.status(200).json({ user: { username: user.username, role: user.role } });
  } catch (e) {
    return res.status(500).json({ error: `Auth backend error: ${e.message}` });
  }
};
