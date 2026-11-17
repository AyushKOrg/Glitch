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
// Tavily key comes from the TAVILY_API_KEY environment variable only. Never hardcode keys.const short = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = { short };
