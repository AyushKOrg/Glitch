const {requireUser,supabaseUrl}=require('./_lib');
const {getCurrentCode,DEVELOPERS}=require('./_vip-rotate');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store, private');res.setHeader('Pragma','no-cache');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'POST only.'});}
 const user=await requireUser(req,res);if(!user)return;
 if(user.isAnonymous||!DEVELOPERS.includes(user.email))return res.status(403).json({error:'Developer account required.'});
 const password=typeof(req.body&&req.body.password)==='string'?req.body.password:'';
 if(!password||password.length>256)return res.status(400).json({error:'Enter your developer-account password.'});
 try{
  const v=await fetch(supabaseUrl()+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password}),signal:AbortSignal.timeout(10000)});
  const s=await v.json().catch(()=>({}));if(!v.ok||!s.user||s.user.id!==user.id)return res.status(401).json({error:'Password verification failed. Please try again.'});
  return res.status(200).json({code:await getCurrentCode()});
 }catch(e){console.error('Developer current-code verification failed:',e.message);return res.status(502).json({error:e.message||'Could not retrieve the current code.'});}
};
