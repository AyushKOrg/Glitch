(async () => {
  const $ = (id) => document.getElementById(id);
  const sideCollapseButton = $('sideCollapse');
  let sidebarCollapsed = false;
  try { sidebarCollapsed = localStorage.getItem('glitch_sidebar_collapsed') === '1' && window.matchMedia('(min-width: 761px)').matches; } catch {}
  function setSidebarCollapsed(collapsed) {
    sidebarCollapsed = !!collapsed && window.matchMedia('(min-width: 761px)').matches;
    document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    sideCollapseButton.setAttribute('aria-pressed', String(sidebarCollapsed));
    sideCollapseButton.setAttribute('aria-label', sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
    sideCollapseButton.title = sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    try { localStorage.setItem('glitch_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); } catch {}
  }
  setSidebarCollapsed(sidebarCollapsed);
  sideCollapseButton.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
  window.addEventListener('resize', () => { if (window.innerWidth <= 760 && sidebarCollapsed) setSidebarCollapsed(false); });
  const log = $('log'), input = $('input'), sendBtn = $('send');

  // Add an accessible show/hide control to every password input.
  document.querySelectorAll('input[type="password"]').forEach(field => {
    if(field.parentElement&&field.parentElement.classList.contains('password-field'))return;
    const wrap=document.createElement('div');wrap.className='password-field';field.parentNode.insertBefore(wrap,field);wrap.appendChild(field);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='password-visibility';toggle.setAttribute('aria-label','Show password');toggle.setAttribute('aria-pressed','false');toggle.title='Show password';
    const eye='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    const hiddenEye='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 0 0 4-.8"/></svg>';
    toggle.innerHTML=eye;toggle.addEventListener('click',()=>{const show=field.type==='password';field.type=show?'text':'password';toggle.innerHTML=show?hiddenEye:eye;toggle.setAttribute('aria-pressed',String(show));toggle.setAttribute('aria-label',show?'Hide password':'Show password');toggle.title=show?'Hide password':'Show password';field.focus();});wrap.appendChild(toggle);
  });

  // ---- interface sound effects ---------------------------------
  let soundOn = true, audioCtx = null;
  try { soundOn = localStorage.getItem('glitch_sfx') !== 'off'; } catch {}
  const soundButton = $('soundToggle'), soundLabel = $('soundLabel');
  function syncSoundButton() { soundButton.setAttribute('aria-pressed', String(soundOn)); soundLabel.textContent = 'Sound effects: ' + (soundOn ? 'on' : 'off'); }
  async function playSfx(kind = 'tap') {
    if (!soundOn) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state !== 'running') await audioCtx.resume();
      if (audioCtx.state !== 'running') return;
      const now = audioCtx.currentTime, osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      const presets = vipSoundPack === 'arcade'
        ? { tap:[620,980,.055], send:[340,880,.12], reply:[520,1040,.16], toggle:[440,740,.08] }
        : vipSoundPack === 'soft'
          ? { tap:[440,520,.07], send:[360,540,.11], reply:[520,660,.16], toggle:[330,440,.09] }
          : { tap:[520,660,.045], send:[420,760,.095], reply:[620,880,.12], toggle:[360,520,.065] };
      const [from,to,duration] = presets[kind] || presets.tap;
      osc.type = vipSoundPack === 'arcade' ? 'triangle' : 'sine'; osc.frequency.setValueAtTime(from, now); osc.frequency.exponentialRampToValueAtTime(to, now + duration);
      gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(kind === 'reply' ? .035 : .022, now + .012); gain.gain.exponentialRampToValueAtTime(.0001, now + duration + .035);
      osc.connect(gain); gain.connect(audioCtx.destination); osc.start(now); osc.stop(now + duration + .04);
    } catch {}
  }
  syncSoundButton();
  soundButton.addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('glitch_sfx', soundOn ? 'on' : 'off'); } catch {} syncSoundButton(); if (soundOn) playSfx('toggle'); });
  let attachedFiles = [];
  const MAX_FILE_BYTES = 8 * 1024 * 1024, MAX_EXTRACTED_CHARS = 24000;
  const MODES = ['flash', 'cognition'];
  const MODE_KEY = 'glitch_mode';

  let mode = 'flash';
  try { const m = localStorage.getItem(MODE_KEY); if (MODES.includes(m)) mode = m; } catch {}
  let user = null;                                              // {id, email} when signed in
  let vipActive = false, vipPersonality = 'default', vipSoundPack = 'classic';
  let history = [];                                             // [{role, content}]
  let conversations = [];
  let activeChatId = null;
  let busy = false;
  let sb = null;
  let authInitError = 'Supabase is still initializing. Please try again in a moment.';

  // ---- chats & history ----------------------------------------------------------
  // One history list per account (not per mode); each chat remembers its mode. Email accounts are saved in
  // localStorage; guests use sessionStorage (lost when the tab closes). Storage is browser-local only.
  const STORE_V = 'glitch_chats_v2_';
  const MAX_CHATS = 60, MAX_STORED_MSGS = 40, MAX_STORED_CHARS = 12000;
  const storeKey = () => STORE_V + (user ? user.id : 'anon');
  const store = () => (canPersistChats() ? localStorage : sessionStorage);
  const canPersistChats = () => Boolean(user && !user.isAnonymous && user.email);
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const makeChat = () => ({ id: newId(), title: 'New chat', messages: [], updatedAt: Date.now(), mode });
  const activeChat = () => conversations.find(c => c.id === activeChatId);
  let pending = null;            // {chatId, el} while a reply is in flight
  let histFilter = '';
  let undo = null;               // {chat, index, timer} for the last deleted chat

  // Attached files are huge; store a short marker instead (the active microphone session keeps the full text).
  const FILE_RE = /\n*--- Attached file: (.*?) ---\n[\s\S]*?\n--- End file ---/g;
  const compact = (t) => String(t).replace(FILE_RE, (_, n) => '\n[Attached file: ' + n + ']').slice(0, 60000);
  const titleFrom = (t) => compact(t).replace(/\[Attached file: .*?\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 42);

  function sanitize(list) {
    return (Array.isArray(list) ? list : []).filter(c => c && typeof c.id === 'string' && Array.isArray(c.messages)).map(c => ({
      id: c.id, title: String(c.title || 'New chat').slice(0, 60), updatedAt: Number(c.updatedAt) || Date.now(),
      mode: MODES.includes(c.mode) ? c.mode : 'flash',
      messages: c.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-MAX_STORED_MSGS).map(m => ({ role: m.role, content: m.content }))
    })).sort((x, y) => y.updatedAt - x.updatedAt).slice(0, MAX_CHATS);
  }
  function writeStore() {
    // Empty chats other than the open one are not worth saving. Shrink on quota errors instead of failing silently.
    let list = conversations.filter(c => c.messages.length || c.id === activeChatId).slice(0, MAX_CHATS)
      .map(c => ({ ...c, messages: c.messages.slice(-MAX_STORED_MSGS).map(m => ({ role: m.role, content: compact(m.content) })) }));
    for (let guard = 0; guard < 80; guard++) {
      try { store().setItem(storeKey(), JSON.stringify(list)); return; }
      catch (e) { if (list.length <= 1) break; list = list.slice(0, -1); }
    }
    showToast('Storage is full, so this chat may not be saved after a refresh.');
  }
  function persistChats() { if (user) writeStore(); renderHistoryList(); }

  // Bring the current in-memory history up to date with what the chat object holds.
  function syncActiveFromHistory() {
    const chat = activeChat(); if (!chat) return;
    chat.messages = history.map(m => ({ role: m.role, content: m.content }));
    chat.mode = mode;
    const firstUser = chat.messages.find(m => m.role === 'user');
    if (firstUser && (!chat.title || chat.title === 'New chat')) chat.title = titleFrom(firstUser.content) || 'New chat';
  }
  function saveHistory(touch = true) {
    const chat = activeChat();
    if (chat) { syncActiveFromHistory(); if (touch) { chat.updatedAt = Date.now(); conversations = [chat, ...conversations.filter(c => c.id !== chat.id)]; } }
    persistChats();
  }
  function openChat(id, quiet) {
    const chat = conversations.find(c => c.id === id); if (!chat) return;
    if (activeChatId && activeChatId !== id) syncActiveFromHistory();
    activeChatId = id; history = chat.messages.map(m => ({ ...m }));
    if (chat.messages.length && MODES.includes(chat.mode) && chat.mode !== mode) { mode = chat.mode; try { localStorage.setItem(MODE_KEY, mode); } catch {} markMode(); }
    render(); renderHistoryList(); if (!quiet) { document.body.classList.remove('nav-open'); input.focus(); }
  }
  function loadHistory() {
    history = []; conversations = []; activeChatId = null;
    if (user) {
      try { conversations = sanitize(JSON.parse(store().getItem(storeKey()) || 'null')); } catch {}
      // One-time migration of the old per-mode storage (glitch_chats_<uid>_<mode>), without deleting it.
      if (canPersistChats() && !conversations.length) {
        for (const m of MODES) {
          try { conversations = conversations.concat(sanitize(JSON.parse(localStorage.getItem('glitch_chats_' + user.id + '_' + m) || 'null')).map(c => ({ ...c, mode: m }))); } catch {}
        }
        conversations = conversations.sort((x, y) => y.updatedAt - x.updatedAt).slice(0, MAX_CHATS);
      }
    }
    // Always land on a fresh empty chat, like other chat apps; old chats stay in the list.
    const fresh = makeChat(); conversations.unshift(fresh); activeChatId = fresh.id;
    persistChats();
  }

  // ---- history sidebar ----------------------------------------------------------
  function groupOf(ts) {
    const d = new Date(ts), now = new Date(), day = 86400000;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= start) return 'Today';
    if (ts >= start - day) return 'Yesterday';
    if (ts >= start - 7 * day) return 'Previous 7 days';
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  function note(list, text) { const n = document.createElement('div'); n.className = 'history-empty'; n.textContent = text; list.appendChild(n); }
  function renderHistoryList() {
    const list = $('historyList'); if (!list) return;
    list.textContent = '';
    $('histSearchWrap').hidden = !user;
    if (!user) { note(list, 'Sign in to see your chats'); return; }
    const q = histFilter.trim().toLowerCase();
    const shown = conversations.filter(c => (c.messages.length || c.id === activeChatId) &&
      (!q || c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q))));
    if (!shown.length) note(list, q ? 'No chats match your search' : 'No chats yet');
    let lastGroup = '';
    shown.forEach(chat => {
      const g = groupOf(chat.updatedAt);
      if (g !== lastGroup && chat.messages.length) { const h = document.createElement('div'); h.className = 'history-group'; h.textContent = g; list.appendChild(h); lastGroup = g; }
      list.appendChild(chatRow(chat));
    });
    if (!canPersistChats()) note(list, 'Guest chats are not saved after you close this tab. Sign in with email to keep them.');
  }
  function chatRow(chat) {
    const row = document.createElement('div'); row.className = 'history-item' + (chat.id === activeChatId ? ' active' : '');
    const open = document.createElement('button'); open.type = 'button'; open.className = 'history-open';
    open.textContent = chat.title || 'New chat'; open.title = chat.title || 'New chat';
    if (chat.id === activeChatId) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => { if (chat.id !== activeChatId) openChat(chat.id); else document.body.classList.remove('nav-open'); });
    const rename = actionBtn('✎', 'Rename chat', () => startRename(chat, row, open));
    const del = actionBtn('×', 'Delete chat', () => deleteChat(chat.id));
    const actions = document.createElement('span'); actions.className = 'history-actions'; actions.append(rename, del);
    row.append(open, actions); return row;
  }
  function actionBtn(label, title, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'history-action'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b;
  }
  function startRename(chat, row, openBtn) {
    const field = document.createElement('input'); field.className = 'history-rename'; field.value = chat.title; field.maxLength = 60; field.setAttribute('aria-label', 'Chat name');
    let done = false;
    const finish = (save) => { if (done) return; done = true; const v = field.value.trim().slice(0, 60); if (save && v) { chat.title = v; persistChats(); } else renderHistoryList(); };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); });
    field.addEventListener('blur', () => finish(true));
    row.replaceChild(field, openBtn); field.focus(); field.select();
  }
  function deleteChat(id) {
    const index = conversations.findIndex(c => c.id === id); if (index < 0) return;
    if (pending && pending.chatId === id) { showToast('Wait for the reply to finish before deleting this chat.'); return; }
    const [chat] = conversations.splice(index, 1);
    if (undo) clearTimeout(undo.timer);
    undo = { chat, index, timer: setTimeout(() => { undo = null; }, 6000) };
    if (activeChatId === id) {
      const next = conversations.find(c => c.messages.length);
      if (next) { activeChatId = null; openChat(next.id, true); }
      else { const fresh = makeChat(); conversations.unshift(fresh); activeChatId = fresh.id; history = []; render(); }
    }
    persistChats();
    showToast('Chat deleted', 'Undo', () => {
      if (!undo || undo.chat.id !== chat.id) return;
      conversations.splice(Math.min(undo.index, conversations.length), 0, undo.chat); clearTimeout(undo.timer); undo = null;
      persistChats(); openChat(chat.id, true);
    });
  }
  function startNewChat() {
    document.body.classList.remove('nav-open');
    const cur = activeChat();
    // Already on an empty chat: don't pile up blank entries.
    if (cur && !history.length && !(pending && pending.chatId === cur.id)) { histFilter = ''; $('histSearch').value = ''; renderHistoryList(); input.focus(); return; }
    syncActiveFromHistory();
    const chat = makeChat(); conversations.unshift(chat); activeChatId = chat.id; history = [];
    histFilter = ''; $('histSearch').value = '';
    persistChats(); render(); input.focus();
  }

  // ---- toast ---------------------------------------------------------------------
  let toastTimer = null;
  function showToast(text, actionLabel, action) {
    const t = $('toast'); t.textContent = ''; const span = document.createElement('span'); span.textContent = text; t.appendChild(span);
    if (actionLabel) { const b = document.createElement('button'); b.type = 'button'; b.textContent = actionLabel; b.addEventListener('click', () => { t.classList.remove('show'); action(); }); t.appendChild(b); }
    t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 6000);
  }
  // Keep other tabs in sync: the other tab's write is the newest state, so adopt it.
  window.addEventListener('storage', (e) => {
    if (!user || e.key !== storeKey() || e.storageArea !== store()) return;
    try {
      const incoming = sanitize(JSON.parse(e.newValue || 'null')), mine = activeChat();
      const keepMine = mine && (pending || history.length) && !incoming.some(c => c.id === mine.id);
      conversations = keepMine ? [mine, ...incoming] : incoming;
      if (!conversations.some(c => c.id === activeChatId)) { const c = conversations.find(x => x.messages.length); if (c && !pending) openChat(c.id, true); else if (!conversations.length) { const f = makeChat(); conversations = [f]; activeChatId = f.id; history = []; render(); } }
      renderHistoryList();
    } catch {}
  });

  // ---- safe markdown: built with DOM nodes, so model text is never parsed as HTML ----------------
  const INLINE_SRC = '(`[^`\\n]+`)|(\\*\\*(?!\\s)[^*\\n]+?(?<!\\s)\\*\\*)|(\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^\\s)]+\\))|(https?:\\/\\/[^\\s<>()]*[^\\s<>().,;:!?\'"*])|(\\*(?!\\s)[^*\\n]+?(?<!\\s)\\*)';
  function mdLink(url, label) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = label; return a; }
  function inline(parent, text) {
    const re = new RegExp(INLINE_SRC, 'g'); let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const tok = m[0];
      if (m[1]) { const c = document.createElement('code'); c.textContent = tok.slice(1, -1); parent.append(c); }
      else if (m[2]) { const b = document.createElement('strong'); inline(b, tok.slice(2, -2)); parent.append(b); }
      else if (m[3]) { const mm = tok.match(/^\[([^\]]+)\]\((.+)\)$/); parent.append(mdLink(mm[2], mm[1])); }
      else if (m[4]) parent.append(mdLink(tok, tok));
      else { const i = document.createElement('em'); inline(i, tok.slice(1, -1)); parent.append(i); }
      last = m.index + tok.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }
  async function copyText(t, btn) {
    try { await navigator.clipboard.writeText(t); }
    catch { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); }
    if (btn) { const old = btn.dataset.label || btn.textContent; btn.dataset.label = old; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = old; }, 1400); }
  }
  const KW = 'abstract|and|as|async|await|break|case|catch|class|const|continue|def|default|del|do|elif|else|enum|except|export|extends|false|final|finally|fn|for|from|func|function|if|implements|import|in|interface|is|lambda|let|match|new|none|not|null|of|or|pass|private|public|raise|return|self|static|struct|super|switch|this|throw|true|try|type|undefined|use|var|void|while|with|yield';
  function highlight(code, lang) {
    const frag = document.createDocumentFragment();
    if (code.length > 20000) { frag.append(code); return frag; }
    const hash = /^(py|python|sh|bash|shell|zsh|yaml|yml|rb|ruby|toml|r|ps1|dockerfile|makefile|)$/i.test(lang || '');
    const re = new RegExp('(' + (hash ? '#[^\\n]*|' : '') + '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|--[^\\n]*)|("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b(' + KW + ')\\b|\\b([A-Za-z_]\\w*)(?=\\()', 'gi');
    let last = 0, m;
    while ((m = re.exec(code))) {
      if (m.index > last) frag.append(code.slice(last, m.index));
      const s = document.createElement('span');
      s.className = m[1] ? 'tk-c' : m[2] ? 'tk-s' : m[3] ? 'tk-n' : m[4] ? 'tk-k' : 'tk-f';
      s.textContent = m[0]; frag.append(s); last = re.lastIndex;
    }
    if (last < code.length) frag.append(code.slice(last));
    return frag;
  }
  function codeBlock(code, lang) {
    const box = document.createElement('section'); box.className = 'md-code';
    const head = document.createElement('div'); head.className = 'md-code-head';
    const label = document.createElement('span'); label.textContent = lang || 'code';
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Copy'; btn.addEventListener('click', () => copyText(code, btn));
    head.append(label, btn);
    const pre = document.createElement('pre'), c = document.createElement('code'); c.appendChild(highlight(code, lang)); pre.appendChild(c);
    box.append(head, pre); return box;
  }
  function renderMarkdown(parent, text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n'); let i = 0, para = [], m;
    const LI = /^\s*([-*+]|\d+[.)])\s+(.*)$/, QUOTE = /^\s*>\s?/;
    const flush = () => { if (!para.length) return; const p = document.createElement('p'); para.forEach((ln, k) => { if (k) p.append(document.createElement('br')); inline(p, ln); }); parent.append(p); para = []; };
    while (i < lines.length) {
      const line = lines[i];
      if ((m = line.match(/^\s*```\s*([\w+#.-]*)/))) { flush(); const buf = []; i++; while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]); i++; parent.append(codeBlock(buf.join('\n'), m[1])); continue; }
      if (!line.trim()) { flush(); i++; continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); const h = document.createElement('h' + (m[1].length + 2)); inline(h, m[2]); parent.append(h); i++; continue; }
      if (/^\s*([-*_]\s*){3,}$/.test(line)) { flush(); parent.append(document.createElement('hr')); i++; continue; }
      if (QUOTE.test(line)) { flush(); const q = document.createElement('blockquote'), buf = []; while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(QUOTE, '')); inline(q, buf.join(' ')); parent.append(q); continue; }
      if (LI.test(line)) { flush(); const list = document.createElement(/\d/.test(line.match(LI)[1]) ? 'ol' : 'ul'); while (i < lines.length && (m = lines[i].match(LI))) { const li = document.createElement('li'); inline(li, m[2]); list.append(li); i++; } parent.append(list); continue; }
      para.push(line); i++;
    }
    flush();
  }

  const LANG_EXT = { javascript:'js', js:'js', typescript:'ts', ts:'ts', tsx:'tsx', jsx:'jsx', python:'py', py:'py', html:'html', css:'css', json:'json', jsonc:'json', bash:'sh', sh:'sh', shell:'sh', java:'java', c:'c', cpp:'cpp', csharp:'cs', csharp:'cs', go:'go', rust:'rs', ruby:'rb', php:'php', sql:'sql', yaml:'yml', yml:'yml', markdown:'md', md:'md', xml:'xml', text:'txt', plaintext:'txt', toml:'toml', kotlin:'kt', swift:'swift', powershell:'ps1', r:'r', vue:'vue', svelte:'svelte' };
  function safeFilename(name, fallback) {
    let clean = String(name || '').trim().replace(/^['"`]|['"`]$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^\.+/, '');
    if (!clean || clean.length > 120 || !clean.includes('.')) clean = fallback;
    return clean;
  }
  function findArtifacts(text) {
    const artifacts = [];
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    let match, index = 0;
    while ((match = re.exec(text))) {
      const header = match[1].trim();
      const filenameMatch = header.match(/(?:filename|file)\s*=\s*([^\s]+)/i) || header.match(/(?:^|\s)([a-zA-Z0-9_.-]+\.(?:py|js|ts|tsx|jsx|html|css|json|md|txt|java|c|cpp|h|hpp|cs|go|rs|rb|php|sql|sh|yml|yaml|xml|toml|kt|swift|vue|svelte|ipynb|csv|svg|env|dockerfile))\b/i);
      const lang = (header.split(/\s+/)[0] || '').toLowerCase();
      const code = match[2].replace(/^\n+|\n+$/g, '');
      const explicit = filenameMatch ? filenameMatch[1].replace(/^['"`]|['"`]$/g, '') : '';
      if (!explicit) continue;                 // plain snippets stay normal code blocks (with Copy), not fake downloads
      const filename = safeFilename(explicit, `generated-${++index}.${LANG_EXT[lang] || 'txt'}`);
      artifacts.push({ start: match.index, end: re.lastIndex, raw: match[0], filename, code, lang });
    }
    return artifacts;
  }
  function downloadArtifact(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = safeFilename(filename, 'generated-file.txt');
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderBotContent(el, text) {
    const imageMatch = String(text).match(/\[\[GLITCH_IMAGE:(https:\/\/media\.pollinations\.ai\/[^\]\s]+|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)\]\]/);
    const visibleText = imageMatch ? String(text).replace(imageMatch[0], '').trim() : text;
    if (imageMatch) {
      if (visibleText) { const body = document.createElement('div'); body.className = 'md'; renderMarkdown(body, visibleText); el.appendChild(body); }
      const figure = document.createElement('figure'); figure.style.cssText = 'margin:14px 0 4px;max-width:min(100%,680px)';
      const img = document.createElement('img'); img.src = imageMatch[1]; img.alt = 'Image generated by Glitch'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.style.cssText = 'display:block;width:100%;height:auto;border-radius:16px;border:1px solid var(--border)';
      const link = document.createElement('a'); link.href = imageMatch[1]; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open full-size image'; link.style.cssText = 'display:inline-block;margin-top:8px;font-size:.82rem';
      figure.append(img, link); el.appendChild(figure); return;
    }
    const artifacts = findArtifacts(text);
    if (!artifacts.length) { const body = document.createElement('div'); body.className = 'md'; renderMarkdown(body, text); el.appendChild(body); return; }
    let cursor = 0;
    const all = [];
    artifacts.forEach((a) => {
      if (a.start > cursor) { const before = text.slice(cursor, a.start); if (before) { const p = document.createElement('div'); p.className = 'md'; renderMarkdown(p, before); el.appendChild(p); } }
      const card = document.createElement('section'); card.className = 'code-artifact' + (/\.(txt|md)$/i.test(a.filename) ? ' doc-artifact' : '');
      const head = document.createElement('div'); head.className = 'code-artifact-head';
      const name = document.createElement('span'); name.className = 'code-artifact-name'; name.textContent = '📄 ' + a.filename;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'code-download'; button.textContent = 'Download file';
      button.addEventListener('click', () => downloadArtifact(a.filename, a.code));
      head.append(name, button);
      const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = a.code; pre.appendChild(code);
      card.append(head, pre); el.appendChild(card);
      all.push(a); cursor = a.end;
    });
    const after = text.slice(cursor); if (after.trim()) { const p = document.createElement('div'); p.className = 'md'; renderMarkdown(p, after); el.appendChild(p); }
    if (all.length > 1) {
      const note = document.createElement('div'); note.className = 'tag'; note.textContent = all.length + ' downloadable files generated. Use each Download file button.'; el.appendChild(note);
    }
  }
  // ---- voice: speech-to-text (mic) and text-to-speech (spoken replies), all in the browser ----------
  // ---- voice: explicit push-to-talk and optional spoken replies; no continuous listening ----
  const Voice = (() => {
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition,synth=window.speechSynthesis||null;
    const canListen=Boolean(SR),canSpeak=Boolean(synth&&window.SpeechSynthesisUtterance),KEY_SPEAK='glitch_voice_speak';
    const get=k=>{try{return localStorage.getItem(k)==='1';}catch{return false;}},put=(k,v)=>{try{localStorage.setItem(k,v?'1':'0');}catch{}};
    let speakOn=canSpeak&&get(KEY_SPEAK),rec=null,listening=false,transcript='',baseText='',speakingBtn=null,token=0,voices=[];
    const mic=$('mic');function loadVoices(){voices=synth?synth.getVoices()||[]:[];}
    function paint(){$('speakToggle').setAttribute('aria-pressed',String(speakOn));$('speakLabel').textContent='Spoken replies: '+(speakOn?'on':'off');mic.classList.toggle('listening',listening);mic.setAttribute('aria-pressed',String(listening));mic.title=listening?'Listening… click to stop':'Speak (click to start)';}
    function speakable(text){return String(text||'').replace(/\[\[GLITCH_IMAGE:[\s\S]*?\]\]/g,' image generated ').replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g,' (code is on screen) ').replace(/\n+\s*(sources?|references?)\s*:?[\s\S]*$/i,'').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/\x60([^\x60]*)\x60/g,'$1').replace(/^\s{0,3}#{1,6}\s*/gm,'').replace(/^\s*[-*+]\s+/gm,'').replace(/^\s*\d+[.)]\s+/gm,'').replace(/[*_~>|]+/g,'').replace(/\s+/g,' ').trim().slice(0,2400);}
    function pickVoice(){if(!voices.length)loadVoices();const lang=(navigator.language||'en-US').toLowerCase(),same=voices.filter(v=>v.lang&&v.lang.toLowerCase().startsWith(lang.slice(0,2)));return same.find(v=>/natural|neural|online/i.test(v.name))||same.find(v=>v.default)||same[0]||voices.find(v=>v.default)||voices[0]||null;}
    function chunks(text){const parts=text.match(/[^.!?\n]+[.!?]*\s*/g)||[text],out=[];let cur='';for(const p of parts){if((cur+p).length>200&&cur){out.push(cur);cur=p;}else cur+=p;}if(cur.trim())out.push(cur);return out;}
    function stopSpeaking(){token++;if(synth){synth.cancel();try{synth.resume();}catch{}}if(speakingBtn){speakingBtn.textContent='Listen';speakingBtn=null;}}
    function speak(text,btn){if(!canSpeak)return;const cleanText=speakable(text);if(!cleanText)return;stopSpeaking();const mine=token,parts=chunks(cleanText),voice=pickVoice();if(btn){btn.textContent='Stop';speakingBtn=btn;}let index=0;const next=()=>{if(mine!==token)return;if(index>=parts.length){if(speakingBtn===btn&&btn){btn.textContent='Listen';speakingBtn=null;}return;}const utterance=new SpeechSynthesisUtterance(parts[index++]);utterance.lang=voice&&voice.lang?voice.lang:(navigator.language||'en-US');if(voice)utterance.voice=voice;utterance.pitch=1.04;utterance.rate=1.02;utterance.volume=1;utterance.onend=()=>{if(mine===token)next();};utterance.onerror=event=>{if(mine!==token||event&&['canceled','interrupted'].includes(event.error))return;next();};try{synth.resume();synth.speak(utterance);}catch{if(speakingBtn===btn&&btn){btn.textContent='Listen';speakingBtn=null;}showToast('Spoken replies are unavailable in this browser.');}};next();}
    function toggleSpeak(text,btn){if(speakingBtn===btn)stopSpeaking();else speak(text,btn);}
    function stopListening(){if(rec&&listening){try{rec.stop();}catch{}}else{listening=false;paint();}}
    function startListening(){if(!canListen||listening||busy||!user)return;stopSpeaking();rec=new SR();rec.lang=navigator.language||'en-US';rec.interimResults=true;rec.continuous=false;rec.maxAlternatives=3;transcript='';baseText=input.value?input.value.trim()+' ':'';let failed=false;rec.onresult=e=>{let value='';for(let i=0;i<e.results.length;i++)value+=e.results[i][0].transcript;transcript=value.trim();input.value=baseText+transcript;input.dispatchEvent(new Event('input'));};rec.onerror=e=>{if(e.error==='no-speech'||e.error==='aborted')return;failed=true;showToast(e.error==='not-allowed'||e.error==='service-not-allowed'?'Microphone blocked. Allow it in your browser site settings.':e.error==='audio-capture'?'I can’t find a microphone.':'Voice input failed ('+e.error+').');};rec.onend=()=>{listening=false;paint();if(!failed&&transcript.trim())$('chat').requestSubmit();};try{rec.start();listening=true;paint();}catch{listening=false;paint();}}
    mic.hidden=!canListen;if(!canSpeak)$('speakToggle').hidden=true;mic.addEventListener('click',()=>{if(listening)stopListening();else startListening();});
    $('speakToggle').addEventListener('click',()=>{speakOn=!speakOn;put(KEY_SPEAK,speakOn);if(!speakOn)stopSpeaking();paint();if(speakOn){synth.resume();speak('Spoken replies are on.',null);}});
    if(synth){loadVoices();synth.onvoiceschanged=loadVoices;}window.addEventListener('pagehide',()=>{stopSpeaking();stopListening();});paint();
    return {canSpeak,toggleSpeak,stop:stopSpeaking,onReply(text){if(speakOn)speak(text,null);},onSend(){stopSpeaking();if(listening)stopListening();},onFailed(){}};
  })();


  function refreshContextPanel(){const list=$('contextList'),summary=$('contextSummary');if(!list||!summary)return;const rows=history.slice(-40);summary.textContent=rows.length+' messages in this conversation are available (up to 40), plus '+memoryItems.length+' saved memories.';list.textContent='';if(!rows.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent='Start chatting and this panel will show the context Glitch can refer to.';list.appendChild(empty);return;}rows.forEach(m=>{const row=document.createElement('div');row.className='context-row '+(m.role==='user'?'context-user':'context-assistant');const label=document.createElement('strong');label.textContent=m.role==='user'?'You':'Glitch';const body=document.createElement('p');body.textContent=String(m.content||'').slice(0,700);row.append(label,body);list.appendChild(row);});}
  $('contextOpen').addEventListener('click',async()=>{$('contextModal').classList.add('open');refreshContextPanel();if(user){try{await loadMemories();refreshContextPanel();}catch{}}});
  $('contextClose').addEventListener('click',()=>$('contextModal').classList.remove('open'));
  $('contextModal').addEventListener('click',e=>{if(e.target===$('contextModal'))$('contextModal').classList.remove('open');});

  // ---- invite-only VIP -------------------------------------------------------
  const VIP_PREF_KEY = 'glitch_vip_prefs_';
  let vipDeveloper = false;
  function vipPrefsKey(){ return VIP_PREF_KEY + (user ? user.id : 'signedout'); }
  function syncAccountBadge(){
    const badge=$('accountBadge');
    if(badge){const role=vipDeveloper?'DEV':vipActive?'VIP':'FREE';badge.textContent=role;badge.className='account-pill '+role.toLowerCase();badge.hidden=!user;}
    const devButton=$('devSettingsOpen');if(devButton)devButton.hidden=!vipDeveloper;
    $('vipDeveloperTools').hidden=!vipDeveloper;
  }
  function setVipState(active){
    vipActive = Boolean(active);
    // VIP-only tools stay hidden until the server confirms membership.
    ['openImageStudio','openImageEditor'].forEach(id=>{const button=$(id);if(button){button.hidden=false;button.setAttribute('aria-disabled',String(!vipActive));}});
    document.body.classList.toggle('vip-active', vipActive);
    syncAccountBadge();
    $('vipTaglineDisplay').hidden = !vipActive || vipDeveloper;
    $('vipLock').hidden = vipActive;
    $('vipUnlocked').hidden = !vipActive;
    document.querySelectorAll('.tool-lock-label').forEach(el=>{el.textContent=vipActive?'UNLOCKED':'VIP';});
    if(!vipActive){ document.body.classList.remove('vip-stars','vip-neon','vip-orbit'); vipPersonality='default'; }
    else applyVipPrefs(false);
  }
  async function refreshVip(){
    if(!user || user.isAnonymous){setVipState(false);return;}
    const r=await api('/api/vip');
    if(!r.ok) throw new Error(r.data.error||'Could not check VIP status.');
    vipDeveloper = r.data.developer === true;
    setVipState(r.data.vip===true);
  }
  function applyVipPrefs(showToastMessage=false){
    if(!vipActive)return;
    let p={};try{p=JSON.parse(localStorage.getItem(vipPrefsKey())||'{}')}catch{}
    const theme=['gold','obsidian','cosmic','aurora'].includes(p.theme)?p.theme:'gold';
    const effect=['stars','neon','orbit','none'].includes(p.effect)?p.effect:'stars';
    vipPersonality=['default','witty','mentor','coder','chill'].includes(p.personality)?p.personality:'default';
    vipSoundPack=['classic','soft','arcade'].includes(p.sound)?p.sound:'classic';
    document.documentElement.dataset.theme=theme;
    try{localStorage.setItem('glitch_theme',theme);localStorage.removeItem('glitch_accent')}catch{}
    document.body.classList.toggle('vip-stars',effect==='stars');
    document.body.classList.toggle('vip-neon',effect==='neon');
    document.body.classList.toggle('vip-orbit',effect==='orbit');
    $('vipTheme').value=theme;$('vipEffect').value=effect;$('vipPersonality').value=vipPersonality;$('vipSound').value=vipSoundPack;
    $('vipAvatar').value=p.avatar||'';
    $('vipTagline').value=p.tagline||'';
    $('vipTaglineDisplay').textContent=p.tagline||'';
    $('vipTaglineDisplay').hidden=!Boolean(p.tagline);
    if(p.avatar){$('avatar').textContent=p.avatar;}else if(user){$('avatar').textContent=user.isAnonymous?'G':(user.email[0]||'U').toUpperCase();}
    if(showToastMessage)showToast('VIP customisation saved.');
  }
  function saveVipPrefs(){
    if(!vipActive)return showToast('Redeem a VIP invite code first.');
    const avatar=String($('vipAvatar').value||'').trim().slice(0,8);
    const prefs={theme:$('vipTheme').value,effect:$('vipEffect').value,personality:$('vipPersonality').value,sound:$('vipSound').value,avatar,tagline:String($('vipTagline').value||'').trim().slice(0,36)};
    try{localStorage.setItem(vipPrefsKey(),JSON.stringify(prefs));}catch{}
    applyVipPrefs(true);
  }
  function renderVipStats(){
    const chats=conversations.filter(c=>c.messages.length);
    $('vipChatCount').textContent=String(chats.length);
    $('vipMessageCount').textContent=String(chats.reduce((n,c)=>n+c.messages.length,0));
    $('vipSince').textContent='Member';
  }
  async function openVipModal(){
    $('vipModal').classList.add('open');$('vipStatus').textContent='Checking your account…';
    try{await refreshVip();$('vipStatus').textContent=vipDeveloper?'Developer access confirmed.':vipActive?'VIP unlocked. Your perks are ready.':(user&&!user.isAnonymous?'Enter your one-time VIP code.':'Sign in with a registered account before redeeming a code.');}
    catch(e){$('vipStatus').textContent=e.message;}
    if(vipActive)renderVipStats();
  }
  $('vipClose').addEventListener('click',()=>{$('vipModal').classList.remove('open');hideCurrentVipCode();});
  $('vipModal').addEventListener('click',e=>{if(e.target===$('vipModal')){$('vipModal').classList.remove('open');hideCurrentVipCode();}});
  $('vipRedeemForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!user||user.isAnonymous){$('vipRedeemStatus').textContent='Sign in with a registered account first.';return;}
    const b=$('vipRedeem');b.disabled=true;$('vipRedeemStatus').textContent='Checking invite…';
    try{
      const r=await api('/api/vip',{method:'POST',body:JSON.stringify({code:$('vipCode').value.trim()})});
      if(!r.ok)throw new Error(r.data.error||'Could not redeem that code.');
      $('vipCode').value='';setVipState(true);renderVipStats();
      $('vipRedeemStatus').textContent=r.data.alreadyVip?'This account already has VIP.':r.data.codeRotated?'VIP unlocked! Your code was consumed, and a fresh one-time code was emailed to both developers.':r.data.rotationWarning?'VIP unlocked, but replacement-code delivery needs developer attention. Both developers can use Regenerate code & email both.':'VIP unlocked! Welcome aboard.';
    }catch(err){$('vipRedeemStatus').textContent=err.message;}
    finally{b.disabled=false;}
  });
  function hideCurrentVipCode(){$('vipCurrentCode').hidden=true;$('vipCurrentCodeValue').textContent='';$('vipCodePassword').value='';}
  $('vipCodeVerifyForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!vipDeveloper)return;
    const button=$('vipCodeVerify');button.disabled=true;button.textContent='Verifying…';$('vipVerifyStatus').textContent='Confirming your developer password…';
    try{const r=await api('/api/vip-current-code',{method:'POST',body:JSON.stringify({password:$('vipCodePassword').value})});if(!r.ok)throw Error(r.data.error||'Could not verify your password.');$('vipCurrentCodeValue').textContent=r.data.code;$('vipCurrentCode').hidden=false;$('vipCodePassword').value='';$('vipVerifyStatus').textContent='Password confirmed. This is the active one-time code.';}
    catch(error){$('vipCodePassword').value='';$('vipVerifyStatus').textContent=error.message;}
    finally{button.disabled=false;button.textContent='Verify & reveal';}
  });
  $('vipCopyCode').addEventListener('click',async()=>{const code=$('vipCurrentCodeValue').textContent;try{await navigator.clipboard.writeText(code);$('vipVerifyStatus').textContent='Current code copied.';}catch{$('vipVerifyStatus').textContent='Clipboard access was blocked. Select the code and copy it manually.';}});
  $('vipHideCode').addEventListener('click',hideCurrentVipCode);
  $('vipRegenerate').addEventListener('click',async()=>{
    if(!vipDeveloper)return;const b=$('vipRegenerate');b.disabled=true;b.textContent='Generating and emailing…';hideCurrentVipCode();$('vipDevStatus').textContent='Rotating the active code and sending both emails…';
    try{const r=await api('/api/vip-regenerate',{method:'POST',body:'{}'});if(!r.ok)throw Error(r.data.error||'Could not rotate VIP code.');$('vipDevStatus').textContent='New one-time code generated and emailed to both developers. The previous code is invalid.';}
    catch(e){$('vipDevStatus').textContent=e.message;}finally{b.disabled=false;b.textContent='↻ Rotate code & email both developers';}
  });
  $('vipSave').addEventListener('click',saveVipPrefs);
  $('vipReset').addEventListener('click',()=>{
    if(!vipActive)return;
    try{localStorage.removeItem(vipPrefsKey())}catch{}
    $('vipTheme').value='gold';$('vipEffect').value='stars';$('vipPersonality').value='default';$('vipSound').value='classic';$('vipAvatar').value='';
    applyVipPrefs(true);
  });
  function runVipCommand(raw){
    const bits=String(raw||'').trim().split(/\s+/),cmd=(bits[0]||'').toLowerCase();
    if(cmd==='/vip'){ $('vipOpen').click(); return true; }
    if(!['/stats','/lounge','/theme'].includes(cmd))return false;
    if(!vipActive){showToast('That command is VIP-only. Type /vip to redeem an invite.');return true;}
    if(cmd==='/stats'){renderVipStats();showToast('VIP stats: '+$('vipChatCount').textContent+' chats · '+$('vipMessageCount').textContent+' messages');return true;}
    if(cmd==='/lounge'){$('vipOpen').click();return true;}
    if(cmd==='/theme'){
      const name=(bits[1]||'gold').toLowerCase();
      if(!['gold','obsidian','cosmic','aurora'].includes(name)){showToast('Themes: gold, obsidian, cosmic, aurora');return true;}
      $('vipTheme').value=name;saveVipPrefs();return true;
    }
    return false;
  }

  // ---- account memory: private Supabase-backed facts used as context in every chat ----
  let memoryItems = [];
  function renderMemoryList(){
    const list=$('memoryList');if(!list)return;list.textContent='';
    if(!memoryItems.length){const p=document.createElement('p');p.className='history-empty';p.textContent='No saved memories yet. Glitch can learn clear preferences and ongoing projects from chats, or you can add one here.';list.appendChild(p);return;}
    memoryItems.forEach(item=>{
      const row=document.createElement('div');row.className='memory-row';const content=document.createElement('div');content.className='memory-content';content.textContent=item.content;
      const actions=document.createElement('div');actions.className='memory-actions';
      const edit=document.createElement('button');edit.type='button';edit.className='memory-edit';edit.textContent='Edit';
      const del=document.createElement('button');del.type='button';del.className='memory-delete';del.textContent='Delete';
      edit.addEventListener('click',()=>{row.textContent='';row.classList.add('editing');const field=document.createElement('textarea');field.maxLength=500;field.rows=3;field.value=item.content;field.setAttribute('aria-label','Edit saved memory');const save=document.createElement('button');save.type='button';save.className='memory-edit';save.textContent='Save changes';const cancel=document.createElement('button');cancel.type='button';cancel.className='memory-delete';cancel.textContent='Cancel';save.addEventListener('click',async()=>{const value=field.value.trim();if(!value){showToast('A memory cannot be empty.');return;}save.disabled=true;try{const r=await api('/api/memory',{method:'PATCH',body:JSON.stringify({id:item.id,content:value})});if(!r.ok)throw new Error(r.data.error||'Could not update memory.');item.content=value;renderMemoryList();}catch(e){showToast(e.message);save.disabled=false;}});cancel.addEventListener('click',renderMemoryList);const rowActions=document.createElement('div');rowActions.className='memory-actions';rowActions.append(save,cancel);row.append(field,rowActions);field.focus();});
      del.addEventListener('click',async()=>{del.disabled=true;try{const r=await api('/api/memory',{method:'DELETE',body:JSON.stringify({id:item.id})});if(!r.ok)throw new Error(r.data.error||'Could not delete memory.');memoryItems=memoryItems.filter(x=>x.id!==item.id);renderMemoryList();}catch(e){showToast(e.message);del.disabled=false;}});
      actions.append(edit,del);row.append(content,actions);list.appendChild(row);
    });
  }
  async function loadMemories(){if(!user){memoryItems=[];renderMemoryList();return;}const r=await api('/api/memory');if(!r.ok)throw new Error(r.data.error||'Could not load account memory.');memoryItems=Array.isArray(r.data.memories)?r.data.memories:[];renderMemoryList();}
  async function saveMemory(content,quiet=false){const value=String(content||'').trim().slice(0,500);if(!value)throw new Error('Write something to remember first.');const r=await api('/api/memory',{method:'POST',body:JSON.stringify({content:value})});if(!r.ok)throw new Error(r.data.error||'Could not save memory.');await loadMemories();if(!quiet)showToast('Saved to your account memory.');}
  $('memoryOpen').addEventListener('click',async()=>{if(!user){showToast('Sign in or continue as guest to use account memory.');return;}$('memoryModal').classList.add('open');$('memoryInput').focus();$('memoryStatus').textContent='Loading your saved memories…';try{await loadMemories();$('memoryStatus').textContent='';}catch(e){$('memoryStatus').textContent=e.message;}});
  $('memoryClose').addEventListener('click',()=>$('memoryModal').classList.remove('open'));
  $('memoryModal').addEventListener('click',e=>{if(e.target===$('memoryModal'))$('memoryModal').classList.remove('open');});
  $('memoryInput').addEventListener('input',()=>{$('memoryCount').textContent=$('memoryInput').value.length+' / 500';});
  $('memoryForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('memorySave');b.disabled=true;$('memoryStatus').textContent='Saving…';try{await saveMemory($('memoryInput').value);$('memoryInput').value='';$('memoryCount').textContent='0 / 500';$('memoryStatus').textContent='Saved. Glitch can use this in future chats.';}catch(err){$('memoryStatus').textContent=err.message;}finally{b.disabled=false;}});

  function add(role, text, tag) {
    const el = document.createElement('div');
    document.body.classList.remove('empty');
    el.className = 'msg ' + role;
    if (role === 'bot') renderBotContent(el, text);
    else if (role === 'user') {
      const names = []; const body = String(text).replace(FILE_RE, (_, n) => { names.push(n); return ''; }).replace(/\n*\[Attached file: (.*?)\]/g, (_, n) => { names.push(n); return ''; }).trim();
      el.textContent = body;
      names.forEach(n => { const chip = document.createElement('div'); chip.className = 'file-chip'; chip.textContent = '📎 ' + n; el.appendChild(chip); });
    } else el.textContent = text;
    if (role === 'bot' && text) {
      const bar = document.createElement('div'); bar.className = 'msg-actions';
      const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'msg-copy'; cp.textContent = 'Copy'; cp.setAttribute('aria-label', 'Copy reply');
      cp.addEventListener('click', () => copyText(text, cp)); bar.appendChild(cp);
      if (Voice.canSpeak) { const ls = document.createElement('button'); ls.type = 'button'; ls.className = 'msg-listen'; ls.textContent = 'Listen'; ls.setAttribute('aria-label', 'Read this reply aloud'); ls.addEventListener('click', () => Voice.toggleSpeak(text, ls)); bar.appendChild(ls); }
      el.appendChild(bar);
    }
    if (tag) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = tag; el.appendChild(t); }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function render() {
    log.style.scrollBehavior = 'auto';   // rebuilding the list must not trigger a smooth-scroll animation
    log.textContent = '';
    document.body.classList.toggle('empty', !history.length);
    if (!history.length) return;
    history.forEach(m => add(m.role === 'user' ? 'user' : 'bot', m.content));
    const lastH = history[history.length - 1], prevH = history[history.length - 2];
    const lastEl = log.lastElementChild;
    if (lastH && lastH.role === 'assistant' && prevH && prevH.role === 'user' && lastEl && lastEl.querySelector('.msg-actions') && !pending) {
      const rg = document.createElement('button'); rg.type = 'button'; rg.className = 'msg-regen'; rg.textContent = 'Regenerate'; rg.setAttribute('aria-label', 'Regenerate this reply');
      rg.addEventListener('click', () => { if (busy) return; const q = prevH.content; history.pop(); send(q, true); });
      lastEl.querySelector('.msg-actions').appendChild(rg);
    }
    if (pending && pending.chatId === activeChatId) { pending.el = add('bot', ''); pending.el.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; }
    log.scrollTop = log.scrollHeight;
    log.style.scrollBehavior = '';
  }

  // ---- talking to the server ------------------------------------------------
  async function api(path, opts = {}) {
    const token = user && user.accessToken ? user.accessToken : '';
    let r;
    try {
      r = await fetch(path, { ...opts, signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(70000)]) : AbortSignal.timeout(70000), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    } catch (e) {
      const slow = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new Error(slow ? 'The reply took too long. Try again, or ask for something shorter.' : 'Can’t reach the server. Check your connection and try again.');
    }
    let body = {}; try { body = await r.json(); } catch {}
    if (!r.ok && !body.error) {
      body.error = r.status === 504 || r.status === 524 ? 'The reply took too long. Try again, or ask for something shorter.'
        : r.status === 413 ? 'That message is too large. Shorten it or attach less.'
        : r.status >= 500 ? 'The server had a problem (' + r.status + '). Try again in a moment.' : 'Request failed (' + r.status + ').';
    }
    return { ok: r.ok, status: r.status, data: body };
  }

  // ---- sign in / sign up ------------------------------------------------------
  let tab = 'login';
  const gateMsg = (text, good) => { $('gateMsg').textContent = text || ''; $('gateMsg').classList.toggle('good', !!good); };
  function openGate(text) { gateMsg(text); $('gate').classList.add('open'); $('email').focus(); }
  function setTab(t) {
    tab = t;
    document.querySelectorAll('#gate .tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === t)));
    $('password').autocomplete = t === 'register' ? 'new-password' : 'current-password';
    $('gateSubmit').textContent = t === 'register' ? 'Create account' : 'Sign in';
    $('gateHint').textContent = t === 'register' ? 'Use a real email. Password: 8 characters or more.' : "Prove you're allowed to bother me.";
    gateMsg('');
  }
  document.querySelectorAll('#gate .tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  async function signInWithProvider(provider) {
    if (!sb) return gateMsg(authInitError);
    const buttons = [$('googleSignIn'), $('discordSignIn'), $('githubSignIn')];
    const providerName = provider === 'google' ? 'Google' : provider === 'discord' ? 'Discord' : 'GitHub';
    buttons.forEach(b => { b.disabled = true; });
    gateMsg('Connecting to ' + providerName + '…');
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
    } catch (err) {
      gateMsg(err.message || ('Could not sign in with ' + providerName + '.'));
      buttons.forEach(b => { b.disabled = false; });
    }
  }
  $('googleSignIn').addEventListener('click', () => signInWithProvider('google'));
  $('discordSignIn').addEventListener('click', () => signInWithProvider('discord'));
  $('githubSignIn').addEventListener('click', () => signInWithProvider('github'));

  $('gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim(), password = $('password').value;
    if (!sb) return gateMsg(authInitError);
    if (tab === 'register' && password.length < 8) return gateMsg('Password must be at least 8 characters.');
    $('gateSubmit').disabled = true; gateMsg('');
    try {
      if (tab === 'register') {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) { setTab('login'); gateMsg('Account created. Check your email to confirm it, then sign in.', true); }
        else { gateMsg('Account created. You are signed in.', true); }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      $('password').value = '';
    } catch (err) {
      gateMsg(err.message || 'Something went wrong.');
    } finally {
      $('gateSubmit').disabled = false;
    }
  });


  function profileKey(){return 'glitch_profile_'+(user?user.id:'guest');}
  function readProfile(){try{return JSON.parse(localStorage.getItem(profileKey())||'{}')}catch{return {}}}
  function paintProfile(){
    const saved=readProfile(),name=(user&&user.metadata&&user.metadata.display_name)||saved.name||(user&&user.email?user.email.split('@')[0]:'Guest');
    const picture=saved.picture||'';
    $('who').textContent=name;$('profileDisplayName').value=name;$('settingsEmail').textContent=user?(user.isAnonymous?'Guest session':user.email):'Not signed in';
    for(const el of [$('avatar'),$('profilePreview')]){el.textContent=picture?'':(name.trim()[0]||'G').toUpperCase();el.style.backgroundImage=picture?'url("'+picture+'")':'';el.classList.toggle('has-picture',!!picture);}
  }
  $('settingsOpen').addEventListener('click',()=>{paintProfile();$('settingsModal').classList.add('open');});
  $('settingsClose').addEventListener('click',()=>$('settingsModal').classList.remove('open'));
  $('settingsModal').addEventListener('click',e=>{if(e.target===$('settingsModal'))$('settingsModal').classList.remove('open');});
  $('vipOpen').addEventListener('click',()=>{$('settingsModal').classList.remove('open');openVipModal();});
  $('personalizeOpen').addEventListener('click',()=>{$('settingsModal').classList.remove('open');openVipModal();});
  $('devSettingsOpen').addEventListener('click',()=>{$('vipDeveloperTools').scrollIntoView({block:'start',behavior:'smooth'});});
  $('installAppSide').addEventListener('click',()=>installGlitch());
  $('profilePictureInput').addEventListener('change',e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>1500000){$('profileStatus').textContent='Choose a PNG, JPG, WebP or GIF under 1.5 MB.';e.target.value='';return;}
    const reader=new FileReader();reader.onload=()=>{const p=readProfile();p.picture=String(reader.result);try{localStorage.setItem(profileKey(),JSON.stringify(p));paintProfile();$('profileStatus').textContent='Picture updated on this device.';}catch{$('profileStatus').textContent='Could not save this picture. Try a smaller image.';}};reader.onerror=()=>$('profileStatus').textContent='Could not read that image.';reader.readAsDataURL(file);
  });
  $('profilePictureRemove').addEventListener('click',()=>{const p=readProfile();delete p.picture;try{localStorage.setItem(profileKey(),JSON.stringify(p));paintProfile();$('profileStatus').textContent='Profile picture removed.';}catch{$('profileStatus').textContent='Could not update the profile.';}});
  $('profileSave').addEventListener('click',async()=>{
    const name=$('profileDisplayName').value.trim().slice(0,40);if(!name){$('profileStatus').textContent='Enter a display name first.';return;}
    const b=$('profileSave');b.disabled=true;$('profileStatus').textContent='Saving profile…';
    try{if(user&&!user.isAnonymous&&sb){const {error}=await sb.auth.updateUser({data:{display_name:name}});if(error)throw error;user.metadata={...(user.metadata||{}),display_name:name};}
      const p=readProfile();p.name=name;localStorage.setItem(profileKey(),JSON.stringify(p));paintProfile();$('profileStatus').textContent='Profile saved.';}
    catch(error){$('profileStatus').textContent=error.message||'Could not save profile.';}finally{b.disabled=false;}
  });
  $('passwordReset').addEventListener('click',async()=>{
    if(!user||user.isAnonymous||!user.email){$('accountStatus').textContent='Sign in with an email account to request a password reset.';return;}
    const b=$('passwordReset');b.disabled=true;$('accountStatus').textContent='Sending password reset email…';
    try{const {error}=await sb.auth.resetPasswordForEmail(user.email,{redirectTo:location.origin});if(error)throw error;$('accountStatus').textContent='Password reset email sent to '+user.email+'.';}
    catch(error){$('accountStatus').textContent=error.message||'Could not send the reset email.';}finally{b.disabled=false;}
  });

  function onSignedIn(u, accessToken) {
    vipDeveloper=false;vipActive=false;document.body.classList.remove('vip-active');
    const changedUser = !user || user.id !== u.id;
    user = { id: u.id, email: u.email || '', isAnonymous: Boolean(u.is_anonymous), accessToken, metadata: u.user_metadata || {} };
    paintProfile();
    syncAccountBadge();
    $('dot').classList.add('on');
    $('gate').classList.remove('open');
    markMode();
    // Token refreshes call this again; only (re)load chats when the account really changed.
    if (changedUser) { quotaDone = false; pending = null; loadHistory(); render(); loadMemories().catch(e => showToast('Memory could not load: ' + e.message)); }
    refreshVip().catch(() => setVipState(false));
    refreshUsage();
  }
  function onSignedOut() {
    user = null; vipDeveloper=false; setVipState(false); syncAccountBadge(); hideCurrentVipCode(); memoryItems = []; renderMemoryList(); pending = null; undo = null; history = []; conversations = []; activeChatId = null;
    $('who').textContent = 'Signed out'; $('avatar').textContent = 'G'; $('settingsEmail').textContent='Not signed in'; $('dot').classList.remove('on'); $('quota').textContent = '';
    render(); renderHistoryList(); openGate();
  }
  $('guestSignIn').addEventListener('click', async () => {
    if (!sb) return gateMsg(authInitError);
    const button = $('guestSignIn'); button.disabled = true; gateMsg('Starting a guest session…');
    try {
      const { error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      $('password').value = '';
    } catch (err) {
      const message = /anonymous|disabled/i.test(err.message || '')
        ? 'Guest sign-in is not enabled yet. Enable Anonymous Sign-Ins in Supabase → Authentication → Sign In / Providers.'
        : (err.message || 'Could not start a guest session.');
      gateMsg(message);
    } finally { button.disabled = false; }
  });
  $('signout').addEventListener('click', () => sb && sb.auth.signOut());

  // ---- file reading: PDF, Office documents, code and plain-text formats --------
  const TEXT_EXTS = new Set(('txt md markdown json jsonl xml html htm css scss less js mjs cjs ts tsx jsx py ipynb java c h cpp hpp cs go rs php rb swift kt kts sql sh bash ps1 bat yml yaml toml ini cfg conf env log csv tsv tex vue svelte dart lua r pl ex exs erl hs scala clj diff patch gitignore dockerfile makefile gradle properties rtf').split(' '));
  function extOf(name) { return (name.split('.').pop() || '').toLowerCase(); }
  async function loadScript(src, marker) {
    if (window[marker]) return;
    await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = () => reject(new Error('Could not load the document reader library. Check your internet connection.')); document.head.appendChild(script); });
  }
  async function extractFile(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than 8 MB.');
    const ext = extOf(file.name);
    if (ext === 'pdf') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i), content = await page.getTextContent();
        pages.push('[Page ' + i + '] ' + content.items.map(item => item.str).join(' '));
        if (pages.join('\n').length > MAX_EXTRACTED_CHARS) break;
      }
      return pages.join('\n').slice(0, MAX_EXTRACTED_CHARS) || '[No selectable text found. This may be a scanned PDF requiring OCR.]';
    }
    if (ext === 'docx') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js', 'mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return result.value.slice(0, MAX_EXTRACTED_CHARS);
    }
    if (['xlsx', 'xls', 'ods'].includes(ext)) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'XLSX');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      return book.SheetNames.map(name => 'Sheet: ' + name + '\n' + XLSX.utils.sheet_to_csv(book.Sheets[name])).join('\n\n').slice(0, MAX_EXTRACTED_CHARS);
    }
    if (ext === 'odt') throw new Error('ODT is not supported yet. Please export it as DOCX or TXT.');
    if (TEXT_EXTS.has(ext) || !file.name.includes('.')) return (await file.text()).slice(0, MAX_EXTRACTED_CHARS);
    throw new Error('Unsupported file type. Try PDF, DOCX, XLSX/XLS/ODS, CSV, TXT, or a source-code/text file.');
  }
  let reading = 0;
  const TOTAL_ATTACH_CHARS = 24000;
  function renderAttachments(note, isErr) {
    const box = $('fileStatus'); box.textContent = '';
    attachedFiles.forEach((f, idx) => {
      const chip = document.createElement('span'); chip.className = 'attach-chip';
      chip.append(document.createTextNode('📎 ' + f.name + (f.trimmed ? ' (trimmed)' : '')));
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + f.name);
      x.addEventListener('click', () => { attachedFiles.splice(idx, 1); renderAttachments(); });
      chip.append(x); box.append(chip);
    });
    if (note) { const n = document.createElement('span'); n.className = 'attach-note' + (isErr ? ' err' : ''); n.textContent = note; box.append(n); }
  }
  $('attach').addEventListener('click', () => $('filePicker').click());
  $('filePicker').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    reading++; sendBtn.disabled = true;
    let problem = '';
    for (const file of files) {
      renderAttachments('Reading ' + file.name + '…');
      try {
        let content = await extractFile(file), trimmed = false;
        const used = attachedFiles.reduce((n, f) => n + f.content.length, 0), room = TOTAL_ATTACH_CHARS - used;
        if (room < 500) throw new Error('attachment limit reached (about 24,000 characters in total).');
        if (content.length > room) { content = content.slice(0, room); trimmed = true; }
        attachedFiles.push({ name: file.name, content, trimmed });
      } catch (err) { problem = file.name + ': ' + (err.message || 'Could not read this file.'); }
    }
    reading--; if (!reading && !busy) sendBtn.disabled = false;
    renderAttachments(problem, Boolean(problem));
  });

  // ---- sending a message --------------------------------------------------------
  async function refreshUsage() {
    if (!user) return;
    if (!user.isAnonymous) { $('quota').textContent = ''; return; }
    try {
      const { ok, data } = await api('/api/usage');
      if (ok && data.usage) { $('quota').textContent = `${data.usage.remaining}/${data.usage.limit} guest messages left`; quotaDone = data.usage.remaining <= 0; if (quotaDone) showQuotaEnd(); }
    } catch {}
  }

  let abortCtl = null, quotaDone = false;
  const quotaModal = $('quotaModal');
  function showQuotaEnd() {
    quotaDone = true;
    $('quota').textContent = '0/30 guest messages left';
    quotaModal.classList.add('open'); $('quotaSignup').focus();
  }
  async function goToGate(which) {
    quotaModal.classList.remove('open');
    if (sb) await sb.auth.signOut();
    setTimeout(() => {
      setTab(which); $('gate').classList.add('open');
      gateMsg(which === 'register' ? 'Guest limit reached. Create an account with a real email to keep chatting.' : 'Sign in to keep chatting.', which !== 'register');
      $('email').focus();
    }, 60);
  }
  $('quotaSignup').addEventListener('click', () => goToGate('register'));
  $('quotaLogin').addEventListener('click', () => goToGate('login'));
  $('quotaClose').addEventListener('click', () => quotaModal.classList.remove('open'));
  quotaModal.addEventListener('click', (e) => { if (e.target === quotaModal) quotaModal.classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') quotaModal.classList.remove('open'); });
  function isImageGenerationPrompt(text) {
    const t = String(text || '').trim();
    return /\b(generate|create|draw|make|design|illustrate|paint|render)\b.{0,90}\b(image|picture|illustration|wallpaper|logo|poster|artwork|portrait|concept art|comic panel)\b/i.test(t)
      || /^\s*(please\s+)?(show|make|create|draw)\s+me\s+(an?\s+)?(image|picture|illustration)\b/i.test(t)
      || /^\s*(please\s+)?(draw|paint|illustrate)\b/i.test(t)
      || /\b(i want|i need|please make|can you make|could you make|give me)\b.{0,60}\b(image|picture|illustration|wallpaper|logo|poster|artwork|portrait)\b/i.test(t);
  }
  async function send(text, retry) {
    if (busy) return;
    const requestText = text == null ? String((history[history.length - 1] || {}).content || '') : String(text);
    if (user && user.isAnonymous && quotaDone) { showQuotaEnd(); return; }
    const chat = activeChat(); if (!chat) return;
    const chatId = chat.id, sentMode = mode;
    if (!retry) playSfx('send');
    Voice.onSend();
    const rememberMatch = String(text || '').trim().match(/^(?:please\s+)?remember(?:\s+that)?\s*[:,-]?\s*(.{3,500})$/i);
    if (rememberMatch && user) { try { await saveMemory(rememberMatch[1], true); } catch (e) { showToast('Could not save that memory: ' + e.message); } }
    busy = true; sendBtn.disabled = true; document.body.classList.add('busy'); abortCtl = new AbortController();
    if (!retry) history.push({ role: 'user', content: text });
    chat.mode = sentMode; saveHistory(); render();
    pending = { chatId, el: null }; render();
    const payload = history.map(m => ({ role: m.role, content: m.content }));
    const inActive = () => activeChatId === chatId;
    // Put a message into the right chat even if the person has opened another chat while waiting.
    const note = (kind, msg) => { if (inActive()) { pending = null; render(); showError(msg, kind === 'retry'); } else { pending = null; showToast(msg); } Voice.onFailed(); };
    try {
      let result;
      if (isImageGenerationPrompt(requestText)) {
        const imageResult = await api('/api/images', { method: 'POST', body: JSON.stringify({ prompt: String(requestText).slice(0, 1000) }), signal: abortCtl.signal });
        if (!imageResult.ok && imageResult.status === 403 && imageResult.data.vipRequired) { $('vipModal').classList.add('open'); $('vipStatus').textContent = imageResult.data.error; }
        if (!imageResult.ok) throw new Error(imageResult.data.error || 'Image generation failed.');
        const imageSource = imageResult.data.imageUrl || imageResult.data.image;
        if (!imageSource) throw new Error('The image service returned no image. Please try again.');
        result = { ok: true, status: 200, data: { reply: 'Here is the image you requested.\n\n[[GLITCH_IMAGE:' + imageSource + ']]', mode: sentMode } };
      } else {
        result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ messages: payload, mode: sentMode, vipPersonality: vipActive ? vipPersonality : 'default' }), signal: abortCtl.signal });
      }
      const { ok, status, data } = result;
      if (status === 401) { pending = null; await sb.auth.signOut(); return; }
      if (!ok) {
        if (status === 429) { pending = null; if (inActive()) render(); showQuotaEnd(); Voice.onFailed(); return; }
        if (status === 403 && data.vipRequired) { $('vipModal').classList.add('open'); $('vipStatus').textContent = data.error || 'This feature is VIP-only. Redeem your invite to unlock it.'; }
        throw new Error(data.error || 'Request failed (' + status + ')');
      }
      const target = conversations.find(c => c.id === chatId);
      if (!target) { pending = null; return; }                     // chat was deleted meanwhile
      if (data.mode === 'cognition' && mode !== 'cognition') { mode = 'cognition'; try { localStorage.setItem(MODE_KEY, mode); } catch {} markMode(); }
      if (inActive()) history.push({ role: 'assistant', content: data.reply });
      else target.messages.push({ role: 'assistant', content: data.reply });
      pending = null;
      if (inActive()) { playSfx('reply'); Voice.onReply(data.reply); }
      target.updatedAt = Date.now();
      if (inActive()) saveHistory(); else { conversations = [target, ...conversations.filter(c => c.id !== chatId)]; persistChats(); showToast('Reply ready in “' + target.title + '”', 'Open', () => openChat(chatId)); }
      if (inActive()) {
        render();
        const lastMsg = log.lastElementChild;   // a long reply should open at its start, not its end
        if (lastMsg && lastMsg.classList.contains('bot') && lastMsg.offsetHeight > log.clientHeight * 0.7) {
          // Anchor on the user's question just above the reply so it stays visible instead of scrolling out of view.
          const q = lastMsg.previousElementSibling;
          const anchor = (q && q.classList.contains('user')) ? q : lastMsg;
          log.style.scrollBehavior = 'auto';
          log.scrollTop += anchor.getBoundingClientRect().top - log.getBoundingClientRect().top - 12;
          log.style.scrollBehavior = '';
        }
      }
      if (data.suggestCognition && inActive()) {
        const lastBot = log.querySelector('.msg.bot:last-of-type');
        if (lastBot) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'code-download'; button.style.marginTop = '10px';
          button.textContent = 'Switch to Cognition and try again';
          button.addEventListener('click', () => {
            if (busy) return;
            mode = 'cognition'; try { localStorage.setItem(MODE_KEY, mode); } catch {}
            markMode();
            // Replace the Flash redirect reply with the real answer: drop it, then resend the same question.
            if (history.length && history[history.length - 1].role === 'assistant') history.pop();
            send(text, true);
          });
          lastBot.appendChild(button);
        }
      }
      if (data.usage) $('quota').textContent = `${data.usage.remaining}/${data.usage.limit} guest messages left`;
    } catch (e) {
      if (abortCtl && abortCtl.signal.aborted) { pending = null; if (inActive()) render(); showToast('Stopped.'); Voice.onFailed(); }
      else note('retry', e.message || 'Something went wrong.');
    } finally {
      document.body.classList.remove('busy'); abortCtl = null;
      busy = false; sendBtn.disabled = reading > 0; if (inActive()) input.focus();
    }
  }
  // The question stays in the chat after a failure; Retry sends it again without duplicating it.
  function showError(msg, canRetry) {
    const el = add('err', msg);
    if (canRetry && history.length && history[history.length - 1].role === 'user') {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'code-download'; b.style.marginLeft = '10px'; b.textContent = 'Retry';
      b.addEventListener('click', () => { if (!busy) { el.remove(); send(null, true); } });
      el.appendChild(b);
    }
  }

  $('chat').addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = input.value.trim();
    if(typed.startsWith('/') && runVipCommand(typed)){input.value='';return;}
    if ((!typed && !attachedFiles.length) || busy || !user) return;
    if (reading) { showToast('Still reading your file. Try again in a moment.'); return; }
    const LIMIT = 29000;                                           // the server cuts messages at 30,000 characters
    if (typed.length > LIMIT - 500) { showToast('That message is too long. Please shorten it.'); return; }
    let room = LIMIT - typed.length - 200 * attachedFiles.length, trimmedAny = false;
    const fileContext = attachedFiles.map(f => {
      let c = f.content; if (c.length > room) { c = c.slice(0, Math.max(0, room)); trimmedAny = true; } room -= c.length;
      return '\n\n--- Attached file: ' + f.name + ' ---\n' + c + '\n--- End file ---';
    }).join('');
    if (trimmedAny) showToast('Attachments were trimmed to fit the message size limit.');
    const message = (typed || 'Please read and analyze the attached file(s).') + fileContext;
    attachedFiles = []; renderAttachments();
    input.value = ''; input.style.height = 'auto';
    send(message);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); $('chat').requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; });
  $('newChat').addEventListener('click', () => { playSfx('tap'); startNewChat(); });

  log.addEventListener('scroll', () => document.body.classList.toggle('away', log.scrollHeight - log.scrollTop - log.clientHeight > 240), { passive: true });
  $('toBottom').addEventListener('click', () => log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' }));
  $('stopBtn').addEventListener('click', () => { if (abortCtl) abortCtl.abort(); });
  $('exportChat').addEventListener('click', () => {
    if (!history.length) { showToast('Nothing to export yet.'); return; }
    const chat = activeChat();
    const md = '# ' + ((chat && chat.title) || 'Glitch chat') + '\n\n' + history.map(m => '**' + (m.role === 'user' ? 'You' : 'Glitch') + '**\n\n' + m.content).join('\n\n---\n\n') + '\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = ((chat && chat.title) || 'glitch-chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 60).replace(/\s+/g, '-') + '.md';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('clear').addEventListener('click', () => {
    playSfx('tap');
    if (pending && pending.chatId === activeChatId) return;
    if (history.length && !confirm('Clear the messages in this chat? It stays in Recent chats with an empty history.')) return;
    history = []; const c = activeChat(); if (c) c.title = 'New chat'; saveHistory(false); render(); document.body.classList.remove('nav-open'); input.focus();
  });
  $('histSearch').addEventListener('input', (e) => { histFilter = e.target.value; renderHistoryList(); });
  // Ctrl/Cmd+K focuses chat search.
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && user) { e.preventDefault(); document.body.classList.add('nav-open'); $('histSearch').focus(); } });

  // ---- modes ------------------------------------------------------------------
  // The mode is a setting for the next message; it no longer swaps out your whole history.
  function markMode() { document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode))); document.body.classList.toggle('cognition-mode', mode === 'cognition'); document.body.classList.toggle('flash-mode', mode === 'flash'); }
  document.querySelectorAll('.modes button').forEach(b => b.addEventListener('click', () => {
    if (busy || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch {}
    markMode(); const c = activeChat(); if (c) { c.mode = mode; if (c.messages.length) persistChats(); }
  }));

  // ---- look & feel: accent, light/dark, mobile menu, suggestions, send ripple ----------
  const root = document.documentElement;
  const colorWheel = $('colorWheel'), colorWheelMarker = $('colorWheelMarker');
  const accentWheelLabel = $('accentWheelLabel');
  const accentBrightness = $('accentBrightness');
  const accentBrightnessValue = $('accentBrightnessValue');
  const accentHexInput = $('accentHex');
  let hue = 260, saturation = 75, brightness = 92;
  const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
  function hsvToHex(h,s,v) {
    const c=(v/100)*(s/100),x=c*(1-Math.abs((h/60)%2-1)),m=v/100-c;
    const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
    return '#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
  }
  function hexToHsv(hex) {
    const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;
    if(d){if(max===r)h=60*(((g-b)/d)%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);}
    return {h:(h+360)%360,s:max===0?0:d/max*100,v:max*100};
  }
  function paintWheel(persist=true) {
    const hex=hsvToHex(hue,saturation,brightness);
    const angle=(hue-90)*Math.PI/180, radius=42*(saturation/100);
    colorWheelMarker.style.left=(50+Math.cos(angle)*radius)+'%';
    colorWheelMarker.style.top=(50+Math.sin(angle)*radius)+'%';
    colorWheel.style.setProperty('--wheel-selected',hex);
    colorWheel.setAttribute('aria-valuenow',String(Math.round(hue)));
    if(root.dataset.theme!=='custom'){try{localStorage.setItem('glitch_base_theme',root.dataset.theme||'default');}catch{}}
    root.dataset.theme='custom';root.style.setProperty('--accent',hex);
    accentWheelLabel.textContent=hex.toUpperCase();
    accentHexInput.value=hex.toUpperCase();
    accentBrightness.value=String(Math.round(brightness));
    accentBrightnessValue.textContent=Math.round(brightness)+'%';
    if(persist){try{localStorage.setItem('glitch_accent',hex);localStorage.setItem('glitch_theme','custom');}catch{}}
  }
  function wheelPointer(e) {
    const r=colorWheel.getBoundingClientRect(),x=e.clientX-(r.left+r.width/2),y=e.clientY-(r.top+r.height/2);
    const distance=Math.min(1,Math.hypot(x,y)/(r.width*.47));
    hue=(Math.atan2(y,x)*180/Math.PI+90+360)%360;
    saturation=distance*100;
    paintWheel(true);
  }
  colorWheel.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;colorWheel.setPointerCapture(e.pointerId);wheelPointer(e);});
  colorWheel.addEventListener('pointermove',e=>{if(colorWheel.hasPointerCapture(e.pointerId))wheelPointer(e);});
  accentBrightness.addEventListener('input', () => {
    brightness=Number(accentBrightness.value);
    paintWheel(true);
  });
  colorWheel.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();hue=(hue+(['ArrowRight','ArrowUp'].includes(e.key)?2:-2)+360)%360;saturation=Math.max(saturation,70);paintWheel(true);
  });
  // Keep the active theme's own accent as the untouched default.
  const themeDefaultAccent=getComputedStyle(root).getPropertyValue('--accent').trim()||'#7c3aed';
  let savedAccent=null;try{savedAccent=localStorage.getItem('glitch_accent');}catch{}
  if(savedAccent&&/^#[0-9a-f]{6}$/i.test(savedAccent)){
    const hsv=hexToHsv(savedAccent);hue=hsv.h;saturation=hsv.s;brightness=hsv.v;paintWheel(false);
  }else{
    const hsv=hexToHsv(themeDefaultAccent);hue=hsv.h;saturation=hsv.s;brightness=hsv.v;
    accentWheelLabel.textContent='Theme default · '+themeDefaultAccent.toUpperCase();
    const angle=(hue-90)*Math.PI/180,radius=42*(saturation/100);
    colorWheelMarker.style.left=(50+Math.cos(angle)*radius)+'%';colorWheelMarker.style.top=(50+Math.sin(angle)*radius)+'%';
    accentBrightness.value=String(Math.round(brightness));
    accentBrightnessValue.textContent=Math.round(brightness)+'%';
  }
  const accentPickerToggle = $('accentPickerToggle');
  const accentPickerPanel = $('accentPickerPanel');
  accentPickerToggle.addEventListener('click', () => {
    const open = accentPickerPanel.hidden;
    accentPickerPanel.hidden = !open;
    accentPickerToggle.setAttribute('aria-expanded', String(open));
    if (open) colorWheel.focus();
  });
  function updateAccentSwatches() {
    const current = getComputedStyle(root).getPropertyValue('--accent').trim().toLowerCase();
    document.querySelectorAll('.accent-swatch').forEach((swatch) => {
      const active = swatch.dataset.accent.toLowerCase() === current;
      swatch.classList.toggle('active', active);
      swatch.setAttribute('aria-pressed', String(active));
    });
  }
  function selectPresetAccent(hex) {
    const hsv = hexToHsv(hex);
    hue = hsv.h; saturation = hsv.s; brightness = hsv.v;
    paintWheel(true);
    updateAccentSwatches();
  }
  function applyAccentHex(){
    const match=/^#?([0-9a-f]{6})$/i.exec(String(accentHexInput.value||'').trim());
    if(!match){accentHexInput.setCustomValidity('Enter a valid six-digit HEX colour, such as #7C3AED.');accentHexInput.reportValidity();return false;}
    accentHexInput.setCustomValidity('');selectPresetAccent('#'+match[1].toLowerCase());return true;
  }
  $('accentHexApply').addEventListener('click',applyAccentHex);
  accentHexInput.addEventListener('change',applyAccentHex);
  accentHexInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyAccentHex();}});
  accentHexInput.addEventListener('input',()=>accentHexInput.setCustomValidity(''));
  document.querySelectorAll('.accent-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => selectPresetAccent(swatch.dataset.accent));
  });
  $('accentReset').addEventListener('click', () => {
    const baseTheme = (() => { try { return localStorage.getItem('glitch_base_theme') || 'default'; } catch { return 'default'; } })();
    root.dataset.theme = baseTheme;
    root.style.removeProperty('--accent');
    const baseHex = getComputedStyle(root).getPropertyValue('--accent').trim() || '#7c3aed';
    const hsv = hexToHsv(baseHex);
    hue = hsv.h; saturation = hsv.s; brightness = hsv.v;
    accentWheelLabel.textContent = 'Theme default · ' + baseHex.toUpperCase();
    const angle=(hue-90)*Math.PI/180,radius=42*(saturation/100);
    colorWheelMarker.style.left=(50+Math.cos(angle)*radius)+'%';colorWheelMarker.style.top=(50+Math.sin(angle)*radius)+'%';
    colorWheel.style.setProperty('--wheel-selected',baseHex);accentHexInput.value=baseHex.toUpperCase();
    accentBrightness.value=String(Math.round(brightness));
    accentBrightnessValue.textContent=Math.round(brightness)+'%';
    try { localStorage.removeItem('glitch_accent'); localStorage.setItem('glitch_theme', baseTheme); localStorage.removeItem('glitch_base_theme'); } catch {}
    updateAccentSwatches();
  });
  document.addEventListener('click', (e) => {
    if (!accentPickerPanel.hidden && !e.target.closest('.accent-picker-wrap, #accentPickerPanel')) {
      accentPickerPanel.hidden = true;
      accentPickerToggle.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !accentPickerPanel.hidden) {
      accentPickerPanel.hidden = true;
      accentPickerToggle.setAttribute('aria-expanded', 'false');
      accentPickerToggle.focus();
    }
  });
  updateAccentSwatches();
  const schemePreference = $('schemePreference');
  function applySchemePreference(preference, persist=true) {
    const pref = ['light','dark','system'].includes(preference) ? preference : 'system';
    const resolved = pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
    root.dataset.scheme = resolved; schemePreference.value = pref;
    if (persist) { try { localStorage.setItem('glitch_scheme', pref); } catch {} }
  }
  let savedScheme = 'dark'; try { savedScheme = localStorage.getItem('glitch_scheme') || 'dark'; } catch {}
  applySchemePreference(savedScheme, false);
  schemePreference.addEventListener('change', () => { playSfx('toggle'); applySchemePreference(schemePreference.value); });
  const systemScheme = matchMedia('(prefers-color-scheme: dark)');
  systemScheme.addEventListener?.('change', () => { if (schemePreference.value === 'system') applySchemePreference('system', false); });
  $('menu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('side').addEventListener('click', (e) => { if (e.target.closest('[data-mode]')) document.body.classList.remove('nav-open'); });
  document.addEventListener('click', (e) => { if (document.body.classList.contains('nav-open') && !e.target.closest('#side,#menu')) document.body.classList.remove('nav-open'); });
  document.querySelectorAll('.suggest button').forEach(b => b.addEventListener('click', () => {
    input.value = b.dataset.prompt; input.focus();
  }));
  sendBtn.addEventListener('click', (e) => {
    const r = sendBtn.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement('span');
    s.className = 'ripple'; s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
    sendBtn.appendChild(s); setTimeout(() => s.remove(), 600);
  });



  // ---- VIP-only creative tools (all processing stays client-side) ------------
  async function requireVipTool(){
    if(!user){openGate('Sign in with your account to use VIP tools.');return false;}
    try{await refreshVip();}catch(e){showToast('Could not verify VIP status. Please try again.');return false;}
    if(!vipActive){
      $('vipModal').classList.add('open');
      $('vipStatus').textContent=user.isAnonymous?'Create a registered account, then redeem a VIP invite to unlock these tools.':'These tools are VIP-only. Redeem your private invite code to unlock them.';
      return false;
    }
    return true;
  }
  const imageEditorModal=$('imageEditorModal'),editorCanvas=$('editorCanvas'),editorCtx=editorCanvas.getContext('2d');
  let editorImage=null,editorRotation=0,editorObjectUrl='';
  function renderEditor(){
    if(!editorImage)return;
    const rotated=Math.abs(editorRotation%180)===90;
    const maxSide=2600,scale=Math.min(1,maxSide/Math.max(editorImage.naturalWidth,editorImage.naturalHeight));
    const w=Math.max(1,Math.round(editorImage.naturalWidth*scale)),h=Math.max(1,Math.round(editorImage.naturalHeight*scale));
    editorCanvas.width=rotated?h:w;editorCanvas.height=rotated?w:h;
    editorCtx.save();editorCtx.translate(editorCanvas.width/2,editorCanvas.height/2);editorCtx.rotate(editorRotation*Math.PI/180);
    editorCtx.filter='brightness('+ $('editorBrightness').value +'%) contrast('+ $('editorContrast').value +'%) saturate('+ $('editorSaturation').value +'%)';
    editorCtx.drawImage(editorImage,-w/2,-h/2,w,h);editorCtx.filter='none';
    const caption=$('editorText').value.trim();
    if(caption){const size=Math.max(18,Math.round(Math.min(w,h)*.065));editorCtx.font='700 '+size+'px Inter, sans-serif';editorCtx.textAlign='center';editorCtx.textBaseline='bottom';editorCtx.lineWidth=Math.max(3,size*.12);editorCtx.strokeStyle='rgba(0,0,0,.8)';editorCtx.fillStyle='#fff';editorCtx.strokeText(caption,0,Math.min(h/2-12, h*.43));editorCtx.fillText(caption,0,Math.min(h/2-12,h*.43));}
    editorCtx.restore();
    $('editorEmpty').hidden=true;$('editorDownload').disabled=false;
    ['Brightness','Contrast','Saturation'].forEach(k=>$( 'editor'+k+'Value').textContent=$('editor'+k).value+'%');
  }
  function resetEditor(){['Brightness','Contrast','Saturation'].forEach(k=>$('editor'+k).value=100);$('editorText').value='';editorRotation=0;renderEditor();}
  $('openImageEditor').addEventListener('click',async()=>{if(await requireVipTool())imageEditorModal.classList.add('open');});
  $('imageEditorClose').addEventListener('click',()=>imageEditorModal.classList.remove('open'));
  imageEditorModal.addEventListener('click',e=>{if(e.target===imageEditorModal)imageEditorModal.classList.remove('open');});
  $('editorUpload').addEventListener('change',e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    if(!file.type.startsWith('image/')){$('editorStatus').textContent='Choose an image file.';return;}
    if(editorObjectUrl)URL.revokeObjectURL(editorObjectUrl);
    editorObjectUrl=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{editorImage=img;resetEditor();$('editorStatus').textContent='Loaded '+file.name+' · edits are local to this browser.';};
    img.onerror=()=>{$('editorStatus').textContent='Could not open this image.';};
    img.src=editorObjectUrl;
  });
  ['editorBrightness','editorContrast','editorSaturation','editorText'].forEach(id=>$(id).addEventListener('input',renderEditor));
  $('editorRotate').addEventListener('click',()=>{if(editorImage){editorRotation=(editorRotation+90)%360;renderEditor();}});
  $('editorReset').addEventListener('click',()=>{if(editorImage)resetEditor();});
  $('editorDownload').addEventListener('click',()=>{if(!editorImage)return;const a=document.createElement('a');a.download='glitch-edited-image.png';a.href=editorCanvas.toDataURL('image/png');a.click();});


  // ---- Pollinations image studio behavior ------------------------------------
  let imagePreviewUrl = '';
  const imageModal = $('imageModal');
  async function openImageStudio(){
    if(!user){openGate('Sign in to generate images.');return;}
    imageModal.classList.add('open');
    $('imageGenerate').disabled=true;
    $('imageStatus').textContent='Checking image-generation service…';
    $('imagePrompt').focus();
    try{
      const configResult=await api('/api/config');
      if(configResult.ok&&configResult.data.imageGeneration===false){
        $('imageStatus').textContent='Image generation is not configured on this deployment. Add POLLINATIONS_API_KEY to the Vercel environment variables, then redeploy.';
      }else{
        $('imageGenerate').disabled=false;
        $('imageStatus').textContent='';
      }
    }catch(error){
      $('imageStatus').textContent='Could not check image-generation configuration: '+(error.message||'Please try again.');
    }
    refreshImageUsage().catch(e=>{$('imageUsage').textContent=e.message||'Could not load image quota.';});
  }
  function closeImageStudio(){imageModal.classList.remove('open');}
  $('openImageStudio').addEventListener('click',async()=>{if(await requireVipTool())openImageStudio();});
  async function refreshImageUsage(){
    if(!user)return;
    const r=await api('/api/images');
    if(!r.ok)throw new Error(r.data.error||'Could not load image quota.');
    $('imageUsage').textContent=r.data.vip?'VIP: unlimited image generations':('Today: '+r.data.used+' / 15 used · '+r.data.remaining+' free generations left');
  }
  // Image generation is invoked from chat prompts; no separate launcher is required.
  $('imageClose').addEventListener('click',closeImageStudio);
  imageModal.addEventListener('click',e=>{if(e.target===imageModal)closeImageStudio();});
  $('imageGenerate').addEventListener('click',async()=>{
    const prompt=$('imagePrompt').value.trim();
    if(!prompt){$('imageStatus').textContent='Enter a description first.';return;}
    const btn=$('imageGenerate');btn.disabled=true;btn.textContent='Generating…';
    $('imageStatus').textContent='Creating your image. This can take a little while.';
    $('imageDownload').hidden=true;$('imagePreview').hidden=true;
    try{
      const r=await api('/api/images',{method:'POST',body:JSON.stringify({prompt,model:$('imageModel').value})});
      if(!r.ok){
        $('imageStatus').textContent=r.data.error||'Image generation failed.';
        if(r.data.usage&&!r.data.vip)$('imageUsage').textContent='Today: '+r.data.usage.used+' / 15 used · '+r.data.usage.remaining+' left';
        return;
      }
      if(imagePreviewUrl){URL.revokeObjectURL(imagePreviewUrl);imagePreviewUrl='';}
      // Use Pollinations-hosted media directly when available; fall back to the
      // compact data URI for providers that do not return an enclosure URL.
      const imageSource=r.data.imageUrl||r.data.image;
      if(!imageSource)throw new Error('The image provider returned no image. Please try again.');
      if(imageSource.startsWith('data:')){
        const blob=await (await fetch(imageSource)).blob();
        imagePreviewUrl=URL.createObjectURL(blob);
        $('imagePreview').src=imagePreviewUrl;
        $('imageDownload').href=imagePreviewUrl;
      }else{
        $('imagePreview').src=imageSource;
        $('imageDownload').href=imageSource;
      }
      $('imagePreview').hidden=false;
      $('imageDownload').hidden=false;
      $('imageStatus').textContent='Image ready!';
      await refreshImageUsage();
      playSfx('reply');
    }catch(e){$('imageStatus').textContent=e.message||'Could not generate the image.';}
    finally{btn.disabled=false;btn.textContent='Generate image';}
  });

  // ---- installable PWA -----------------------------------------------------------
  let deferredInstallPrompt=null;const installButtons=[$('installApp'),$('installAppSide')].filter(Boolean),installModal=$('installModal');
  const isAppleMobile=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  function updateInstallButtons(){installButtons.forEach(button=>{button.hidden=isStandalone();button.disabled=false;});}
  function openInstallHelp(){$('installAppleHelp').hidden=!isAppleMobile;$('installOtherHelp').hidden=isAppleMobile;$('installStatus').textContent=isAppleMobile?'Safari supports Add to Home Screen on iPhone and iPad.':'This browser has not exposed its native one-tap installation prompt.';installModal.classList.add('open');}
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;updateInstallButtons();});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;updateInstallButtons();showToast('Glitch was installed successfully.');});
  async function installGlitch(){if(isStandalone()){showToast('Glitch is already installed.');return;}if(deferredInstallPrompt){const prompt=deferredInstallPrompt;deferredInstallPrompt=null;try{await prompt.prompt();const choice=await prompt.userChoice;if(choice&&choice.outcome==='accepted')showToast('Glitch installation started.');else showToast('Installation was cancelled.');}catch{openInstallHelp();}updateInstallButtons();return;}openInstallHelp();}
  installButtons.forEach(button=>button.addEventListener('click',installGlitch));$('installClose').addEventListener('click',()=>$('installModal').classList.remove('open'));installModal.addEventListener('click',e=>{if(e.target===installModal)installModal.classList.remove('open');});
  updateInstallButtons();if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(error=>console.warn('PWA service worker registration failed:',error));

  // ---- start ----------------------------------------------------------------------
  if(user) refreshVip().catch(()=>setVipState(false));
  markMode(); render(); renderHistoryList();
  let cfg = null;
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Configuration endpoint returned HTTP ' + response.status + '.');
    cfg = await response.json();
    if (!cfg.configured) {
      authInitError = 'Supabase is not configured on Vercel. Missing: ' + (cfg.missing || []).join(', ') + '. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables, then redeploy.';
      return openGate(authInitError);
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase browser library failed to load (/vendor/supabase.js).');
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    authInitError = 'Supabase could not initialize. Refresh the page; if it persists, check /api/config and /vendor/supabase.js.';
    if (!cfg.cognition) { const b = document.querySelector('[data-mode="cognition"]'); b.classList.add('off'); b.title += ' (not configured on the server)'; }
    if (!cfg.flash) { const b = document.querySelector('[data-mode="flash"]'); b.classList.add('off'); b.title += ' (not configured on the server)'; }

    sb.auth.onAuthStateChange((event, session) => {
      // Use the access token supplied in the event; do not call Supabase again inside this callback.
      if (session && session.user) onSignedIn(session.user, session.access_token);
      else if (event === 'SIGNED_OUT') onSignedOut();
    });
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    authInitError = 'Supabase authentication is unavailable. Check your Supabase project URL and anon key.';
    if (data.session) onSignedIn(data.session.user, data.session.access_token);
    else openGate();
  } catch (error) {
    authInitError = 'Authentication setup failed: ' + (error && error.message ? error.message : 'unknown error') + '. Check Vercel environment variables and /vendor/supabase.js.';
    openGate(authInitError);
  }
})();
