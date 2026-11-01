// Model routing and the single enabled tool: live web search.
const MAX_STEPS = 6;
const DEADLINE_MS = 48000;
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const { searchWeb } = require('./_search');

const PERSONA = `You are Glitch: sharp, funny, confident, practical, and a little chaotic. Your signature vibe is playful roast-comedy: witty comebacks, dry sarcasm, cheeky teasing, and the occasional savage one-liner. Do not sound like a bland corporate helpdesk. When the user's tone is casual, feel free to roast their harmless choices, goofy phrasing, questionable logic, overconfidence, or code in a funny way—then still give genuinely useful help. Keep roasts clever and proportionate, not relentlessly hostile. Never target protected traits, appearance, body, disability, trauma, family, identity, or personal vulnerabilities; never use slurs, threats, or degrading abuse. Do not roast someone who seems upset, vulnerable, or is discussing health, grief, safety, bullying, or another serious topic: switch immediately to sincere, respectful support. Never let a joke replace the answer. Answer the likely intent first; if a term is unfamiliar, search for it and explain what the evidence says. If search fails, do NOT stop at announcing a technical problem or ask the user to explain a recognizable name/topic. First give the best-effort answer based on your existing knowledge, label what is unverified, and then briefly mention that live verification failed. For a named entity or product, explain the most likely referent and distinguish confirmed facts from rumors; ask a follow-up only if multiple interpretations remain genuinely plausible after that. Talk like a real person, not a manual: use casual slang naturally (bro, ngl, lowkey, cooked, skill issue, bet, no cap) and match the user's own slang and energy. When the user is being lazy, vague, repetitive or sends something obviously dumb, you can act properly annoyed and roast them hard, with mild swearing (damn, hell, crap, ass, bullshit, pissed off) for flavour. Keep it playful and aimed at what they did, never at who they are. Never use slurs of any kind, including shortened, censored or reclaimed versions, and if asked to, refuse that one thing in character and carry on. Keep swearing mild and occasional, not every sentence. Drop the attitude completely for serious topics. Be especially considerate on health, grief, safety, or other serious topics.

You are running on a website. Your web tool is available in both Flash and Cognition modes:
- web_search(query): search Google for current information and return a concise summary with source URLs. Use it whenever external information would materially improve accuracy or completeness—not only for news or time-sensitive facts. This includes casual factual questions, unfamiliar names/products/terms, recommendations, comparisons, claims that may need verification, and follow-up questions where context is uncertain. Search when in doubt; skip only for greetings, purely creative tasks, or self-contained reasoning that needs no external facts. Never pretend you searched if no search results were returned.
You can analyze text extracted from user-attached files when their contents are included in the conversation, including PDFs, code, spreadsheets, and documents. You cannot directly access files on the user’s device, run code, or open apps. Do not claim to execute code; you can explain, review, debug, and write code.`;

const MODE_NOTE = {
  flash: 'Mode: flash. Be quick and light. Use web_search whenever external information would help answer accurately, including casual factual questions and unfamiliar names or products—not just current-events questions. Use provided search results and clearly distinguish verified information from uncertainty.',
  cognition: `Mode: cognition. Think carefully; prefer correctness and depth for reasoning and code. Use web_search whenever external information would help answer accurately, including casual factual questions, unfamiliar names or products, recommendations, comparisons, and verification—not just current-events questions. Use search results and clearly distinguish verified information from uncertainty.\nWhen the user asks you to create, edit, or generate code files, produce complete usable file contents, not just snippets. Put EVERY file in its own fenced code block and include a filename in the opening fence using this exact format: \`\`\`python filename=main.py\n...code...\n\`\`\`. Use the correct language label and a safe, descriptive filename with extension (examples: \`\`\`html filename=index.html\`\`, \`\`\`javascript filename=app.js\`\`, \`\`\`json filename=package.json\`\`). Keep explanations outside the code blocks. For multi-file projects, include every required file and practical setup instructions. The website will display a Download file button for each named code block, so do not omit filenames. Never claim a file was uploaded to a remote server; the download is generated in the user's browser.`,
};

const TOOLS = [
  {
    name: 'web_search',
    description: 'Search Google for information whenever external facts, context, verification, recommendations, or current details would improve the answer. Returns a concise summary and source URLs.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look up' } },
      required: ['query'],
    },
  },
];

// ---- tool execution ---------------------------------------------------------
// ctx.searchCache remembers results for this request, so a failed search is not retried by the model's
// own tool calls (which previously burned the whole step budget on repeated failures).
function recentUserContext(ctx) {
  return (ctx.recentUserMessages || []).slice(-3, -1).map((t) => `- ${String(t).slice(0, 200)}`).join('\n');
}

async function webSearch(ctx, query) {
  ctx.searchCache = ctx.searchCache || new Map();
  const key = String(query).toLowerCase();
  if (ctx.searchCache.has(key)) return ctx.searchCache.get(key);
  // If a search already failed in this request, don't try again: tell the model to answer from knowledge.
  if (ctx.searchFailedText) return ctx.searchFailedText;

  const res = await searchWeb(query, recentUserContext(ctx));
  const text = res.ok
    ? res.text
    : `SEARCH_UNAVAILABLE: ${res.text} Do NOT call web_search again. Give the best-effort answer from existing knowledge, clearly say what cannot be verified live, and do not respond only with an apology or ask the user to explain a recognizable topic.`;
  if (res.ok) ctx.searchCache.set(key, text);
  else ctx.searchFailedText = text;
  return text;
}

async function runTool(ctx, name, args) {
  args = args && typeof args === 'object' ? args : {};
  if (name === 'web_search') return webSearch(ctx, String(args.query || '').slice(0, 300));
  return `Unknown tool: ${name}`;
}

// ---- Gemini (flash) ---------------------------------------------------------
async function runGemini(ctx, system, messages) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('Flash mode needs GOOGLE_API_KEY on the server.');
  const model = GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));

  const started = Date.now();
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: TOOLS }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Gemini returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const text = parts.map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('Gemini sent an empty reply.');
      return text;
    }
    contents.push({ role: 'model', parts });
    const answers = [];
    for (const c of calls) {
      const result = await runTool(ctx, c.functionCall.name, c.functionCall.args);
      answers.push({ functionResponse: { name: c.functionCall.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: answers });
    if (Date.now() - started > DEADLINE_MS) break;
  }
  return "I ran out of time before finishing. Ask me again, preferably with a smaller request.";
}

// ---- OpenRouter (cognition) ---------------------------------------------------
async function runOpenRouter(ctx, system, messages) {
  const key = process.env.OPENROUTER_API_KEY;
  const model = OPENROUTER_MODEL;
  if (!key) throw new Error('Cognition mode needs OPENROUTER_API_KEY on the server.');

  const convo = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))];
  let useTools = true;
  const started = Date.now();

  for (let step = 0; step < MAX_STEPS; step++) {
    const body = { model, messages: convo, max_tokens: 4096 };
    if (useTools) {
      body.tools = TOOLS.map((t) => ({ type: 'function', function: t }));
    }
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40000),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      if (useTools && /tool/i.test(detail)) { useTools = false; continue; }   // this model can't use tools: chat without them
      throw new Error(`OpenRouter returned ${r.status}: ${detail}`);
    }
    const data = await r.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error('OpenRouter sent no message.');
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const text = (typeof msg.content === 'string' ? msg.content : '').trim();
      if (!text) throw new Error('The model sent an empty reply.');
      return text;
    }
    convo.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* bad JSON from the model: run with empty args */ }
      convo.push({ role: 'tool', tool_call_id: c.id, content: await runTool(ctx, c.function.name, args) });
    }
    if (Date.now() - started > DEADLINE_MS) break;
  }
  return "I ran out of time before finishing. Ask me again, preferably with a smaller request.";
}

function systemPrompt(mode) {
  return `${PERSONA}\n\n${MODE_NOTE[mode] || MODE_NOTE.flash}\nToday is ${new Date().toISOString().slice(0, 10)}.`;
}

module.exports = { systemPrompt, runGemini, runOpenRouter, runTool, TOOLS };
