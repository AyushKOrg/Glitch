const crypto=require('node:crypto');
const nodemailer=require('nodemailer');
const {supabaseUrl}=require('./_lib');
const DEVELOPERS=['aayushyt2013@gmail.com','aarav.krish62442@gmail.com'];
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(){return Array.from({length:13},()=>ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');}
function key(secret){return crypto.createHash('sha256').update(secret,'utf8').digest();}
function encryptCode(code,secret){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(secret),iv),data=Buffer.concat([c.update(code,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64url');}
function decryptCode(payload,secret){const b=Buffer.from(String(payload||''),'base64url');if(b.length<29)throw Error('No current VIP code is available.');const d=crypto.createDecipheriv('aes-256-gcm',key(secret),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');}
async function rotateCode(){
 const required=['SUPABASE_URL','SUPABASE_ANON_KEY','VIP_ROTATION_SECRET','GMAIL_USER','GMAIL_APP_PASSWORD'],missing=required.filter(k=>!process.env[k]);if(missing.length)throw Error('Missing environment variables: '+missing.join(', '));
 const code=makeCode(),hash=crypto.createHash('sha256').update(code).digest('hex'),ciphertext=encryptCode(code,process.env.VIP_ROTATION_SECRET);
 const r=await fetch(supabaseUrl()+'/rest/v1/rpc/rotate_glitch_vip_code',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_code_hash:hash,p_code_ciphertext:ciphertext,p_secret:process.env.VIP_ROTATION_SECRET}),signal:AbortSignal.timeout(12000)});
 if(!r.ok){const p=await r.json().catch(()=>({}));throw Error(p.message||'Supabase refused VIP rotation ('+r.status+').');}
 const mail=nodemailer.createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});
 const sent=await Promise.allSettled(DEVELOPERS.map(to=>mail.sendMail({from:'"Glitch VIP" <'+process.env.GMAIL_USER+'>',to,subject:'Your new Glitch VIP code',text:'Your new Glitch VIP code is: '+code+'\n\nThis code can be redeemed once. It expires immediately after the first successful redemption or at the next daily rotation.\n\nGlitch'})));
 mail.close();const failed=sent.map((x,i)=>x.status==='rejected'?DEVELOPERS[i]:null).filter(Boolean);if(failed.length)throw Error('Code rotated, but email delivery failed for: '+failed.join(', '));
 return {rotated:true,emailed:DEVELOPERS};
}
async function getCurrentCode(){
 const required=['SUPABASE_URL','SUPABASE_ANON_KEY','VIP_ROTATION_SECRET'];if(required.some(k=>!process.env[k]))throw Error('Server configuration is incomplete.');
 const r=await fetch(supabaseUrl()+'/rest/v1/rpc/get_glitch_vip_code',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_secret:process.env.VIP_ROTATION_SECRET}),signal:AbortSignal.timeout(10000)});
 const p=await r.json().catch(()=>null);if(!r.ok)throw Error('Could not retrieve the active code. It may not have been generated yet.');return decryptCode(p,process.env.VIP_ROTATION_SECRET);
}
module.exports={rotateCode,getCurrentCode,DEVELOPERS};
