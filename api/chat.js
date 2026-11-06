// POST /api/chat { mode: 'flash'|'cognition', messages: [{role, content}] }
const { requireUser, consumeGuestMessage, getUserMemories, supabaseUrl } = require('./_lib');
const { systemPrompt, runGemini, runOpenRouter, runTool } = require('./_llm');

const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 60000;
const GUEST_MESSAGE_LIMIT = 30;

// Catch clear code-generation requests in Flash before sending them to a model.
// Essays, letters, emails etc. are documents, not code: Flash handles them and returns a downloadable file.
function isDocumentRequest(text) {
  return /\b(essay|letter|cover letter|resume|r[eé]sum[eé]|cv|email|e-mail|story|poem|speech|report|article|blog post|paragraphs?|summary|application|statement|apology|invitation|caption|bio|speech|assignment|homework|notes|proposal|memo|complaint|review|thesis|abstract|lyrics|toast|message to)\b/i.test(String(text || ''));
}
async function isVipUser(user) {
  if (!user || user.isAnonymous) return false;
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/get_glitch_vip_status`, { method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('VIP status could not be verified.');
  return (await r.json().catch(() => ({}))).vip === true;
}

async function autoLearnFromChat(user,text) {
  const value=String(text||'').trim();
  if(!user||!value||value.length<8||value.length>220||/^please\s+remember\b/i.test(value))return;
  if(/\b(password|passcode|secret|api[ -]?key|access token|credit card|bank account|medical|diagnos|medication|religion|politic|sexual|orientation|ethnicity|race|passport|\d{10,})\b/i.test(value))return;
  const rules=[[/^(?:i\s+)?(?:prefer|like|love|usually use|always use|work with)\s+(.{4,180})$/i,'Preference: '],[/^(?:i am|i'm)\s+(?:building|working on|developing)\s+(.{4,180})$/i,'Ongoing project: '],[/^my\s+(?:project|app|website)\s+(?:is|called)\s+(.{4,180})$/i,'Project: ']];
  let content='';for(const [pattern,prefix] of rules){const match=value.match(pattern);if(match){content=prefix+match[1].replace(/[.!?]+$/,'').trim();break;}}
  if(!content)return;
  try{await fetch(`${supabaseUrl()}/rest/v1/glitch_memories?on_conflict=user_id,content`,{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:`Bearer ${user.accessToken}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({user_id:user.id,content}),signal:AbortSignal.timeout(5000)});}catch{}
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
  const out = []; let remaining = MAX_TOTAL_CHARS;
  for (const m of raw.slice(-MAX_MESSAGES).reverse()) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const original = String(m.content || '').trim();
    if (!original || remaining <= 0) continue;
    const text = original.slice(0, remaining);
    remaining -= text.length;
    out.push({ role: m.role, text });
  }
  out.reverse();
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
  let mode = req.body && req.body.mode === 'cognition' ? 'cognition' : 'flash';
  const lastUserText = messages[messages.length - 1].text;
  if (isCodeWritingRequest(lastUserText)) {
    let vip = false;
    try { vip = await isVipUser(user); } catch (error) { return res.status(503).json({ error: error.message || 'VIP status could not be verified.' }); }
    if (!vip) return res.status(403).json({ error: 'Coding with Glitch is a VIP feature. Redeem a VIP invite to unlock code generation.', vipRequired: true });
    mode = 'cognition';
  }
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

    await autoLearnFromChat(user, lastUserText);
    const ctx = { userId: user.id, recentUserMessages: messages.filter((m) => m.role === 'user').map((m) => m.text) };
    let system = systemPrompt(mode) + '\\n\\nCHAT CONTEXT: Use the preceding user and assistant messages in this same conversation to resolve references, preserve decisions, and avoid asking the user to repeat information. The latest 40 messages (within the request size limit) are provided in order.';
    const requestedPersonality = String(req.body && req.body.vipPersonality || 'default');
    if (requestedPersonality !== 'default') {
      const allowedStyles = {
        witty: 'Use a playful, clever, lightly humorous tone while remaining respectful.',
        mentor: 'Use a patient mentor tone and explain reasoning clearly.',
        coder: 'Use a precise technical builder tone.',
        chill: 'Use a relaxed, friendly, concise tone.',
      };
      if (!Object.prototype.hasOwnProperty.call(allowedStyles, requestedPersonality)) {
        return res.status(400).json({ error: 'Unknown assistant style.' });
      }
      const statusResponse = await fetch(`${require('./_lib').supabaseUrl()}/rest/v1/rpc/get_glitch_vip_status`, {
        method: 'POST',
        headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(8000),
      });
      const statusData = statusResponse.ok ? await statusResponse.json() : {};
      if (!statusData.vip) return res.status(403).json({ error: 'This assistant style requires VIP access.' });
      system += `\\n\\nAssistant style: ${allowedStyles[requestedPersonality]}`;
    }
    // Account memories are private to this authenticated user and are supplied as trusted context data.
    try {
      const memories = await getUserMemories(user);
      if (memories.length) {
        system += `\n\nUSER-SAVED MEMORY (private profile facts supplied by the user; use only when relevant, never assume they are always current):\n${memories.map((m, i) => `${i + 1}. ${String(m.content).slice(0, 500)}`).join('\n')}\nRespect these preferences and facts. Do not claim to remember anything not listed here.`;
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
