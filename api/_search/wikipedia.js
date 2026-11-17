// Keyless Wikipedia fallback provider.
const { short } = require('./_shared/text');
// ---- 3. Wikipedia (keyless) ---------------------------------------------------
async function wikipedia(query, deadline, attempts) {
  const remaining = deadline - Date.now();
  if (remaining < 1500) { attempts.push('wikipedia: skipped (out of time)'); return null; }
  try {
    const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrsearch: query, gsrlimit: '3',
      prop: 'extracts', exintro: '1', explaintext: '1', exchars: '700', redirects: '1',
    });
    const r = await fetch(url, { headers: { 'User-Agent': 'GlitchChat/1.0' }, signal: AbortSignal.timeout(Math.min(6000, remaining - 300)) });
    if (!r.ok) { attempts.push(`wikipedia: HTTP ${r.status}`); return null; }
    const d = await r.json();
    const pages = Object.values((d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const lines = pages.filter((p) => p.extract).map((p) =>
      `- ${p.title}: https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}\n  ${short(p.extract, 500)}`);
    if (!lines.length) { attempts.push('wikipedia: no matching articles'); return null; }
    return {
      ok: true,
      provider: 'wikipedia',
      text: `Encyclopedia results only (live web search was unavailable, so this may be outdated or miss rumors and recent news):\n${lines.join('\n')}`,
    };
  } catch (e) {
    attempts.push(`wikipedia: ${short(e && e.message || e, 120)}`);
    return null;
  }
}

module.exports = { wikipedia };
