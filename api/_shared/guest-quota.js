// Guest message quota RPCs. Supabase derives auth.uid() from the caller JWT.
const { supabaseUrl } = require('./supabase');

async function quotaRpc(user, rpc) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Supabase quota check failed (${response.status}).`);
  return response.json();
}

async function consumeGuestMessage(user) {
  return quotaRpc(user, 'consume_guest_message');
}

async function getGuestUsage(user) {
  return quotaRpc(user, 'get_guest_message_usage');
}

module.exports = { consumeGuestMessage, getGuestUsage };
