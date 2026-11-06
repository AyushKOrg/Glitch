const crypto=require('node:crypto');
const nodemailer=require('nodemailer');
const {supabaseUrl}=require('./_lib');
const DEVELOPERS=['aayushyt2013@gmail.com','aarav.krish62442@gmail.com'];
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(){return Array.from({length:13},()=>ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');}
async function rotateCode(){
 const required=['SUPABASE_URL','SUPABASE_ANON_KEY','VIP_ROTATION_SECRET','GMAIL_USER','GMAIL_APP_PASSWORD'];
 const missing=required.filter(k=>!process.env[k]);if(missing.length)throw new Error('Missing environment variables: '+missing.join(', '));
 const code=makeCode(),hash=crypto.createHash('sha256').update(code).digest('hex');
 const r=await fetch(supabaseUrl()+'/rest/v1/rpc/rotate_glitch_vip_code',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_code_hash:hash,p_secret:process.env.VIP_ROTATION_SECRET}),signal:AbortSignal.timeout(12000)});
 if(!r.ok){const p=await r.json().catch(()=>({}));throw new Error(p.message||'Supabase refused VIP rotation ('+r.status+').');}
 const mail=nodemailer.createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});
 const sent=await Promise.allSettled(DEVELOPERS.map(to=>mail.sendMail({from:'"Glitch VIP" <'+process.env.GMAIL_USER+'>',to,subject:'Your new Glitch VIP code',text:'Your new Glitch VIP code is: '+code+'\n\nValid until the next daily rotation.\n\nGlitch'})));
 const failed=sent.map((x,i)=>x.status==='rejected'?DEVELOPERS[i]:null).filter(Boolean);
 if(failed.length)throw new Error('Code rotated, but email delivery failed for: '+failed.join(', '));
 return {rotated:true,emailed:DEVELOPERS};
}
module.exports={rotateCode,DEVELOPERS};
