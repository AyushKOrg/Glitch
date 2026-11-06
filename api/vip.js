const { requireUser, supabaseUrl } = require('./_lib');
const { rotateCode, DEVELOPERS } = require('./_vip-rotate');
async function rpc(user,name,body={}) {
 const r=await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:`Bearer ${user.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p.message||p.details||'VIP service is unavailable.');return p;
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store, private');
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'GET or POST only.'});}
 const user=await requireUser(req,res);if(!user)return;
 if(req.method==='GET'){try{const v=await rpc(user,'get_glitch_vip_status');const developer=DEVELOPERS.includes(user.email)&&v.developer===true;const vip=v.vip===true;return res.status(200).json({vip,developer,role:developer?'dev':vip?'vip':'free'});}catch(e){return res.status(502).json({error:e.message||'Could not check account status.'});}}
 if(user.isAnonymous)return res.status(403).json({error:'Sign in with a registered account to redeem VIP.'});
 try{
  const code=String(req.body&&req.body.code||'').trim();if(code.length!==13)return res.status(400).json({error:'VIP codes must be exactly 13 characters.'});
  const result=await rpc(user,'redeem_glitch_vip_code',{p_code:code});let codeRotated=false,rotationWarning=false;
  if(result.redeemed===true){try{await rotateCode();codeRotated=true;}catch(e){rotationWarning=true;console.error('VIP redeemed but replacement-code rotation/email failed:',e.message);}}
  return res.status(200).json({vip:result.vip===true,alreadyVip:result.already_vip===true,redeemed:result.redeemed===true,codeRotated,rotationWarning});
 }catch(e){const m=String(e.message||'VIP request failed.');return res.status(/invalid|already been used|sign in/i.test(m)?400:502).json({error:m});}
};
