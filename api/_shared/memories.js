// Supabase-backed user memory reads.
const { supabaseUrl } = require('./supabase');
async function getUserMemories(user) {
  const url = `${supabaseUrl()}/rest/v1/glitch_memories?select=id,content,created_at&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`;
  const response = await fetch(url, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${user.accessToken}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Supabase memory read failed (${response.status}).`);
  return response.json();
}
module.exports = { getUserMemories };
