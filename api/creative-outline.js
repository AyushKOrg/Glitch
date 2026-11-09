// POST /api/creative-outline — prompt refinement for VIP/DEV creative tools.
const { requireUser, supabaseUrl } = require('./_lib');
const { runOpenRouter } = require('./_llm');
const { DEVELOPERS } = require('./_vip-rotate');

async function isVipOrDev(user) {
  if (!user || user.isAnonymous) return false;
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/get_glitch_vip_status`, {
    method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('Membership could not be verified.');
  const status = await r.json().catch(() => ({}));
  return status.vip === true || (DEVELOPERS.includes(user.email) && status.developer === true);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only.' }); }
  const user = await requireUser(req, res); if (!user) return;
  try {
    if (!(await isVipOrDev(user))) return res.status(403).json({ error: 'Creative Studio is exclusive to VIP and DEV accounts.', vipRequired: true });
    if (!process.env.OPENROUTER_API_KEY) return res.status(503).json({ error: 'Creative prompt refinement needs the existing OpenRouter connection. Configure a free model in OPENROUTER_MODEL.' });
    const kind = req.body && req.body.kind === 'flow' ? 'flow' : 'presentation';
    const prompt = String(req.body && req.body.prompt || '').trim().slice(0, 5000);
    if (prompt.length < 5) return res.status(400).json({ error: 'Enter a more detailed idea first.' });
    const system = kind === 'flow'
      ? 'You are Glitch Creative Director. Rewrite the user idea into one excellent, ready-to-paste Google Flow prompt. Preserve intent; add subject details, scene, composition, lighting, camera movement, motion, visual style, continuity, aspect ratio guidance and avoid-list where useful. Do not claim you can operate Google Flow. Return only the final prompt, no markdown or commentary.'
      : 'You are Glitch Presentation Director. Convert the user idea into a well-structured presentation outline. Return ONLY valid JSON matching {"title":"...","subtitle":"...","slides":[{"title":"...","body":"...","bullets":["..."]}]}. Create 5–12 useful content slides, each with a concise title, optional short body and 2–5 substantive bullets. Make it coherent, accurate, audience-aware and visually scannable. Do not include markdown fences or text outside JSON. Never invent specific statistics or citations; qualify uncertain claims.';
    const ctx = { userId: user.id, recentUserMessages: [] };
    const reply = await runOpenRouter(ctx, system, [{ role: 'user', text: prompt }]);
    if (!reply || !String(reply).trim()) throw new Error('The free model returned an empty result.');
    if (kind === 'presentation') {
      const raw = String(reply).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      let parsed; try { parsed = JSON.parse(raw); } catch { throw new Error('The model did not return a valid slide outline. Please try a more specific topic.'); }
      if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.slides)) throw new Error('The slide outline was incomplete. Please try again.');
      parsed.slides = parsed.slides.slice(0, 20);
      return res.status(200).json({ outline: parsed });
    }
    return res.status(200).json({ prompt: String(reply).trim().slice(0, 8000) });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Prompt refinement failed.' });
  }
};
