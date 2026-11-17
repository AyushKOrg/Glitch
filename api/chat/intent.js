// Pure request-intent detection, query shaping and response formatting for /api/chat.
const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 60000;

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

// Calendar retrieval is deterministic: avoid an unrelated web search and a model tool-call round trip.
function isUpcomingCalendarRequest(text) {
  const t = String(text || '').toLowerCase();
  return /\b(calendar|agenda)\b/.test(t)
    && /\b(check|show|list|get|find|fetch|look|what|upcoming|next|events?)\b/.test(t);
}
function formatUpcomingCalendarResult(raw) {
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); }
    catch {
      return /^(Google connector:|Sign in and connect Google)/i.test(data)
        ? 'I could not retrieve your calendar: ' + data.replace(/^Google connector:\s*/i, '')
        : 'The Calendar connector returned an unexpected response: ' + data.slice(0, 400);
    }
  }
  if (!Array.isArray(data)) {
    if (data && data.error) return 'I could not retrieve your calendar: ' + String(data.error.message || data.error);
    return 'The Calendar connector returned an unsupported response.';
  }
  if (!data.length) return 'I checked your connected Google Calendar. There are no upcoming events in the primary calendar.';
  const formatDate = (value, allDay) => {
    if (!value) return 'Time not specified';
    const date = new Date(allDay ? value + 'T00:00:00' : value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', ...(allDay ? {} : { timeStyle: 'short' }) }).format(date);
  };
  const lines = data.slice(0, 10).map((event, i) => {
    const start = event.start || {}, end = event.end || {};
    const allDay = !!start.date && !start.dateTime;
    const when = formatDate(start.dateTime || start.date, allDay);
    const until = end.dateTime || end.date;
    const place = event.location ? ' · ' + String(event.location).slice(0, 120) : '';
    const link = event.link ? '\n' + event.link : '';
    return (i + 1) + '. ' + String(event.summary || '(Untitled event)') + '\n   ' + when + (until && !allDay ? ' – ' + formatDate(until, false) : '') + place + link;
  });
  return 'Here are your next ' + Math.min(data.length, 10) + ' upcoming calendar events:\n\n' + lines.join('\n\n');
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


// Directly handle the common “latest Gmail emails” request server-side.
// Do not depend on Gemini choosing to invoke a function call.
function isLatestGmailRequest(text) {
  const t = String(text || '').toLowerCase();
  return /\b(gmail|inbox|emails?|messages?)\b/.test(t)
    && /\b(latest|newest|most recent|recent)\b/.test(t)
    && /\b(search|find|check|show|list|get|read|look|fetch|what are|what's)\b/.test(t);
}

function formatLatestGmailResult(raw) {
  // runGoogleTool normally returns JSON text. Accept structured values and
  // common wrapped/fenced JSON too, so a harmless response-shape difference
  // cannot turn a successful Gmail fetch into a false parsing failure.
  let data = raw;
  if (typeof data === 'string') {
    const candidates = [data.trim(), data.trim().replace(/^\u0060\u0060\u0060(?:json)?\s*/i, '').replace(/\s*\u0060\u0060\u0060$/, '')];
    let parsed = false;
    for (const candidate of candidates) {
      try { data = JSON.parse(candidate); parsed = true; break; } catch {}
    }
    if (!parsed) {
      const message = data.trim();
      if (/^(Google connector:|Sign in and connect Google)/i.test(message)) {
        return 'I could not retrieve your Gmail: ' + message.replace(/^Google connector:\s*/i, '');
      }
      return message
        ? 'The Gmail connector responded, but not in the expected structured format: ' + message.slice(0, 500)
        : 'The Gmail connector returned an empty response.';
    }
  }
  if (!data || typeof data !== 'object') return 'The Gmail connector returned an unsupported response type.';
  if (typeof data.result === 'string') {
    try { data = JSON.parse(data.result); } catch {}
  } else if (data.result && typeof data.result === 'object') {
    data = data.result;
  }
  if (data.error || data.message && !Array.isArray(data.messages)) {
    return 'I could not retrieve your Gmail: ' + String(data.error?.message || data.error || data.message).slice(0, 500);
  }
  const messages = Array.isArray(data) ? data
    : Array.isArray(data.messages) ? data.messages
    : Array.isArray(data.data?.messages) ? data.data.messages
    : [];
  if (!messages.length) return 'I checked your connected Gmail, but the API returned no messages.';
  const header = (m, name) => (m.headers || m.payload?.headers || []).find((h) => String(h.name || '').toLowerCase() === name.toLowerCase())?.value || '';
  const items = messages.slice(0, 10).map((m) => ({
    from: header(m, 'From') || 'Unknown sender',
    subject: header(m, 'Subject') || '(no subject)',
    date: header(m, 'Date') || '',
    timestamp: Number(m.internalDate) || 0,
    snippet: String(m.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 320)
  }));
  return '[[GLITCH_GMAIL_RESULT:' + JSON.stringify({ count: Number(data.count) || messages.length, messages: items }) + ']]';
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

module.exports = { isDocumentRequest, isCodeWritingRequest, isUpcomingCalendarRequest, formatUpcomingCalendarResult, needsLiveSearch, buildSearchQuery, isLatestGmailRequest, formatLatestGmailResult, clean };
