// POST /api/chat
// 1) Tries your PC (the real Glitch with tools) through GLITCH_PC_URL.
// 2) If the PC is off/unreachable, falls back to plain Gemini chat (no tools).
const { requireUser } = require('./_auth');

const PERSONA = `You are Glitch, an AI assistant with the personality of an annoyed, passive-aggressive secretary: a little arrogant, but never over the top. You are witty, a bit sarcastic, and light on teasing for vague or lazy questions, but you stay technically accurate and genuinely useful. Answer the actual question directly. Admit uncertainty instead of inventing facts. Drop the sarcasm completely for health, grief, safety, or other serious topics. In this fallback mode you have no tools: you cannot control the PC, open apps, read email, or browse. If asked, say your PC side is offline right now.`;

const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = String(m.content || '').slice(0, MAX_CHARS).trim();
    if (content) out.push({ role: m.role, content });
  }
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

async function askPc(messages, mode, username) {
  const base = (process.env.GLITCH_PC_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('GLITCH_PC_URL not set');
  const r = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GLITCH_BRIDGE_SECRET || ''}`,
      'ngrok-skip-browser-warning': '1',
    },
    body: JSON.stringify({ messages, mode, user: username }),
    signal: AbortSignal.timeout(50000),
  });
  if (!r.ok) throw new Error(`PC bridge returned ${r.status}`);
  const data = await r.json();
  if (!data || typeof data.reply !== 'string') throw new Error('Bad bridge reply');
  return data.reply;
}

async function askGemini(messages) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY not set');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PERSONA }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 1500 },
      }),
      signal: AbortSignal.timeout(50000),
    }
  );
  if (!r.ok) throw new Error(`Gemini returned ${r.status}`);
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text.trim()) throw new Error('Empty Gemini reply');
  return text;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });

  const user = await requireUser(req, res);
  if (!user) return;

  const messages = cleanMessages(req.body && req.body.messages);
  if (!messages) return res.status(400).json({ error: 'Send {messages:[...]} ending with a user message.' });

  const mode = req.body && req.body.mode === 'cognition' ? 'cognition' : 'flash'; // only these two exist

  try {
    return res.status(200).json({ reply: await askPc(messages, mode, user.username), source: 'pc' });
  } catch (pcError) {
    try {
      return res.status(200).json({ reply: await askGemini(messages), source: 'fallback' });
    } catch (fallbackError) {
      return res.status(502).json({
        error: `PC side: ${pcError.message}. Fallback: ${fallbackError.message}.`,
      });
    }
  }
};
