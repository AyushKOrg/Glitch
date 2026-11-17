// Optional Tavily search provider.
const { short } = require('../_shared/text');
const tavilyKey = () => process.env.TAVILY_API_KEY || '';
// ---- 2. Tavily (optional) -----------------------------------------------------
async function tavily(query, deadline, attempts) {
  const key = tavilyKey();
  if (!key) return null;
  const remaining = deadline - Date.now();
  if (remaining < 2000) { attempts.push('tavily: skipped (out of time)'); return null; }
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 5, include_answer: true }),
      signal: AbortSignal.timeout(Math.min(8000, remaining - 500)),
    });
    if (!r.ok) { attempts.push(`tavily: HTTP ${r.status}`); return null; }
    const d = await r.json();
    const results = (d.results || []).slice(0, 5);
    if (!d.answer && !results.length) { attempts.push('tavily: no results'); return null; }
    const lines = results.map((x) => `- ${x.title || x.url}: ${x.url}${x.content ? `\n  ${short(x.content, 240)}` : ''}`);
    return { ok: true, provider: 'tavily', text: `${d.answer ? `${d.answer}\n\n` : ''}Sources:\n${lines.join('\n')}` };
  } catch (e) {
    attempts.push(`tavily: ${short(e && e.message || e, 120)}`);
    return null;
  }
}

module.exports = { tavily, tavilyKey };
