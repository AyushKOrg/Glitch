// TEMPORARY hardcoded key for testing while the Vercel account owner is away.
// 1. Paste your Tavily key below (keep the quotes).
// 2. The code stops using it automatically after EXPIRES_AT (UTC). That does NOT revoke the key:
//    delete it in the Tavily dashboard too, and delete this file once the Vercel env var is set.
// 3. If this repo is public or will be pushed to GitHub, anyone can read the key. Use a Development key
//    with a low monthly limit (e.g. 100 credits).
const TAVILY_API_KEY = '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';
const EXPIRES_AT = '2026-11-02T23:59:59Z'; // 2 days from Oct 31, 2026

function activeTavilyKey() {
  if (!TAVILY_API_KEY || TAVILY_API_KEY.startsWith('PASTE_')) return '';
  if (Date.now() > Date.parse(EXPIRES_AT)) return '';
  return TAVILY_API_KEY;
}

module.exports = { activeTavilyKey, EXPIRES_AT };
