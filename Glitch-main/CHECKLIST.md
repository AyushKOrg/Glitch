# Glitch web edition: checklist

## Current features
- [x] Flash (Gemini 3.5 Flash-Lite free tier) and Cognition (NVIDIA Nemotron 3 Ultra free)
- [x] Supabase email + password sign-in and anonymous guest sessions
- [x] Guest quota: 30 messages per guest account, enforced by atomic Supabase RPC
- [x] Web search tool available in both modes through Google Search grounding
- [x] Upload, download, file listing, file generation, and file-reading features removed
- [x] Browser layout remains mobile-friendly
- [x] Optional `ALLOWED_EMAILS` allow-list

## Setup / deployment
- [ ] Supabase: run the updated `supabase.sql`
- [ ] Supabase: enable Anonymous Sign-Ins if guests should be allowed
- [ ] Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY` (+ optional `ALLOWED_EMAILS`)
- [ ] Redeploy Vercel
- [ ] Smoke test: register/sign in, send messages in both modes, test web search
- [ ] Test guest quota reaches 0 after 30 successful guest requests and rejects the next request
- [ ] Confirm direct Storage access is denied by the removed Storage policies

## Notes
- The OpenRouter free endpoint has provider-side rate limits and availability constraints.
- Provider keys must remain server-side; never commit real keys.
- Old objects in the private Supabase Storage bucket are not automatically deleted by the migration.

- [ ] Verify Google Search is available in both Flash and Cognition; ask each mode for current news and confirm source URLs are included.


## Temporary local chat history (no memory feature)
- [x] Remove the My memory UI and memory prompt injection.
- [x] Email-account chat history is stored in this browser's localStorage, separately by user ID and mode.
- [x] Guest chat history is not persisted.
- [ ] Sign in with email account A, send messages in Flash and Cognition, and verify each mode restores its own history after refresh.
- [ ] Sign out and sign in as account B in the same browser; verify B sees a separate history.
- [ ] Verify history does not sync to another browser/device (temporary limitation).
- [ ] Verify New chat clears the current mode's local history.

## Chat history v2
- [x] One history per account (not per mode); each chat remembers its mode
- [x] New chat reuses an empty chat instead of piling up blanks
- [x] Search, date groups, inline rename, delete with Undo, cross-tab sync
- [x] Failed message stays in the chat with a Retry button; replies go to the chat they were sent from
- [x] Token refresh no longer resets the open chat
- [ ] Manually test with a real attached file (stored as a short marker, shown as a chip)

## Interface pass
- [x] Replies render markdown (headings, lists, bold/italic, links, code blocks) without parsing HTML
- [x] Copy button on replies and code blocks; plain code snippets are no longer shown as fake file downloads
- [x] Attachments shown as removable chips; total size budget; Send waits while a file is being read
- [x] Enter no longer sends while composing text with an input method (IME)
- [x] Clear messages for timeouts, offline, and oversized messages; long replies open at their start
- [ ] Manually check on a phone: sidebar, keyboard height (uses 100dvh), copy buttons
