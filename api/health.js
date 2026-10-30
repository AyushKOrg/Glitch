// GET /api/health - tells the UI whether the PC bridge is reachable.
const { requireUser } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res);
  if (!user) return;

  const base = (process.env.GLITCH_PC_URL || '').replace(/\/+$/, '');
  let pc = false;
  if (base) {
    try {
      const r = await fetch(`${base}/health`, {
        headers: { 'ngrok-skip-browser-warning': '1' },
        signal: AbortSignal.timeout(5000),
      });
      pc = r.ok;
    } catch (_) {
      pc = false;
    }
  }
  return res.status(200).json({ ok: true, pc, fallback: Boolean(process.env.GOOGLE_API_KEY) });
};
