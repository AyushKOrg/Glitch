# Glitch web edition: checklist

## Done
- [x] Flash (Gemini) and cognition (OpenRouter) modes; each keeps its own chat history
- [x] Supabase email + password sign-in / create account (no sign-up code)
- [x] PC tunnel and bridge removed; runs entirely on Vercel + Supabase
- [x] Upload from the browser (PDF, Word, text/code, images; 25 MB) into a private per-user folder
- [x] Download and delete from the **files** panel (uploads and files Glitch made)
- [x] Glitch can write code/text files (`create_file`), read them back, list them, and search the web
- [x] Flash reads PDFs and images natively; cognition gets PDF/Word as extracted text
- [x] Logo = your `.ico`; layout works on phones
- [x] Optional `ALLOWED_EMAILS` allow-list

## Removed (needed the PC)
- [x] Running code, opening apps, mouse/screen, Selenium browser, YouTube, Gmail, Word-notes output

## Your steps
- [ ] Supabase: create project, run `supabase.sql`, decide on Confirm email
- [ ] Copy URL, anon key, service_role key
- [ ] Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (+ optional `GEMINI_MODEL`, `ALLOWED_EMAILS`)
- [ ] `vercel --prod`, create your account
- [ ] Decide sign-up policy: `ALLOWED_EMAILS`, or switch off sign-ups in Supabase
- [ ] Smoke test: upload a PDF and ask for a summary; ask for a small Python script, then download it

## Not done (your call)
- [ ] Chat history across devices (today it lives in each browser; could be a Supabase table)
- [ ] Running generated code (no safe place to run it on Vercel)
- [ ] Gmail / Word-notes output on the web
- [ ] Real PDF editing (reading only)
