// GET /api/vip checks VIP status; POST /api/vip redeems a one-time owner-issued invite.
const { requireUser, supabaseUrl } = require('./_lib');

async function rpc(user, name, body = {}) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(payload.message || payload.details || 'VIP service is unavailable.');
  return payload;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET or POST only.' });
  }
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.isAnonymous) return res.status(403).json({ error: 'Sign in with a registered account to use VIP.' });
  try {
    if (req.method === 'GET') {
      const result = await rpc(user, 'get_glitch_vip_status');
      return res.status(200).json({ vip: result.vip === true });
    }
    const code = String(req.body && req.body.code || '').trim();
    if (code.length < 8 || code.length > 100) return res.status(400).json({ error: 'Enter a valid VIP invite code.' });
    const result = await rpc(user, 'redeem_glitch_vip_code', { p_code: code });
    return res.status(200).json({ vip: result.vip === true, alreadyVip: result.already_vip === true });
  } catch (error) {
    const message = String(error.message || 'VIP request failed.');
    return res.status(/invalid|already been used|sign in/i.test(message) ? 400 : 502).json({ error: message });
  }
};
