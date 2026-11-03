const { requireUser, supabaseUrl } = require('./_lib');

const MAX_MEMORIES = 100;
const MAX_CONTENT = 500;

async function supabase(req, user, method, path, body) {
  const headers = {
    apikey: process.env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${user.accessToken}`,
    'Content-Type': 'application/json',
    Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
  };
  return fetch(`${supabaseUrl()}/rest/v1/glitch_memories${path}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const r = await supabase(req, user, 'GET',
        `?select=id,content,created_at&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=${MAX_MEMORIES}`);
      if (!r.ok) return res.status(502).json({ error: `Could not load memory (${r.status}).` });
      return res.status(200).json({ memories: await r.json() });
    }

    if (req.method === 'POST') {
      const content = String(req.body && req.body.content || '').trim().slice(0, MAX_CONTENT);
      if (!content) return res.status(400).json({ error: 'Memory cannot be empty.' });
      const r = await supabase(req, user, 'POST', '', { user_id: user.id, content });
      if (!r.ok) {
        const detail = await r.text();
        if (r.status === 409) return res.status(200).json({ saved: true, duplicate: true });
        return res.status(502).json({ error: `Could not save memory (${r.status}): ${detail.slice(0, 180)}` });
      }
      const rows = await r.json();
      return res.status(201).json({ memory: rows[0] || null });
    }

    if (req.method === 'DELETE') {
      const id = String(req.body && req.body.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'A valid memory ID is required.' });
      const r = await supabase(req, user, 'DELETE',
        `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`);
      if (!r.ok) return res.status(502).json({ error: `Could not delete memory (${r.status}).` });
      return res.status(200).json({ deleted: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'GET, POST, or DELETE only.' });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Memory request failed.' });
  }
};
