// Account + session logic.
//
// Passwords are HASHED, not encrypted. Encryption is reversible (whoever has the key
// can read every password); a hash can't be reversed, which is what you want.
// Each password goes through: HMAC-SHA256 with a server-side pepper -> scrypt with a
// random per-user salt. A stolen database alone is therefore not enough to crack them.
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./_db');

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };       // ~32 MB, ~100 ms per hash
const SESSION_DAYS = 7;
const COOKIE = 'glitch_session';
const MAX_FAILS_PER_USER = 5;      // per 15 minutes
const MAX_FAILS_PER_IP = 20;       // per 15 minutes

function pepper() {
  const p = process.env.PASSWORD_PEPPER;
  if (!p || p.length < 16) throw new Error('PASSWORD_PEPPER must be set (16+ random characters).');
  return p;
}

function prehash(password) {
  return crypto.createHmac('sha256', pepper()).update(password, 'utf8').digest();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(prehash(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, keyB64] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(prehash(password), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * Number(N) * Number(r) * 2,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Used when the username doesn't exist, so "no such user" costs the same time as "wrong password".
let dummyHash;
async function burnTime(password) {
  dummyHash = dummyHash || (await hashPassword('dummy-password-for-timing'));
  await verifyPassword(password, dummyHash);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function validUsername(u) {
  return typeof u === 'string' && /^[a-z0-9_.-]{3,32}$/.test(u);
}

function passwordProblem(password, username) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 10) return 'Password must be at least 10 characters.';
  if (password.length > 128) return 'Password must be at most 128 characters.';
  if (password.toLowerCase().includes(username)) return "Password can't contain your username.";
  return null;
}

function clientIp(req) {
  const h = req.headers;
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || '';
  return String(raw).trim().slice(0, 64) || 'unknown';
}

// ---- rate limiting -------------------------------------------------------
async function tooManyAttempts(username, ip) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE username = $1) AS by_user,
       COUNT(*) FILTER (WHERE ip = $2)       AS by_ip
     FROM auth_attempts WHERE at > now() - interval '15 minutes'`,
    [username, ip]
  );
  return Number(rows[0].by_user) >= MAX_FAILS_PER_USER || Number(rows[0].by_ip) >= MAX_FAILS_PER_IP;
}

async function recordFailure(username, ip) {
  await db.query('INSERT INTO auth_attempts (username, ip) VALUES ($1, $2)', [username, ip]);
  await db.query("DELETE FROM auth_attempts WHERE at < now() - interval '1 day'");
}

const clearFailures = (username) => db.query('DELETE FROM auth_attempts WHERE username = $1', [username]);

// ---- sessions ------------------------------------------------------------
function cookieString(value, maxAgeSeconds) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [sha256(token), userId, String(SESSION_DAYS)]
  );
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  res.setHeader('Set-Cookie', cookieString(token, SESSION_DAYS * 86400));
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', cookieString('', 0));
}

async function getUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  return rows[0] || null;
}

// For protected endpoints. Sends the error itself and returns null when not allowed.
async function requireUser(req, res) {
  try {
    // State-changing requests must carry a custom header: a cross-site form or image
    // can't add one, which backs up SameSite=Strict as CSRF protection.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-glitch-csrf'] !== '1') {
      res.status(403).json({ error: 'Missing CSRF header.' });
      return null;
    }
    const user = await getUser(req);
    if (!user) {
      res.status(401).json({ error: 'Please sign in.' });
      return null;
    }
    return user;
  } catch (e) {
    res.status(500).json({ error: `Auth backend error: ${e.message}` });
    return null;
  }
}

module.exports = {
  hashPassword, verifyPassword, burnTime, validUsername, passwordProblem, clientIp,
  tooManyAttempts, recordFailure, clearFailures,
  startSession, endSession, getUser, requireUser, readCookie,
};
