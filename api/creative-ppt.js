// POST /api/creative-ppt — generate an editable PowerPoint for VIP/DEV accounts.
const { requireUser, supabaseUrl } = require('./_lib');
const pptxgen = require('pptxgenjs');
const { DEVELOPERS } = require('./_vip-rotate');

async function requireVipOrDev(user) {
  if (!user || user.isAnonymous) return false;
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/get_glitch_vip_status`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('Membership could not be verified.');
  const status = await r.json().catch(() => ({}));
  return status.vip === true || (DEVELOPERS.includes(user.email) && status.developer === true);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only.' }); }
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    if (!(await requireVipOrDev(user))) return res.status(403).json({ error: 'Presentation Studio is exclusive to VIP and DEV accounts.', vipRequired: true });
    const body = req.body || {};
    const title = String(body.title || '').trim().slice(0, 140);
    const subtitle = String(body.subtitle || '').trim().slice(0, 220);
    const slides = Array.isArray(body.slides) ? body.slides.slice(0, 20) : [];
    if (!title || slides.length < 1) return res.status(400).json({ error: 'A title and at least one content slide are required.' });
    const normalized = slides.map((s, i) => ({
      title: String(s && s.title || `Slide ${i + 1}`).trim().slice(0, 120),
      bullets: (Array.isArray(s && s.bullets) ? s.bullets : []).slice(0, 6).map(x => String(x || '').trim().slice(0, 260)).filter(Boolean),
      body: String(s && s.body || '').trim().slice(0, 900),
    }));
    if (normalized.some(s => !s.title || (!s.body && !s.bullets.length))) return res.status(400).json({ error: 'Every slide needs a title and some content.' });
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'Glitch';
    pptx.subject = 'VIP presentation generated with Glitch';
    pptx.title = title;
    pptx.company = 'Glitch';
    pptx.lang = 'en-US';
    pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'en-US' };
    pptx.defineSlideMaster({
      title: 'GLITCH_MASTER', background: { color: '101322' },
      objects: [
        { rect: { x: 0, y: 7.34, w: 13.333, h: 0.16, line: { color: '7C5CFF', transparency: 100 }, fill: { color: '7C5CFF' } } },
        { text: { text: 'GLITCH  •  VIP CREATIVE STUDIO', options: { x: 0.55, y: 7.02, w: 7, h: 0.18, fontFace: 'Aptos', fontSize: 8, color: 'A9B2D0', charSpacing: 1.1, margin: 0 } } },
      ],
      slideNumber: { x: 12.25, y: 7.0, w: 0.5, h: 0.2, color: 'A9B2D0', fontFace: 'Aptos', fontSize: 9 },
    });
    const cover = pptx.addSlide();
    cover.background = { color: '101322' };
    cover.addShape(pptx.ShapeType.rect, { x: 0.7, y: 1.05, w: 0.12, h: 4.95, rectRadius: 0.03, line: { color: '8A6CFF', transparency: 100 }, fill: { color: '8A6CFF' } });
    cover.addText(title, { x: 1.15, y: 1.55, w: 10.8, h: 2.2, fontFace: 'Aptos Display', fontSize: 34, bold: true, color: 'FFFFFF', breakLine: false, valign: 'mid', margin: 0.04, fit: 'shrink' });
    if (subtitle) cover.addText(subtitle, { x: 1.18, y: 4.0, w: 9.8, h: 0.9, fontSize: 18, color: 'B8C2E5', margin: 0.02, breakLine: false, fit: 'shrink' });
    cover.addText('Created with Glitch', { x: 1.18, y: 5.75, w: 4.5, h: 0.35, fontSize: 11, bold: true, color: '9A82FF', charSpacing: 1.2, margin: 0 });
    for (const item of normalized) {
      const slide = pptx.addSlide('GLITCH_MASTER');
      slide.addText(item.title, { x: 0.72, y: 0.55, w: 11.9, h: 0.75, fontFace: 'Aptos Display', fontSize: 27, bold: true, color: 'FFFFFF', margin: 0.02, fit: 'shrink' });
      slide.addShape(pptx.ShapeType.line, { x: 0.74, y: 1.48, w: 1.15, h: 0, line: { color: '9A82FF', width: 3 } });
      if (item.body) slide.addText(item.body, { x: 0.82, y: 1.85, w: 11.65, h: 1.05, fontSize: 17, color: 'D9DDF0', breakLine: false, valign: 'top', margin: 0.04, fit: 'shrink' });
      if (item.bullets.length) {
        const y = item.body ? 3.05 : 2.0;
        slide.addText(item.bullets.map(text => ({ text, options: { bullet: { indent: 18 }, hanging: 4, breakLine: true } })), {
          x: 1.0, y, w: 11.25, h: item.body ? 3.55 : 4.5, fontFace: 'Aptos', fontSize: 19, color: 'FFFFFF', paraSpaceAfterPt: 17, breakLine: false, valign: 'top', margin: 0.05, fit: 'shrink',
        });
      }
    }
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'glitch-presentation';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pptx"`);
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('[Glitch PPT]', error);
    return res.status(502).json({ error: error.message || 'Could not generate the presentation.' });
  }
};
