// Shared Supabase environment helpers.
function missingEnv() {
  return ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((key) => !process.env[key]);
}
const supabaseUrl = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
module.exports = { missingEnv, supabaseUrl };
