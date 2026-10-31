// POST /api/chat  { mode: 'flash'|'cognition', messages: [{role, content, attachments?: ['<uid>/uploads/x.pdf']}] }
// Needs a signed-in Supabase user (Authorization: Bearer <access token>).
const { requireUser } = require('./_lib');
const { validPath, loadFile } = require('./_files');
const { systemPrompt, runGemini, runOpenRouter } = require('./_llm');

const MAX_MESSAGES = 20;
const MAX_CHARS = 8000;
const MAX_FILES = 4;               // newest attachments across the whole conversation

function clean(raw, userId) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = String(m.content || '').slice(0, MAX_CHARS).trim();
    const attachments = m.role === 'user' && Array.isArray(m.attachments)
      ? m.attachments.map(String).filter((p) => validPath(userId, p)).slice(0, MAX_FILES)
      : [];
    if (text || attachments.length) out.push({ role: m.role, text: text || '(no text)', attachments });
  }
  if (!out.length || out[out.length - 1].role !== 'user') return null;

  // Only the newest few files are loaded, so a long chat can't balloon the prompt.
  let budget = MAX_FILES;
  for (let i = out.length - 1; i >= 0; i--) {
    out[i].attachments = out[i].attachments.slice(0, budget);
    budget -= out[i].attachments.length;
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });

  const user = await requireUser(req, res);
  if (!user) return;

  const messages = clean(req.body && req.body.messages, user.id);
  if (!messages) return res.status(400).json({ error: 'Send {messages:[...]} ending with a user message.' });
  const mode = req.body && req.body.mode === 'cognition' ? 'cognition' : 'flash';

  try {
    // Load attachments and fold them into the messages they belong to.
    for (const m of messages) {
      m.files = await Promise.all(m.attachments.map((p) => loadFile(user.id, p, user.accessToken)));
      for (const f of m.files) {
        if (f.note) m.text += `\n\n[Attached file "${f.name}": ${f.note}]`;
        else if (mode === 'cognition' && f.kind === 'image') m.text += `\n\n[Attached image "${f.name}": this mode can't view images; switch to flash.]`;
        else if (f.kind === 'image') m.text += `\n\n[Attached image: ${f.name}]`;
        else if (f.kind === 'pdf' && mode === 'flash' && f.buffer) m.text += `\n\n[Attached PDF: ${f.name}]`;
        else if (f.text) m.text += `\n\n[Attached file "${f.name}" contents]\n${f.text}\n[end of ${f.name}]`;
        else m.text += `\n\n[Attached file "${f.name}": no readable text found (it may be a scan; try flash mode).]`;
      }
    }

    const ctx = { userId: user.id, accessToken: user.accessToken, created: [] };
    const system = systemPrompt(mode);
    const reply = mode === 'cognition'
      ? await runOpenRouter(ctx, system, messages)
      : await runGemini(ctx, system, messages);

    return res.status(200).json({ reply, files: ctx.created, mode });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
