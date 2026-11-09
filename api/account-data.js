const { requireUser, supabaseUrl } = require('./_lib');

const TABLE = 'glitch_account_data';
const MAX_BYTES = 4_000_000;

async function request(user, method, body) {
  return fetch(`${supabaseUrl()}/rest/v1/${TABLE}?user_id=eq.${encodeURIComponent(user.id)}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000)
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') {
      const r = await fetch(`${supabaseUrl()}/rest/v1/${TABLE}?select=data,updated_at&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, {
        headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}` },
        signal: AbortSignal.timeout(12000)
      });
      if (!r.ok) return res.status(502).json({ error: `Cloud data read failed (${r.status}).` });
      const rows = await r.json();
      return res.status(200).json({ data: rows[0]?.data || null, updatedAt: rows[0]?.updated_at || null });
    }
    if (req.method === 'PUT') {
      const data = req.body?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'A data object is required.' });
      const encoded = JSON.stringify(data);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) return res.status(413).json({ error: 'Your cloud data is too large. Remove large attachments or old chats.' });
      const r = await fetch(`${supabaseUrl()}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ user_id: user.id, data, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(12000)
      });
      if (!r.ok) return res.status(502).json({ error: `Cloud data save failed (${r.status}): ${(await r.text()).slice(0, 180)}` });
      return res.status(200).json({ saved: true });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'GET or PUT only.' });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Cloud data request failed.' });
  }
};
