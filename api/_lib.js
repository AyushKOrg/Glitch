// Backwards-compatible shared Supabase service facade.
module.exports = { ...require('./_shared/supabase'), ...require('./_shared/auth'), ...require('./_shared/guest-quota'), ...require('./_shared/memories') };
