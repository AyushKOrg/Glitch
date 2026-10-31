# Glitch on Vercel

```
Browser ──> Vercel: public/index.html + api/*  ──> Gemini (flash)  /  OpenRouter (cognition)
   │
   └──────> Supabase: sign-in (email + password) and file storage (uploads, files Glitch makes)
```

No PC, no tunnel, no bridge. Everything runs on Vercel and Supabase, so it works while
your computer is off.

## 1. Supabase (free tier is fine)

1. Create a project at supabase.com.
2. **SQL Editor → New query**: paste `supabase.sql` and run it. This creates a private
   `glitch-files` bucket and the rules that keep each user to their own folder.
3. **Authentication → Sign In / Providers → Email**: decide on **Confirm email**.
   - **Off**: people can sign in the moment they create an account.
   - **On**: users must click a link in an email first. Supabase's built-in mailer has rate limits.
4. **Authentication → Sign In / Providers → Anonymous Sign-Ins**: enable this to allow guest mode.
5. **Project Settings → API Keys**: copy only the Project URL and the public `anon` (publishable) key. Never add a service-role or secret key to this app.

## 2. Deploy

```
npm i -g vercel
cd glitch-vercel
vercel
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add GOOGLE_API_KEY          # flash mode + web search
vercel env add GEMINI_MODEL            # optional, default gemini-3.5-flash-lite
vercel env add OPENROUTER_API_KEY      # cognition mode
vercel env add OPENROUTER_MODEL        # e.g. the Nemotron model id you use on OpenRouter
vercel --prod
```

Or push the folder to GitHub, import it in the Vercel dashboard and add the same
variables under Settings → Environment Variables. **Redeploy after adding variables.**
`npm install` runs automatically (the PDF and Word readers).

Open the site and choose **Create account** or **Continue as guest**.

## What it does

| | |
|---|---|
| **Sign in / guest** | Supabase email + password or anonymous guest sessions. Sessions refresh automatically. |
| **Upload** | `+` or drag-and-drop, up to 25 MB each, straight from the browser into your private folder. PDF, Word, text/code, images. |
| **Download / delete** | **files** button: everything you uploaded and everything Glitch made. |
| **Glitch's tools** | `web_search`, `create_file` (writes code/text files for you), `read_file`, `list_files`. |
| **Flash** (Gemini) | Reads PDFs and images natively, including scans. |
| **Cognition** (OpenRouter) | Text only. PDFs and Word files are converted to text first; it can't see images. |

Not available on the web edition (they need your PC): running code, opening apps, mouse and screen
control, the browser, YouTube, Gmail, Word-notes output.

## ⚠ Read this about sign-ups

Anyone who finds the site can create an account, and every account can spend your Gemini and
OpenRouter credit and store files (Supabase free tier: 1 GB). Pick one:

- **`ALLOWED_EMAILS`**: set it to a comma-separated list (`me@gmail.com,friend@x.com`). Others can
  sign up but get an error when they chat. Redeploy after changing it.
- **Turn sign-ups off** in Supabase (Authentication → Sign In / Providers → turn off *Allow new users to sign up*)
  after you've made your accounts. This also stops them filling your storage.
- Or turn on **Vercel Authentication** under Deployment Protection to put a login in front of the whole site.

## How your files are kept private

- The bucket is private. Rules in `supabase.sql` only let you read, upload to and delete from the
  folder named after your own user id, and uploads only go in `uploads/` and only for allowed file types.
- Glitch's files are written using the current user's access token into `<your id>/generated/`.
- Storage Row Level Security checks that every read, upload, update and delete stays inside that user's folder. The server never receives a service-role key.

## Notes

- Chat history is stored in the browser (localStorage), per account and mode. Clearing site data erases it.
- A chat request has about 60 s on Vercel (`vercel.json`). Long tool chains time out.
- Not tested against a live Supabase project, only against a stand-in for its API.
