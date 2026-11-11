// POST /api/images generates a Pollinations image; GET returns the caller's quota.
const { requireUser, supabaseUrl } = require('./_lib');

const DAILY_LIMIT = 15;
const MODELS = new Set([
  'qwen/qwen-image-2.1',
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

const pptxgen = require('pptxgenjs');
const { runOpenRouter } = require('./_llm');
const { DEVELOPERS } = require('./_vip-rotate');

async function requireVipOrDev(user) {
  if (!user || user.isAnonymous) return false;
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/get_glitch_vip_status`, {
    method:'POST', headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:`Bearer ${user.accessToken}`,'Content-Type':'application/json'},
    body:'{}', signal:AbortSignal.timeout(8000),
  });
  if(!r.ok) throw new Error('Membership could not be verified.');
  const status=await r.json().catch(()=>({}));
  return status.vip===true || (DEVELOPERS.includes(user.email)&&status.developer===true);
}
async function creativeOutline(user, body) {
  if(!(await requireVipOrDev(user))) return {status:403,data:{error:'Creative Studio is exclusive to VIP and DEV accounts.',vipRequired:true}};
  if(!process.env.OPENROUTER_API_KEY) return {status:503,data:{error:'Creative prompt refinement needs the existing OpenRouter connection. Configure a free model in OPENROUTER_MODEL.'}};
  const kind=body.kind==='flow'?'flow':'presentation';
  const prompt=String(body.prompt||'').trim().slice(0,5000);
  if(prompt.length<5)return {status:400,data:{error:'Enter a more detailed idea first.'}};
  const system=kind==='flow'
    ? 'You are Glitch Creative Director. Rewrite the user idea into one excellent, ready-to-paste Google Flow prompt. Preserve intent; add subject details, scene, composition, lighting, camera movement, motion, visual style, continuity, aspect ratio guidance and avoid-list where useful. Do not claim you can operate Google Flow. Return only the final prompt, no markdown or commentary.'
    : 'You are Glitch Presentation Director. Convert the user idea into a well-structured presentation outline. Return ONLY valid JSON matching {"title":"...","subtitle":"...","slides":[{"title":"...","body":"...","bullets":["..."]}]}. Create 5–12 useful content slides, each with a concise title, optional short body and 2–5 substantive bullets. Make it coherent, accurate, audience-aware and visually scannable. Do not include markdown fences or text outside JSON. Never invent specific statistics or citations; qualify uncertain claims.';
  const reply=await runOpenRouter({userId:user.id,recentUserMessages:[]},system,[{role:'user',text:prompt}]);
  if(!reply||!String(reply).trim())throw new Error('The free model returned an empty result.');
  if(kind==='flow')return {status:200,data:{prompt:String(reply).trim().slice(0,8000)}};
  const raw=String(reply).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  let outline;try{outline=JSON.parse(raw);}catch{throw new Error('The model did not return valid slide-outline JSON. Try a more specific topic.');}
  if(!outline||typeof outline.title!=='string'||!Array.isArray(outline.slides))throw new Error('The slide outline was incomplete.');
  return {status:200,data:{outline:{title:outline.title.slice(0,140),subtitle:String(outline.subtitle||'').slice(0,220),slides:outline.slides.slice(0,20)}}};
}
async function createCreativePpt(user, body, res) {
  if(!(await requireVipOrDev(user)))return res.status(403).json({error:'Presentation Studio is exclusive to VIP and DEV accounts.',vipRequired:true});
  const title=String(body.title||'').trim().slice(0,140), subtitle=String(body.subtitle||'').trim().slice(0,220);
  const slides=Array.isArray(body.slides)?body.slides.slice(0,20):[];
  if(!title||!slides.length)return res.status(400).json({error:'A title and at least one content slide are required.'});
  const normalized=slides.map((s,i)=>({title:String(s&&s.title||`Slide ${i+1}`).trim().slice(0,120),bullets:(Array.isArray(s&&s.bullets)?s.bullets:[]).slice(0,6).map(x=>String(x||'').trim().slice(0,260)).filter(Boolean),body:String(s&&s.body||'').trim().slice(0,900)}));
  if(normalized.some(s=>!s.title||(!s.body&&!s.bullets.length)))return res.status(400).json({error:'Every slide needs a title and some content.'});
  const pptx=new pptxgen();pptx.layout='LAYOUT_WIDE';pptx.author='Glitch';pptx.subject='VIP presentation generated with Glitch';pptx.title=title;pptx.company='Glitch';pptx.lang='en-US';
  pptx.theme={headFontFace:'Aptos Display',bodyFontFace:'Aptos',lang:'en-US'};
  pptx.defineSlideMaster({title:'GLITCH_MASTER',background:{color:'101322'},objects:[
    {rect:{x:0,y:7.34,w:13.333,h:.16,line:{color:'7C5CFF',transparency:100},fill:{color:'7C5CFF'}}},
    {text:{text:'GLITCH • VIP CREATIVE STUDIO',options:{x:.55,y:7.02,w:7,h:.18,fontFace:'Aptos',fontSize:8,color:'A9B2D0',charSpacing:1.1,margin:0}}}
  ],slideNumber:{x:12.25,y:7,w:.5,h:.2,color:'A9B2D0',fontFace:'Aptos',fontSize:9}});
  const cover=pptx.addSlide();cover.background={color:'101322'};
  cover.addShape(pptx.ShapeType.rect,{x:.7,y:1.05,w:.12,h:4.95,line:{color:'8A6CFF',transparency:100},fill:{color:'8A6CFF'}});
  cover.addText(title,{x:1.15,y:1.55,w:10.8,h:2.2,fontFace:'Aptos Display',fontSize:34,bold:true,color:'FFFFFF',valign:'mid',margin:.04,fit:'shrink'});
  if(subtitle)cover.addText(subtitle,{x:1.18,y:4,w:9.8,h:.9,fontSize:18,color:'B8C2E5',margin:.02,fit:'shrink'});
  cover.addText('Created with Glitch',{x:1.18,y:5.75,w:4.5,h:.35,fontSize:11,bold:true,color:'9A82FF',charSpacing:1.2,margin:0});
  for(const item of normalized){
    const slide=pptx.addSlide('GLITCH_MASTER');
    slide.addText(item.title,{x:.72,y:.55,w:11.9,h:.75,fontFace:'Aptos Display',fontSize:27,bold:true,color:'FFFFFF',margin:.02,fit:'shrink'});
    slide.addShape(pptx.ShapeType.line,{x:.74,y:1.48,w:1.15,h:0,line:{color:'9A82FF',width:3}});
    if(item.body)slide.addText(item.body,{x:.82,y:1.85,w:11.65,h:1.05,fontSize:17,color:'D9DDF0',valign:'top',margin:.04,fit:'shrink'});
    if(item.bullets.length)slide.addText(item.bullets.map(text=>({text,options:{bullet:{indent:18},hanging:4,breakLine:true}})),{x:1,y:item.body?3.05:2,w:11.25,h:item.body?3.55:4.5,fontFace:'Aptos',fontSize:19,color:'FFFFFF',paraSpaceAfterPt:17,valign:'top',margin:.05,fit:'shrink'});
  }
  const buffer=await pptx.write({outputType:'nodebuffer'});
  const safe=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'glitch-presentation';
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition',`attachment; filename="${safe}.pptx"`);
  res.setHeader('Content-Length',buffer.length);res.status(200).send(buffer);return null;
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
    if (req.method === 'POST' && req.body && req.body.action === 'outline') {
      const result=await creativeOutline(user,req.body);
      return res.status(result.status).json(result.data);
    }
    if (req.method === 'POST' && req.body && req.body.action === 'ppt') {
      return await createCreativePpt(user,req.body,res);
    }
    if (req.method === 'GET') {
      const status = await rpc(user, 'get_glitch_vip_status');
      return res.status(200).json({ vip: status.vip === true });
    }
    if (!process.env.POLLINATIONS_API_KEY) return res.status(503).json({ error: 'POLLINATIONS_API_KEY is missing from the server environment.' });
    const prompt = String(req.body && req.body.prompt || '').trim();
    const model = String(req.body && req.body.model || 'qwen/qwen-image-2.1');
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
