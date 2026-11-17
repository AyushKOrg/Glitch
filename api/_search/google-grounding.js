// Google Search grounding provider and model cooldown state.
const { short } = require('../_shared/text');

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

module.exports = { googleGrounded, groundingModels };
