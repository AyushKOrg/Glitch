// The model side: personality, tools, and the tool-calling loops for Gemini (flash) and OpenRouter (cognition).
const { ALLOWED_EXT, TEXT_EXT, extOf, safeName, storagePut, storageGet, storageList } = require('./_lib');
const { validPath } = require('./_files');

const MAX_STEPS = 6;
const DEADLINE_MS = 48000;            // stay inside the 60 s function limit
const MAX_FILE_CHARS = 200000;

const PERSONA = `You are Glitch, an AI assistant with the personality of an annoyed, passive-aggressive secretary: a little arrogant, but never over the top. You are witty and a bit sarcastic, with light teasing for vague or lazy questions, but you stay technically accurate and genuinely useful. Answer the actual question directly and keep replies tight. Admit uncertainty instead of inventing facts. Drop the sarcasm completely for health, grief, safety or other serious topics.

You are running on a website. Your tools:
- web_search(query): current information from the web.
- create_file(filename, content): save a text or code file for the user. It appears in their Files panel, where they can download it. Use a plain file name like "snake_game.py" (no folders). Calling it again with the same name replaces the file.
- read_file(path) and list_files(): read files the user uploaded ("uploads/…") or you created ("generated/…").
Content of files the user attached is already included in their message.
You cannot run code, open apps, control the computer, use the browser, read email or use YouTube here. If asked, say so plainly.
When you create a file, tell the user its name and that it's in the Files panel. Don't also paste a long file into the chat; a short excerpt is fine.`;

const MODE_NOTE = {
  flash: 'Mode: flash. Be quick and light.',
  cognition: 'Mode: cognition. Think carefully; prefer correctness and depth for reasoning and code.',
};

const TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web for current information. Returns a short summary with sources.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look up' } }, required: ['query'] },
  },
  {
    name: 'create_file',
    description: 'Create or replace a text/code file for the user to download. Flat file name only, e.g. "main.py".',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'File name with extension, no folders' },
        content: { type: 'string', description: 'Full file contents' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file the user uploaded or you created earlier. Path like "generated/main.py" or "uploads/notes.txt".',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'list_files',
    description: "List the user's uploaded and generated files.",
    parameters: { type: 'object', properties: {} },
  },
];

// ---- tool execution ---------------------------------------------------------
async function webSearch(query) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return 'Web search is unavailable (GOOGLE_API_KEY is not set).';
  const model = process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `Search the web and answer concisely with the key facts: ${query}` }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 1200 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) return `Web search failed (${r.status}).`;
  const data = await r.json();
  const cand = data.candidates && data.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('').trim();
  const sources = ((cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [])
    .map((c) => c.web && c.web.uri ? `- ${c.web.title || c.web.uri}: ${c.web.uri}` : '')
    .filter(Boolean).slice(0, 5);
  return (text || 'No results.') + (sources.length ? `\n\nSources:\n${sources.join('\n')}` : '');
}

async function runTool(ctx, name, args) {
  args = args && typeof args === 'object' ? args : {};
  try {
    if (name === 'web_search') return await webSearch(String(args.query || '').slice(0, 300));

    if (name === 'create_file') {
      const filename = safeName(args.filename);
      if (!filename) return `Refused: file name must be a plain name ending in one of ${[...ALLOWED_EXT].join(' ')}.`;
      const content = String(args.content == null ? '' : args.content);
      if (content.length > MAX_FILE_CHARS) return 'Refused: file is over 200,000 characters.';
      await storagePut(`${ctx.userId}/generated/${filename}`, Buffer.from(content, 'utf8'), 'text/plain; charset=utf-8', ctx.accessToken);
      if (!ctx.created.includes(filename)) ctx.created.push(filename);
      return `Saved generated/${filename} (${content.length} characters). It's in the user's Files panel.`;
    }

    if (name === 'read_file') {
      const path = `${ctx.userId}/${String(args.path || '').replace(/^\/+/, '')}`;
      if (!validPath(ctx.userId, path)) return 'Refused: use a path like "generated/main.py" or "uploads/notes.txt".';
      if (!TEXT_EXT.has(extOf(path))) return 'Only text and code files can be read this way. (Attached PDFs and Word files are already included in the message.)';
      const buf = await storageGet(path, ctx.accessToken);
      if (!buf) return 'No such file.';
      const text = buf.toString('utf8');
      return text.length > 60000 ? text.slice(0, 60000) + '\n…[truncated]' : text;
    }

    if (name === 'list_files') {
      const out = [];
      for (const folder of ['uploads', 'generated']) {
        for (const o of await storageList(`${ctx.userId}/${folder}`, ctx.accessToken)) out.push(`${folder}/${o.name}`);
      }
      return out.length ? out.join('\n') : 'No files yet.';
    }

    return `Unknown tool: ${name}`;
  } catch (e) {
    return `Tool error: ${e.message}`;
  }
}

// ---- Gemini (flash) ---------------------------------------------------------
async function runGemini(ctx, system, messages) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('Flash mode needs GOOGLE_API_KEY on the server.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const contents = messages.map((m) => {
    const parts = [{ text: m.text }];
    for (const f of m.files || []) {
      if (f.buffer && (f.kind === 'image' || f.kind === 'pdf')) {
        parts.push({ inlineData: { mimeType: f.mime, data: f.buffer.toString('base64') } });
      }
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });

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
  const model = process.env.OPENROUTER_MODEL;
  if (!key || !model) throw new Error('Cognition mode needs OPENROUTER_API_KEY and OPENROUTER_MODEL on the server.');

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
