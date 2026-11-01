// Web search with layered fallbacks. Never throws; always resolves { ok, text, provider, attempts }.
//
// Order:
//   1. Google Search grounding via the Gemini API (current models first)
//   2. Tavily, if TAVILY_API_KEY is set (optional, has a free tier)
//   3. Wikipedia (no key needed; good for named entities, weak for breaking news)
//
// NOTE: Gemini 2.5 Flash shut down on 2026-10-16, and Google Search grounding on Gemini 3.x is
// paid-tier only (billing must be enabled on the project). Override the list with GOOGLE_SEARCH_MODELS
// (comma-separated) in Vercel env vars if Google changes things again.
// Temporary hardcoded key (see _temp_keys.js). Optional: deleting that file is safe.
let tempKeys = { activeTavilyKey: () => '' };
try { tempKeys = require('./_temp_keys'); } catch { /* file removed: use env vars only */ }
const tavilyKey = () => process.env.TAVILY_API_KEY || tempKeys.activeTavilyKey();

const DEFAULT_GROUNDING_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash-lite', // legacy: only works while Google still serves it
];

function groundingModels() {
  const fromEnv = String(process.env.GOOGLE_SEARCH_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_GROUNDING_MODELS;
}

// Per-instance cooldown so a dead model (404/403/400) or a rate-limited one isn't retried on every call.
const cooldown = new Map(); // model -> timestamp until which it is skipped
function coolOff(model, status) {
  const ms = status === 429 ? 60 * 1000 : 5 * 60 * 1000;
  cooldown.set(model, Date.now() + ms);
}
const isCooling = (model) => (cooldown.get(model) || 0) > Date.now();

const short = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- 1. Google Search grounding ---------------------------------------------
async function googleGrounded(query, context, deadline, attempts) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) { attempts.push('google: GOOGLE_API_KEY not set'); return null; }

  const prompt =
    'Use Google Search to research the topic below. Summarize reliable findings, separate confirmed facts from rumors, ' +
    'and mention source names. Be concise.' +
    (context ? `\n\nConversation context (the user's earlier messages, for resolving what the query refers to):\n${context}` : '') +
    `\n\nQuery: ${query}`;

  for (const model of groundingModels()) {
    if (isCooling(model)) { attempts.push(`${model}: skipped (recent failure)`); continue; }
    const remaining = deadline - Date.now();
    if (remaining < 2500) { attempts.push(`${model}: skipped (out of time)`); break; }
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          // Thinking tokens count toward this limit, so keep it generous or the answer gets cut to nothing.
          generationConfig: { maxOutputTokens: 4096 },
        }),
        signal: AbortSignal.timeout(Math.min(12000, remaining - 500)),
      });
      if (!r.ok) {
        const detail = short(await r.text().catch(() => ''), 200);
        attempts.push(`${model}: HTTP ${r.status} ${detail}`);
        if ([400, 403, 404, 429].includes(r.status)) coolOff(model, r.status);
        continue;
      }
      const data = await r.json();
      const cand = data.candidates && data.candidates[0];
      const answer = ((cand && cand.content && cand.content.parts) || [])
        .filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      const sources = ((cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [])
        .map((c) => (c.web && c.web.uri ? `- ${c.web.title || c.web.uri}: ${c.web.uri}` : ''))
        .filter(Boolean).slice(0, 5);
      if (answer || sources.length) {
        return {
          ok: true,
          provider: `google:${model}`,
          text: (answer || 'Google Search returned sources but no summary.') + (sources.length ? `\n\nSources:\n${sources.join('\n')}` : ''),
        };
      }
      attempts.push(`${model}: empty answer (finishReason ${(cand && cand.finishReason) || 'unknown'})`);
    } catch (e) {
      attempts.push(`${model}: ${short(e && e.message || e, 120)}`);
    }
  }
  return null;
}

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

// ---- public entry point --------------------------------------------------------
async function searchWeb(query, context = '', budgetMs = 17000) {
  const deadline = Date.now() + budgetMs;
  const attempts = [];
  const q = short(query, 300);
  if (!q) return { ok: false, text: 'Empty search query.', provider: null, attempts };

  const hit =
    (await googleGrounded(q, context, deadline, attempts)) ||
    (await tavily(q, deadline, attempts)) ||
    (await wikipedia(q, deadline, attempts));
  if (hit) return { ...hit, attempts };
  return { ok: false, provider: null, attempts, text: `All search providers failed. ${attempts.join(' | ')}` };
}

module.exports = { searchWeb, groundingModels, tavilyKey };
