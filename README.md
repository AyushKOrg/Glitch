# Glitch on Vercel

```
Browser ──> Vercel: public/index.html + api/*  ──> Postgres (accounts, sessions)
                         │  after sign-in, tries the PC first
                         ├──> Cloudflare Tunnel ──> pc_bridge.py ──> main.py (real Glitch + tools)
                         └──> if PC is off: Gemini plain chat (no tools)
```

Vercel is serverless, so it can't run mouse control, Selenium, voice or anything
else that needs your PC. Those stay on the PC; Vercel hosts the UI, the accounts
and a thin API.

## 1. Database

Vercel dashboard → your project → **Storage** → **Create** → **Neon** (free tier).
It adds `DATABASE_URL` to the project automatically. Any other Postgres works too:
paste its connection string into `DATABASE_URL`. No migration step; the tables
(`users`, `sessions`, `auth_attempts`) are created on first request (`schema.sql`
shows them).

## 2. PC side

1. Copy `pc_bridge.py` next to `main.py`.
2. `pip install fastapi uvicorn`
3. Add to your `.env`: `GLITCH_BRIDGE_SECRET=<long random string>`
4. `python pc_bridge.py` (listens on 127.0.0.1:8787)
5. `cloudflared tunnel --url http://localhost:8787`, then copy the
   `https://….trycloudflare.com` URL. (Quick tunnels change URL each restart;
   use a named tunnel for a fixed one.)

## 3. Deploy

```
npm i -g vercel
cd glitch-vercel
vercel
vercel env add PASSWORD_PEPPER         # 32+ random characters
vercel env add GLITCH_SIGNUP_CODE      # invite code
vercel env add GLITCH_PC_URL           # the tunnel URL
vercel env add GLITCH_BRIDGE_SECRET    # same value as on the PC
vercel env add GOOGLE_API_KEY          # optional fallback
vercel --prod
```

(`DATABASE_URL` is already there if you used the Neon integration.) Or push the
folder to GitHub, import it in the dashboard and add the same variables under
Settings → Environment Variables. Redeploy after adding variables.

Open the site → **Create account** → enter your sign-up code. **The first account
becomes the admin.** Create yours before sharing the code with anyone.

## How accounts work

- **Passwords are hashed, not encrypted.** Encryption can be reversed by whoever has
  the key; a hash can't. Each password goes through HMAC-SHA256 with `PASSWORD_PEPPER`
  (kept outside the database), then scrypt (N=32768, r=8, p=1) with its own random salt.
  A leaked database alone doesn't expose passwords. Neon also encrypts the data at
  rest, and connections use TLS.
- **Sessions:** a random token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie,
  valid 7 days. Only its SHA-256 is stored, so a database leak can't be used to log in.
  Sign-out deletes it server-side.
- **CSRF:** every state-changing request needs a custom header the browser won't add
  to cross-site requests, on top of `SameSite=Strict`.
- **Brute force:** 5 failed sign-ins per username or 20 per IP in 15 minutes locks that
  username/IP for the rest of the window. Unknown usernames take the same time as wrong passwords.
- **Passwords:** 10-128 characters, can't contain the username. Usernames: 3-32 of `a-z 0-9 . _ -`.
- Don't change `PASSWORD_PEPPER` after people have signed up, or nobody's password will match.

Manage users with SQL in the Neon console, for example:

```sql
SELECT username, role, created_at FROM users;
DELETE FROM users WHERE username = 'someone';      -- also ends their sessions
```

## Important: accounts share one Glitch

Every account talks to the same Glitch on your PC: the same Gmail, the same
`web_uploads/` folder, the same workspace and Files panel. Chat history is kept in each
person's own browser, but nothing on the PC is separated per user. Only give the
sign-up code to people you'd trust with your Glitch.

## Files

- **Upload:** `+` button or drag-and-drop. Files go to `<GLITCH_READ_ROOT>/web_uploads/`
  on the PC and Glitch opens them with its document/image tools.
- **Download:** anything Glitch writes into its code workspace (code files,
  `notes/*.docx`) appears under the **files** button.
- Both directions are capped at 4 MB, which is what a Vercel function accepts.

## Notes

- The web edition has two modes only: flash and cognition (see CHECKLIST.md for the
  exact tool list). PC, screen, browser and YouTube tools are removed.
- `maxDuration` is 60s in `vercel.json` (Hobby limit). Longer tool runs time out.
