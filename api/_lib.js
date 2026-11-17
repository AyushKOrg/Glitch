// Backwards-compatible shared Supabase service facade.
// Keep existing API routes importing ./_lib while implementation lives in focused modules.
module.exports = {
  ...require('./_shared/supabase'),
  ...require('./_shared/auth'),
  ...require('./_shared/guest-quota'),
  ...require('./_shared/memories'),
};
