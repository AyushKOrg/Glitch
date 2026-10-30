# Glitch web edition: checklist

## Modes
- [x] Flash (default): fast chat, plus image / PDF-page viewing
- [x] Cognition: deeper reasoning and code, text only
- [x] Perception: removed (the bridge rejects it, the site has no button)
- [x] Each mode keeps its own chat history in the browser

## Tools
**Kept**
- [x] `web_search`
- [x] Documents: `list_folder`, `read_document`, `create_word_notes`
- [x] PDF / image viewing: `render_pdf_page`, `view_image`, `find_red_marks` (flash only)
- [x] Gmail: `search_emails`, `read_email`, `draft_email`, `send_email`
- [x] Sandboxed code files: `create_code_file`, `edit_code_file`, `run_code_file`

**Removed (not bound to the model and not runnable)**
- [x] PC: `open_app`, `open_file`, `open_url`, `type_text`, `press_key`, `open_in_vscode`
- [x] Screen / mouse: `take_screenshot`, `move_mouse`, `click_at`, `drag_to`, `scroll`
- [x] Browser: `browser_open`, `browser_click_text`, `browser_fill_field`, `browser_new_tab`, `browser_close`, `compose_gmail_draft`
- [x] YouTube: `search_youtube`, `get_video_transcript`

## Files
- [x] Upload: `+` button or drag-and-drop, up to 4 MB each (Vercel's limit)
- [x] Allowed: PDF, Word, text/markdown, common code files (py, js, json, csv, html, ...), images
- [x] Uploads land in `<read folder>/web_uploads/`, and Glitch is told the path so it can open them
- [x] Code generation: `create_code_file` output shows up in the **files** panel for download
- [x] Word notes (`notes/*.docx`) show up there too
- [x] Hidden folders (screenshots, image cache) are never listed or downloadable
- [x] Executables (.exe, .bat, ...) can't be uploaded

## Accounts
- [x] Sign in / create account screen (replaces the single access token)
- [x] Passwords hashed: HMAC pepper + scrypt with a per-user salt (never stored or logged in plain text)
- [x] Postgres storage (Neon recommended); tables created automatically
- [x] Server-side sessions in an HttpOnly + Secure + SameSite=Strict cookie, sign-out revokes them
- [x] Invite-only sign-up (`GLITCH_SIGNUP_CODE`); first account = admin
- [x] Brute-force lockout, CSRF header, same-time response for unknown users
- [x] History stored per account in the browser

## Branding
- [x] Logo = your `.ico` (header mark, favicon, iOS home-screen icon)
- [x] Accent colour changed to the logo's bronze

## Deploy
- [ ] PC: `GLITCH_BRIDGE_SECRET` in `.env`, `pip install fastapi uvicorn`, `python pc_bridge.py`
- [ ] PC: tunnel running (`cloudflared tunnel --url http://localhost:8787`)
- [ ] Database: Vercel → Storage → Neon (adds `DATABASE_URL`)
- [ ] Vercel env vars: `PASSWORD_PEPPER`, `GLITCH_SIGNUP_CODE`, `GLITCH_PC_URL`, `GLITCH_BRIDGE_SECRET`, optional `GOOGLE_API_KEY`
- [ ] `vercel --prod`, open the site, create YOUR account first (it becomes admin)
- [ ] Smoke test: attach a PDF and ask for a summary; ask for a small Python script, then download it from **files**

## Not done yet (your call)
- [ ] Per-user separation on the PC (all accounts share one Gmail, workspace and Files panel)
- [ ] Password reset / change-password (today: reset by editing the user in the database)
- [ ] Email verification (not needed while sign-up is invite-only)
- [ ] Files over 4 MB (Vercel's cap). Would need a different upload path, e.g. straight to the tunnel
- [ ] Real PDF *editing* (there is only reading plus Word notes output; there is no PDF-editing tool in the code)
