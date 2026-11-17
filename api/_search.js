// Ordered search-provider orchestration. Each provider lives in its own module.
const { googleGrounded, groundingModels } = require('./_search/google-grounding');
const { tavily, tavilyKey } = require('./_search/tavily');
const { wikipedia } = require('./_search/wikipedia');
const { short } = require('./_shared/text');

async function searchWeb(query, context = '', budgetMs = 17000) {
  const deadline = Date.now() + budgetMs;
  const attempts = [];
  const q = short(query, 300);
  if (!q) return { ok: false, text: 'Empty search query.', provider: null, attempts };
  const hit = (await googleGrounded(q, context, deadline, attempts)) ||
    (await tavily(q, deadline, attempts)) ||
    (await wikipedia(q, deadline, attempts));
  if (hit) return { ...hit, attempts };
  return { ok: false, provider: null, attempts, text: `All search providers failed. ${attempts.join(' | ')}` };
}
module.exports = { searchWeb, groundingModels, tavilyKey };
