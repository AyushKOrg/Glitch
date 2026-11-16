// Save a generated Pollinations image to the caller's private Glitch Library.
const { requireUser, supabaseUrl } = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const sourceUrl = new URL(String(req.body && req.body.url || ''));
    if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'media.pollinations.ai') {
      return res.status(400).json({ error: 'Only Glitch-generated image URLs can be saved by this endpoint.' });
    }
    const response = await fetch(sourceUrl.toString(), { signal: AbortSignal.timeout(25000) });
    if (!response.ok) return res.status(502).json({ error: 'The generated image could not be retrieved.' });
    const mime = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : '';
    if (!ext) return res.status(415).json({ error: 'The image provider returned an unsupported image format.' });
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > 25 * 1024 * 1024) return res.status(413).json({ error: 'Generated images must be 25 MB or smaller.' });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Generated image is empty or exceeds 25 MB.' });
    const name = 'glitch-generated-image-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + ext;
    const path = user.id + '/' + name;
    const objectUrl = basePath => basePath + '/storage/v1/object/glitch-library/' + path.split('/').map(encodeURIComponent).join('/');
    const base = supabaseUrl();
    const upload = await fetch(objectUrl(base), {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + user.accessToken, 'Content-Type': mime, 'x-upsert': 'false' },
      body: bytes,
      signal: AbortSignal.timeout(25000),
    });
    if (!upload.ok) {
      const detail = await upload.json().catch(() => ({}));
      throw new Error(detail.message || detail.error || 'Supabase Storage upload failed.');
    }
    const saved = await fetch(base + '/rest/v1/glitch_library_items', {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + user.accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: user.id, object_path: path, name, mime_type: mime, size_bytes: bytes.length, source: 'generated' }),
      signal: AbortSignal.timeout(12000),
    });
    if (!saved.ok) {
      await fetch(objectUrl(base), { method: 'DELETE', headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + user.accessToken }, signal: AbortSignal.timeout(10000) }).catch(() => {});
      const detail = await saved.json().catch(() => ({}));
      throw new Error(detail.message || 'Could not index the generated image in your Library.');
    }
    const rows = await saved.json();
    return res.status(200).json({ item: Array.isArray(rows) ? rows[0] : rows });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Could not save generated image.' });
  }
};
