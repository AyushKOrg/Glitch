// POST /api/chat { mode: 'flash'|'cognition', messages: [{role, content}] }
const { requireUser, consumeGuestMessage, getUserMemories } = require('./_lib');
const { systemPrompt, runGemini, runOpenRouter, runTool } = require('./_llm');

const MAX_MESSAGES = 20;
const MAX_CHARS = 30000;
const GUEST_MESSAGE_LIMIT = 30;

// Catch clear code-generation requests in Flash before sending them to a model.
// Essays, letters, emails etc. are documents, not code: Flash handles them and returns a downloadable file.
function isDocumentRequest(text) {
  return /\b(essay|letter|cover letter|resume|r[eé]sum[eé]|cv|email|e-mail|story|poem|speech|report|article|blog post|paragraphs?|summary|application|statement|apology|invitation|caption|bio|speech|assignment|homework|notes|proposal|memo|complaint|review|thesis|abstract|lyrics|toast|message to)\b/i.test(String(text || ''));
}
function isCodeWritingRequest(text) {
  const t = String(text || '').toLowerCase();
  if (isDocumentRequest(t) && !/\b(code|function|script|html|css|javascript|python|react|api|sql|regex|program|component)\b/.test(t)) return false;
  const asksToCreate = /\b(write|generate|create|build|make|implement|code|program|develop|scaffold|fix|debug|refactor|edit|update)\b/.test(t);
  const codeSubject = /\b(code|coding|program|script|function|class|component|website|web app|application|app|html|css|javascript|typescript|python|java|c\+\+|react|node\.js|api endpoint|sql query|regex|algorithm|bug|error|stack trace|source file|files?|repository|repo|project|calculator|game|bot|extension|plugin|automation|tool|dashboard|landing page|portfolio|chatbot)\b/.test(t);
  return asksToCreate && codeSubject;
}

// Search for nearly all factual/entity questions up front; models can also call web_search for follow-ups.
function needsLiveSearch(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return false;
  // Always search explicitly time-sensitive or web-requested queries.
  if (/\b(latest|current|currently|today|tonight|right now|right-now|real[ -]?time|up[ -]?to [ -]?date|recent|breaking|news|weather|forecast|temperature|stock price|share price|crypto price|exchange rate|currency rate|live score|score now|standings|schedule|traffic|election|polls|price of|cost of|availability|opening hours|released|release date|new version|version of|updates?|search the web|look up|google search|who won|what happened)\b/.test(t)) return true;
  // Default to searching ordinary questions too, including casual factual questions and short entity/product lookups.
  // Skip only clear greetings, purely creative prompts, and code-writing requests handled by Cognition.
  if (/^(hi|hello|hey|thanks|thank you|good morning|good night|bye|ok|okay|lol)[!. ]*$/.test(t)) return false;
  if (/\b(write|draft|compose|poem|story|lyrics|roleplay|brainstorm)\b/.test(t) && !/\b(who|what|when|where|why|how|is|are|does|did|latest|current)\b/.test(t)) return false;
  if (/\b(write|generate|create|build|make|implement|code|program|develop|scaffold|fix|debug|refactor)\b/.test(t) && /\b(code|script|function|class|component|website|web app|application|app|html|css|javascript|typescript|python|react|node|api endpoint|sql|bug|repository|repo|project)\b/.test(t)) return false;
  return true;
}

// Strip correction phrasing ("i meant iphone duo" -> "iphone duo"). Earlier messages are passed separately
// as context to the grounded search, so the query itself stays clean for every provider.
function buildSearchQuery(messages) {
  const users = messages.filter((m) => m.role === 'user').map((m) => m.text);
  const last = users[users.length - 1] || '';
  const cleaned = last.replace(/^(no[, ]+|sorry[, ]+)?(i\s+(meant|mean)|(i\s+)?was\s+(asking|talking)\s+about|what\s+about)\s+/i, '').trim() || last;
  return cleaned.slice(0, 300);
}

function clean(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = String(m.content || '').slice(0, MAX_CHARS).trim();
    if (text) out.push({ role: m.role, text });
  }
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });

  const user = await requireUser(req, res);
  if (!user) return;

  const messages = clean(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: 'Send {messages:[...]} ending with a user message.' });
  const mode = req.body && req.body.mode === 'cognition' ? 'cognition' : 'flash';
  if (mode === 'flash' && !process.env.GOOGLE_API_KEY) {
    return res.status(503).json({ error: 'GOOGLE_API_KEY is required for Flash and web search.' });
  }
  if (mode === 'cognition' && !process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'OPENROUTER_API_KEY is required for Cognition mode.' });
  }

  try {
    let usage = null;
    if (user.isAnonymous) {
      // Atomic database increment: simultaneous requests cannot exceed the limit.
      usage = await consumeGuestMessage(user);
      if (!usage || usage.allowed !== true) {
        return res.status(429).json({
          error: `You've used all ${GUEST_MESSAGE_LIMIT} free guest messages. Please sign in with a real email address to continue.`,
          usage: { used: GUEST_MESSAGE_LIMIT, remaining: 0, limit: GUEST_MESSAGE_LIMIT },
        });
      }
    }

    const lastUserText = messages[messages.length - 1].text;
    if (mode === 'flash' && isCodeWritingRequest(lastUserText)) {
      return res.status(200).json({
        reply: 'This looks like a code-writing task. To give you complete, more reliable code and downloadable files, switch to Cognition mode. I have not generated code in Flash.',
        mode,
        suggestCognition: true,
        usage: user.isAnonymous
          ? { used: usage.used, remaining: usage.remaining, limit: GUEST_MESSAGE_LIMIT }
          : null,
      });
    }

    const ctx = { userId: user.id, recentUserMessages: messages.filter((m) => m.role === 'user').map((m) => m.text) };
    let system = systemPrompt(mode);
    // Account memories are private to this authenticated user and are supplied as trusted context data.
    try {
      const memories = await getUserMemories(user);
      if (memories.length) {
        system += `\\n\\nUSER-SAVED MEMORY (private profile facts supplied by the user; use only when relevant, never assume they are always current):\\n${memories.map((m, i) => `${i + 1}. ${String(m.content).slice(0, 500)}`).join('\\n')}\\nRespect these preferences and facts. Do not claim to remember anything not listed here.`;
      }
    } catch (memoryError) {
      // Memory lookup is best-effort; chat remains available if the memory table has not been migrated yet.
    }
    // Run search server-side whenever the request may benefit from outside facts, so both models
    // receive grounded context even if they do not call the tool themselves. Search failure does not block chat.
    if (needsLiveSearch(lastUserText)) {
      const searchContext = await Promise.race([
        runTool(ctx, 'web_search', { query: buildSearchQuery(messages) }),
        new Promise((resolve) => setTimeout(() => resolve('SEARCH_UNAVAILABLE: Search did not return in time.'), 20000)),
      ]).catch((e) => `SEARCH_UNAVAILABLE: ${String(e && e.message || e).slice(0, 150)}`);
      const searchFailed = String(searchContext).startsWith('SEARCH_UNAVAILABLE');
      if (searchFailed) ctx.searchFailedText = ctx.searchFailedText || String(searchContext);
      system += searchFailed
        ? `\n\nGOOGLE SEARCH STATUS: Live search failed or returned no usable results. Do not call web_search again this turn. Do not make the failure the whole answer, and never blame or tease the user. Answer the user's likely intent using your existing knowledge, especially for recognizable people, products, projects, and terms (for a follow-up like "I meant X", use the earlier messages to work out what they are asking). Clearly label details you cannot verify live, never invent sources, and only ask a follow-up if the term truly has multiple plausible meanings after a best-effort answer. Internal error details (do not recite them to the user): ${searchContext}`
        : `\n\nLIVE SEARCH RESULTS (retrieved for this request):\n${searchContext}\nUse these results wherever relevant, including for casual factual questions; distinguish verified facts from uncertainty and include source URLs when relevant. If the results do not answer the question, provide useful known context and explain only which details remain unverified.`;
    }
    const reply = mode === 'cognition'
      ? await runOpenRouter(ctx, system, messages)
      : await runGemini(ctx, system, messages);

    return res.status(200).json({
      reply,
      mode,
      usage: user.isAnonymous
        ? { used: usage.used, remaining: usage.remaining, limit: GUEST_MESSAGE_LIMIT }
        : null,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'The AI request failed.' });
  }
};
