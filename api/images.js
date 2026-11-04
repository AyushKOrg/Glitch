// POST /api/images generates a Pollinations image; GET returns the caller's quota.
const { requireUser, supabaseUrl } = require('./_lib');

const DAILY_LIMIT = 15;
const MODELS = new Set([
  'black-forest-labs/flux.1-schnell',
  'krea/krea-2-medium',
  'google/gemini-3.1-flash-image',
]);

async function rpc(user, name) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || 'Image quota service is unavailable.');
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET or POST only.' });
  }
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') {
      const status = await rpc(user, 'get_glitch_vip_status');
      return res.status(200).json({ vip: status.vip === true });
    }
    if (!process.env.POLLINATIONS_API_KEY) return res.status(503).json({ error: 'POLLINATIONS_API_KEY is missing from the server environment.' });
    const prompt = String(req.body && req.body.prompt || '').trim();
    const model = String(req.body && req.body.model || 'black-forest-labs/flux.1-schnell');
    if (!prompt || prompt.length > 1000) return res.status(400).json({ error: 'Enter an image prompt between 1 and 1000 characters.' });
    if (!MODELS.has(model)) return res.status(400).json({ error: 'That image model is not available.' });
    const vipStatus = await rpc(user, 'get_glitch_vip_status');
    if (vipStatus.vip !== true) return res.status(403).json({ error: 'Image generation is a VIP feature. Redeem a VIP invite to generate images directly in chat.', vipRequired: true });
    // Image generation is VIP-only, so no free-tier quota or image-usage migration is needed.
    const quota = { vip: true, allowed: true, used: 0, remaining: null, limit: null };
    if (quota.allowed !== true) return res.status(429).json({ error: 'You have used all 15 free image generations for today. Your allowance resets at 00:00 UTC, or VIP accounts get unlimited generations.', usage: quota });

    let refunded = false;
    const refund = async () => {
      if (refunded || quota.vip) return;
      refunded = true;
      try { await rpc(user, 'refund_glitch_image_generation'); } catch {}
    };
    try {
      const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=${encodeURIComponent(model)}&width=1024&height=1024&nologo=true`;
      const upstream = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}`, Accept: 'image/*' },
        signal: AbortSignal.timeout(55000),
      });
      if (!upstream.ok) {
        await refund();
        const message = upstream.status === 401 ? 'Pollinations rejected the API key. Check POLLINATIONS_API_KEY.' :
          upstream.status === 402 ? 'The Pollinations account has insufficient balance or budget.' :
          'Pollinations image generation failed (' + upstream.status + '). Please try again.';
        return res.status(upstream.status === 402 ? 503 : 502).json({ error: message });
      }
      const contentType = String(upstream.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(png|jpeg|webp)$/.test(contentType)) {
        await refund();
        return res.status(502).json({ error: 'Pollinations returned an unsupported image format.' });
      }
      // Prefer Pollinations' hosted media URL. This avoids buffering/base64-encoding
      // multi-megabyte images inside a serverless function response.
      const linkHeader = upstream.headers.get('link') || '';
      const enclosure = [...linkHeader.matchAll(/<([^>]+)>\s*;\s*rel=["']?enclosure["']?/gi)]
        .map(match => match[1]).find(value => {
          try {
            const parsed = new URL(value);
            return parsed.protocol === 'https:' && parsed.hostname === 'media.pollinations.ai';
          } catch { return false; }
        });
      if (enclosure) {
        // Drain the upstream body so the provider can finish its response cleanly.
        if (upstream.body && typeof upstream.body.cancel === 'function') {
          await upstream.body.cancel().catch(() => {});
        }
        return res.status(200).json({
          imageUrl: enclosure,
          usage: quota.vip ? null : { used: quota.used, remaining: quota.remaining, limit: DAILY_LIMIT },
          vip: quota.vip === true,
        });
      }

      // Fallback for provider responses without a hosted-media Link header.
      const maxBytes = 3 * 1024 * 1024;
      const announcedLength = Number(upstream.headers.get('content-length') || 0);
      if (announcedLength > maxBytes) {
        await refund();
        return res.status(502).json({ error: 'Pollinations did not provide a hosted image link and its image exceeds the safe response limit. Please try again.' });
      }
      if (!upstream.body || typeof upstream.body.getReader !== 'function') {
        await refund();
        return res.status(502).json({ error: 'Pollinations returned an unreadable image response.' });
      }
      const reader = upstream.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        totalBytes += part.value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          await refund();
          return res.status(502).json({ error: 'Pollinations did not provide a hosted image link and its image exceeds the safe response limit. Please try again.' });
        }
        chunks.push(Buffer.from(part.value));
      }
      const bytes = Buffer.concat(chunks, totalBytes);
      if (!bytes.length) {
        await refund();
        return res.status(502).json({ error: 'Pollinations returned an empty image.' });
      }
      return res.status(200).json({
        image: `data:${contentType};base64,${bytes.toString('base64')}`,
        usage: quota.vip ? null : { used: quota.used, remaining: quota.remaining, limit: DAILY_LIMIT },
        vip: quota.vip === true,
      });
    } catch (error) {
      await refund();
      throw error;
    }
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Image generation failed.' });
  }
};
