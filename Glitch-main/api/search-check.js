// GET /api/search-check - signed-in users only. Runs one tiny search and reports which provider answered
// (or why each one failed), so you can diagnose search problems without reading Vercel logs.
const { requireUser } = require('./_lib');
const { searchWeb, groundingModels, tavilyKey } = require('./_search');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' });
  const user = await requireUser(req, res);
  if (!user) return;
  const r = await searchWeb('Gemini API latest model', '', 25000);
  return res.status(200).json({
    ok: r.ok,
    provider: r.provider,
    attempts: r.attempts,
    groundingModels: groundingModels(),
    keys: { google: Boolean(process.env.GOOGLE_API_KEY), tavily: Boolean(tavilyKey()) },
    preview: r.ok ? r.text.slice(0, 300) : null,
  });
};
