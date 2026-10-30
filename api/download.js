// GET /api/download?path=<relative path from /api/files>
const { requireUser } = require('./_auth');
const { bridgeBase, bridgeHeaders, upstreamStatus } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' });
  const user = await requireUser(req, res);
  if (!user) return;

  const base = bridgeBase();
  if (!base) return res.status(503).json({ error: 'No PC is connected.' });

  const path = String((req.query && req.query.path) || '');
  if (!path) return res.status(400).json({ error: 'Missing path.' });

  try {
    const r = await fetch(`${base}/download?path=${encodeURIComponent(path)}`, {
      headers: bridgeHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return res.status(upstreamStatus(r.status)).json({ error: data.detail || `PC bridge returned ${r.status}` });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: `Couldn't reach your PC: ${e.message}` });
  }
};
