// Postgres access (Neon, Supabase, Vercel Postgres... anything that gives a DATABASE_URL).
// Tables are created on first use, so there is no separate migration step.
const { Pool } = require('pg');

let pool;
let schemaReady;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,                              // serverless: one connection per instance
      idleTimeoutMillis: 10000,
      ssl: local ? false : { rejectUnauthorized: true },
    });
  }
  return pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_attempts (
  id       BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  ip       TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_attempts_at_idx ON auth_attempts(at);
`;

async function query(text, params) {
  const p = getPool();
  if (!schemaReady) {
    schemaReady = p.query(SCHEMA).catch((e) => { schemaReady = null; throw e; });
  }
  await schemaReady;
  return p.query(text, params);
}

module.exports = { query, SCHEMA };
