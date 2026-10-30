// POST /api/upload  (raw file bytes, header x-filename = encodeURIComponent(name))
// Forwards the file to the PC bridge, which saves it into Glitch's read folder.
const { requireUser } = require('./_auth');
const { bridgeBase, bridgeHeaders, upstreamStatus } = require('./_lib');

const MAX_BYTES = 4 * 1024 * 1024; // Vercel functions accept ~4.5 MB request bodies

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const user = await requireUser(req, res);
  if (!user) return;

  const base = bridgeBase();
  if (!base) return res.status(503).json({ error: 'No PC is connected, so uploads are unavailable.' });

  const body = Buffer.isBuffer(req.body) ? req.body : null;
  if (!body || !body.length) return res.status(400).json({ error: 'Send the raw file as application/octet-stream.' });
  if (body.length > MAX_BYTES) return res.status(413).json({ error: 'File is over 4 MB.' });

  try {
    const r = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: bridgeHeaders({
        'Content-Type': 'application/octet-stream',
        'x-filename': String(req.headers['x-filename'] || ''),
      }),
      body,
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(upstreamStatus(r.status)).json({ error: data.detail || `PC bridge returned ${r.status}` });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: `Couldn't reach your PC: ${e.message}` });
  }
};
