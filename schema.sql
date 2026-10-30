-- Reference only: the API creates these tables itself on first use.
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,        -- scrypt$N$r$p$salt$hash, never the password
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,        -- sha256 of the cookie value
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_attempts (
  id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL, ip TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Handy admin queries
--   SELECT username, role, created_at FROM users;
--   DELETE FROM users WHERE username = 'someone';           -- also signs them out
--   UPDATE users SET role = 'admin' WHERE username = 'me';
