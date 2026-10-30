// GET /api/files - lists files Glitch created in its code workspace (code, Word notes).
const { requireUser } = require('./_auth');
const { bridgeBase, bridgeHeaders, upstreamStatus } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' });
  const user = await requireUser(req, res);
  if (!user) return;

  const base = bridgeBase();
  if (!base) return res.status(503).json({ error: 'No PC is connected.' });

  try {
    const r = await fetch(`${base}/files`, { headers: bridgeHeaders(), signal: AbortSignal.timeout(10000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(upstreamStatus(r.status)).json({ error: data.detail || `PC bridge returned ${r.status}` });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: `Couldn't reach your PC: ${e.message}` });
  }
};
