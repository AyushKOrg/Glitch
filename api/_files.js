// Turns a stored file into something a model can read.
const { DOC_EXT, TEXT_EXT, IMAGE_MIME, extOf, storageGet } = require('./_lib');

const MAX_TEXT_CHARS = 60000;       // per file, so one huge upload can't swamp the prompt
const MAX_INLINE_BYTES = 12 * 1024 * 1024; // PDFs / images sent natively to Gemini

const clip = (s) => (s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + '\n…[truncated]' : s);

// Paths look like <user-id>/uploads/<file> or <user-id>/generated/<file>. Anything else is refused.
function validPath(userId, path) {
  const m = /^([0-9a-f-]{36})\/(uploads|generated)\/([A-Za-z0-9._-]{1,100})$/.exec(String(path || ''));
  return Boolean(m) && m[1] === userId;
}

async function extractPdfText(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function extractDocxText(buffer) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

// -> { name, kind: 'text'|'pdf'|'image', text?, buffer?, mime?, note? }
async function loadFile(userId, path) {
  const name = String(path).split('/').pop();
  if (!validPath(userId, path)) return { name, kind: 'text', text: '', note: 'invalid path' };
  const buffer = await storageGet(path);
  if (!buffer) return { name, kind: 'text', text: '', note: 'file not found' };

  const ext = extOf(name);
  if (TEXT_EXT.has(ext)) return { name, kind: 'text', text: clip(buffer.toString('utf8')) };

  if (IMAGE_MIME[ext]) {
    if (buffer.length > MAX_INLINE_BYTES) return { name, kind: 'text', text: '', note: 'image too large to view' };
    return { name, kind: 'image', buffer, mime: IMAGE_MIME[ext] };
  }

  if (ext === '.docx') {
    try { return { name, kind: 'text', text: clip(await extractDocxText(buffer)) }; }
    catch { return { name, kind: 'text', text: '', note: "couldn't read this Word file" }; }
  }

  if (ext === '.pdf') {
    let text = '';
    try { text = clip(await extractPdfText(buffer)); } catch { /* scanned or odd PDF: fall through */ }
    const inline = buffer.length <= MAX_INLINE_BYTES ? buffer : null;
    return { name, kind: 'pdf', text, buffer: inline, mime: 'application/pdf' };
  }

  return { name, kind: 'text', text: '', note: 'unsupported type' };
}

module.exports = { validPath, loadFile, DOC_EXT };
