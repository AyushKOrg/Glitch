const { requireUser, supabaseUrl } = require('./_lib');
const MAX_MEMORIES=100,MAX_CONTENT=500,UUID=/^[0-9a-f-]{36}$/i;
async function request(user,method,path,body,prefer='return=minimal'){
  return fetch(`${supabaseUrl()}/rest/v1/glitch_memories${path}`,{method,headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:`Bearer ${user.accessToken}`,'Content-Type':'application/json',Prefer:prefer},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
}
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');const user=await requireUser(req,res);if(!user)return;
  try{
    if(req.method==='GET'){const r=await request(user,'GET',`?select=id,content,created_at&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=${MAX_MEMORIES}`);if(!r.ok)return res.status(502).json({error:`Could not load memory (${r.status}).`});return res.status(200).json({memories:await r.json()});}
    if(req.method==='POST'){const content=String(req.body&&req.body.content||'').trim().slice(0,MAX_CONTENT);if(!content)return res.status(400).json({error:'Memory cannot be empty.'});const r=await request(user,'POST','',{user_id:user.id,content},'return=representation');if(!r.ok){const detail=await r.text();if(r.status===409)return res.status(200).json({saved:true,duplicate:true});return res.status(502).json({error:`Could not save memory (${r.status}): ${detail.slice(0,180)}`});}const rows=await r.json();return res.status(201).json({memory:rows[0]||null});}
    if(req.method==='PATCH'){
      const id=String(req.body&&req.body.id||''),content=String(req.body&&req.body.content||'').trim().slice(0,MAX_CONTENT);
      if(!UUID.test(id))return res.status(400).json({error:'A valid memory ID is required.'});if(!content)return res.status(400).json({error:'Memory cannot be empty.'});
      const existing=await request(user,'GET',`?select=id,content&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`);
      if(!existing.ok)return res.status(502).json({error:'Could not verify the existing memory before editing.'});
      const currentRows=await existing.json();if(!currentRows.length)return res.status(404).json({error:'Memory not found.'});
      if(currentRows[0].content===content)return res.status(200).json({updated:true});
      const added=await request(user,'POST','',{user_id:user.id,content},'return=representation');
      if(!added.ok&&added.status!==409)return res.status(502).json({error:`Could not save edited memory (${added.status}).`});
      const removed=await request(user,'DELETE',`?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`);
      if(!removed.ok)return res.status(502).json({error:'The edited memory was saved, but the previous copy could not be removed. Refresh your memory list.'});
      return res.status(200).json({updated:true});
    }
    if(req.method==='DELETE'){const id=String(req.body&&req.body.id||'');if(!UUID.test(id))return res.status(400).json({error:'A valid memory ID is required.'});const r=await request(user,'DELETE',`?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`);if(!r.ok)return res.status(502).json({error:`Could not delete memory (${r.status}).`});return res.status(200).json({deleted:true});}
    res.setHeader('Allow','GET, POST, PATCH, DELETE');return res.status(405).json({error:'GET, POST, PATCH, or DELETE only.'});
  }catch(error){return res.status(502).json({error:error.message||'Memory request failed.'});}
};
