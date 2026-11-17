// Safe DOM-based Markdown, code-artifact and rich message rendering.
(function () {
  function createMessageRenderer({ downloadLibraryItem }) {
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
    function downloadPowerPoint(filename, base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = safeFilename(filename, 'glitch-presentation.pptx');
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
    function downloadArtifact(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = safeFilename(filename, 'generated-file.txt');
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
    function renderBotContent(el, text) {
    const raw = String(text);
    const gmailMatch = raw.match(/\[\[GLITCH_GMAIL_RESULT:([\s\S]*?)\]\]/);
    if (gmailMatch) {
      let payload = null;
      try { payload = JSON.parse(gmailMatch[1]); } catch {}
      if (payload && Array.isArray(payload.messages)) {
        const wrap = document.createElement('section'); wrap.className = 'gmail-result';
        const heading = document.createElement('div'); heading.className = 'gmail-result-head';
        const title = document.createElement('strong'); title.textContent = 'Gmail inbox';
        const count = document.createElement('span'); count.textContent = (payload.count || payload.messages.length) + ' newest messages';
        heading.append(title, count); wrap.append(heading);
        payload.messages.forEach((mail) => {
          const item = document.createElement('article'); item.className = 'gmail-mail';
          const top = document.createElement('div'); top.className = 'gmail-mail-top';
          const subject = document.createElement('strong'); subject.className = 'gmail-mail-subject'; subject.textContent = mail.subject || '(no subject)';
          const date = document.createElement('time'); date.className = 'gmail-mail-date';
          const stamp = Number(mail.timestamp);
          const parsedDate = stamp ? new Date(stamp) : (mail.date ? new Date(mail.date) : null);
          date.textContent = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : (mail.date || 'Date unavailable');
          top.append(subject, date);
          const sender = document.createElement('div'); sender.className = 'gmail-mail-sender'; sender.textContent = mail.from || 'Unknown sender';
          item.append(top, sender);
          if (mail.snippet) { const preview = document.createElement('p'); preview.className = 'gmail-mail-preview'; preview.textContent = mail.snippet; item.append(preview); }
          wrap.append(item);
        });
        if (!payload.messages.length) { const empty = document.createElement('p'); empty.textContent = 'No messages were returned.'; wrap.append(empty); }
        el.append(wrap);
        return;
      }
    }
    const libraryMatch = raw.match(/\[\[GLITCH_LIBRARY_ITEM:([0-9a-f-]{20,})\]\]/i);
    const imageMatch = raw.match(/\[\[GLITCH_IMAGE:(https:\/\/[^\]\s]+|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)\]\]/);
    const visibleText = imageMatch ? raw.replace(imageMatch[0], '').replace(/\[\[GLITCH_LIBRARY_ITEM:[^\]]+\]\]/g, '').trim() : raw.replace(/\[\[GLITCH_LIBRARY_ITEM:[^\]]+\]\]/g, '').trim();
    const safeMediaUrl = (value) => {
      if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(value)) return true;
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && (url.hostname === 'media.pollinations.ai' || url.hostname.endsWith('.supabase.co'));
      } catch { return false; }
    };
    if (imageMatch && safeMediaUrl(imageMatch[1])) {
      if (visibleText) { const body = document.createElement('div'); body.className = 'md'; renderMarkdown(body, visibleText); el.appendChild(body); }
      const figure = document.createElement('figure'); figure.style.cssText = 'margin:14px 0 4px;max-width:min(100%,680px)';
      const img = document.createElement('img'); img.src = imageMatch[1]; img.alt = 'Image generated in Glitch'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.style.cssText = 'display:block;width:100%;height:auto;border-radius:16px;border:1px solid var(--border)';
      const link = document.createElement('a'); link.href = imageMatch[1]; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open full-size image'; link.style.cssText = 'display:inline-block;margin-top:8px;font-size:.82rem';
      const attribution = document.createElement('small'); attribution.textContent = imageMatch[1].includes('.supabase.co/') ? 'Generated with Glitch' : 'Generated with Glitch';
      attribution.style.cssText = 'display:block;margin-top:7px;color:var(--muted);font-size:.75rem';
      figure.append(img, link, attribution);
      if(libraryMatch){const download=document.createElement('button');download.type='button';download.className='code-download library-chat-download';download.textContent='↓ Download saved image';download.addEventListener('click',()=>downloadLibraryItem(libraryMatch[1]));figure.append(download);}
      el.appendChild(figure); return;
    }
    if(libraryMatch){const clean=raw.replace(libraryMatch[0],'').trim();if(clean){const body=document.createElement('div');body.className='md';renderMarkdown(body,clean);el.appendChild(body);}const button=document.createElement('button');button.type='button';button.className='code-download library-chat-download';button.textContent='↓ Download file';button.addEventListener('click',()=>downloadLibraryItem(libraryMatch[1]));el.append(button);return;}
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
    return { copyText, renderMarkdown, renderBotContent, safeFilename, findArtifacts, downloadArtifact, downloadPowerPoint };
  }
  window.GlitchMessageRenderer = { create: createMessageRenderer };
})();
