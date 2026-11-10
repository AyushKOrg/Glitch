/*
 * Glitch local Google Flow worker
 *
 * Run on the same Windows PC/browser used to open Glitch.
 * Google credentials are NEVER collected or stored by this script. Chrome's
 * dedicated local profile is used; sign in manually once in the visible window.
 *
 * Supabase setup (run once in SQL Editor):
 *
 * insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
 * values ('glitch-media', 'glitch-media', false, 52428800,
 *   array['image/png','image/jpeg','image/webp','video/mp4','video/webm'])
 * on conflict (id) do update set public=false, file_size_limit=52428800,
 *   allowed_mime_types=excluded.allowed_mime_types;
 *
 * drop policy if exists "Glitch media owner upload" on storage.objects;
 * create policy "Glitch media owner upload" on storage.objects
 *   for insert to authenticated
 *   with check (bucket_id='glitch-media' and (storage.foldername(name))[1]=auth.uid()::text);
 * drop policy if exists "Glitch media owner read" on storage.objects;
 * create policy "Glitch media owner read" on storage.objects
 *   for select to authenticated
 *   using (bucket_id='glitch-media' and (storage.foldername(name))[1]=auth.uid()::text);
 * drop policy if exists "Glitch media owner delete" on storage.objects;
 * create policy "Glitch media owner delete" on storage.objects
 *   for delete to authenticated
 *   using (bucket_id='glitch-media' and (storage.foldername(name))[1]=auth.uid()::text);
 */

'use strict';

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const FLOW_URL = 'https://labs.google/fx/tools/flow';
const GLITCH_CONFIG_URL = 'https://glitch-k.vercel.app/api/config';
const PORT = Number(process.env.FLOW_WORKER_PORT || 8765);
const PROFILE_DIR = path.join(os.homedir(), '.glitch-flow-profile');
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_GENERATION_MS = 6 * 60 * 1000;

let context = null;
let flowPage = null;
let busy = false;
let publicConfig = null;

function loadPlaywright() {
  try { return require('playwright'); } catch {}
  try {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = execFileSync(npmCommand, ['root', '-g'], { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright'));
  } catch (error) {
    throw new Error('Playwright is not installed. Run: npm install -g playwright');
  }
}

function allowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return (u.protocol === 'https:' && (
      u.hostname === 'glitch-k.vercel.app' ||
      (u.hostname.startsWith('glitch-') && u.hostname.endsWith('.vercel.app'))
    )) || (u.protocol === 'http:' && ['localhost:3000', '127.0.0.1:3000'].includes(u.host));
  } catch { return false; }
}

function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!allowedOrigin(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON request.')); }
    });
    req.on('error', reject);
  });
}

async function getPublicConfig() {
  if (publicConfig) return publicConfig;
  const response = await fetch(GLITCH_CONFIG_URL, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Could not read Glitch configuration (' + response.status + ').');
  const data = await response.json();
  if (!data.configured || !data.supabaseUrl || !data.supabaseAnonKey) {
    throw new Error('Glitch Supabase is not configured. Check /api/config on the production site.');
  }
  publicConfig = {
    url: String(data.supabaseUrl).replace(/\/+$/, ''),
    anon: String(data.supabaseAnonKey)
  };
  return publicConfig;
}

async function verifyVipUser(token) {
  const cfg = await getPublicConfig();
  const headers = { apikey: cfg.anon, Authorization: 'Bearer ' + token };
  const userResponse = await fetch(cfg.url + '/auth/v1/user', {
    headers, signal: AbortSignal.timeout(12000)
  });
  if (!userResponse.ok) throw Object.assign(new Error('Your Glitch sign-in expired. Sign in again and retry.'), { status: 401 });
  const user = await userResponse.json();
  if (!user || !user.id || user.is_anonymous) {
    throw Object.assign(new Error('Google Flow generation requires a registered Glitch account.'), { status: 403 });
  }
  const vipResponse = await fetch(cfg.url + '/rest/v1/rpc/get_glitch_vip_status', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(12000)
  });
  if (!vipResponse.ok) throw new Error('Glitch could not verify your VIP/DEV access.');
  const membership = await vipResponse.json();
  if (membership.vip !== true && membership.developer !== true) {
    throw Object.assign(new Error('Google Flow generation is available to Glitch VIP and DEV accounts.'), { status: 403 });
  }
  return { user, cfg };
}

async function getFlowPage() {
  if (!context) {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: false,
      acceptDownloads: true,
      viewport: { width: 1440, height: 960 }
    });
  }
  const pages = context.pages();
  flowPage = pages.find(p => p.url().startsWith('https://labs.google/')) || pages[0] || await context.newPage();
  if (!flowPage.url().startsWith('https://labs.google/')) {
    await flowPage.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  }
  return flowPage;
}

async function ensureFlowSignedIn(page) {
  if (page.url().includes('accounts.google.com')) {
    throw Object.assign(new Error('Sign in to your Google account in the Chrome window, then send your prompt again.'), { status: 428 });
  }
  const signIn = page.getByRole('button', { name: /sign in/i }).first();
  if (await signIn.count().catch(() => 0)) {
    if (await signIn.isVisible().catch(() => false)) {
      throw Object.assign(new Error('Google Flow needs you to sign in. Complete sign-in in the opened Chrome window, then retry.'), { status: 428 });
    }
  }
  const bodyText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
  if (/not available in your country|not available in your region|you are not eligible/i.test(bodyText)) {
    throw Object.assign(new Error('Google Flow says this account or region is not eligible. Glitch cannot bypass Google eligibility checks.'), { status: 403 });
  }
}

async function findPromptBox(page) {
  const selectors = [
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="describe" i]',
    '[contenteditable="true"][data-placeholder*="prompt" i]',
    '[contenteditable="true"]:visible',
    'textarea:visible'
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (await locator.count().catch(() => 0) && await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function mediaSnapshot(page, kind) {
  return page.evaluate((type) => {
    if (type === 'image') {
      return Array.from(document.querySelectorAll('img')).map(el => ({
        src: el.currentSrc || el.src || '',
        width: el.naturalWidth || el.width || 0,
        height: el.naturalHeight || el.height || 0
      })).filter(x => x.src && x.width >= 160 && x.height >= 160);
    }
    return Array.from(document.querySelectorAll('video')).map(el => ({
      src: el.currentSrc || el.src || '',
      width: el.videoWidth || el.clientWidth || 0,
      height: el.videoHeight || el.clientHeight || 0,
      ready: el.readyState || 0
    })).filter(x => x.src && (x.ready > 0 || (x.width >= 160 && x.height >= 160)));
  }, kind);
}

async function waitForGeneratedMedia(page, kind, before) {
  const previous = new Set(before.map(x => x.src));
  const selector = kind === 'image' ? 'img' : 'video';
  const started = Date.now();
  while (Date.now() - started < MAX_GENERATION_MS) {
    if (page.isClosed()) throw new Error('The Google Flow tab was closed during generation.');
    if (page.url().includes('accounts.google.com')) {
      throw Object.assign(new Error('Google sign-in expired. Sign in again in the Chrome window.'), { status: 428 });
    }
    const current = await mediaSnapshot(page, kind).catch(() => []);
    const fresh = current.filter(x => !previous.has(x.src));
    if (fresh.length) return fresh[fresh.length - 1];
    await page.waitForTimeout(1500);
  }
  throw new Error('Google Flow did not expose a finished ' + kind + ' in the page before timeout. The Flow interface may have changed, or it may need a manual confirmation.');
}

async function extractMedia(page, media, kind) {
  const browserResult = await page.evaluate(async ({ type, source }) => {
    const elements = Array.from(document.querySelectorAll(type === 'image' ? 'img' : 'video'));
    const el = elements.find(item => (item.currentSrc || item.src || '') === source);
    if (!el) return null;
    try {
      const response = await fetch(source);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.size) return null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return { type: blob.type, base64: btoa(binary) };
    } catch { return null; }
  }, { type: kind, source: media.src });

  if (browserResult && browserResult.base64) {
    return { bytes: Buffer.from(browserResult.base64, 'base64'), mime: browserResult.type || (kind === 'image' ? 'image/png' : 'video/mp4') };
  }

  if (/^https?:\/\//i.test(media.src)) {
    const response = await context.request.get(media.src, { timeout: 60000 });
    if (response.ok()) {
      return {
        bytes: await response.body(),
        mime: String(response.headers()['content-type'] || '').split(';')[0] || (kind === 'image' ? 'image/png' : 'video/mp4')
      };
    }
  }

  if (kind === 'image') {
    try {
      const images = page.locator('img');
      const imageIndex = await images.evaluateAll((els, src) => els.findIndex(el => (el.currentSrc || el.src || '') === src), media.src);
      if (imageIndex < 0) throw new Error('Generated image element disappeared.');
      const bytes = await images.nth(imageIndex).screenshot({ timeout: 15000 });
      return { bytes, mime: 'image/png' };
    } catch {}
  }
  throw new Error('Flow finished, but Glitch could not download the generated media. Try again from the Flow window.');
}

function extensionFor(mime, kind) {
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  return kind === 'image' ? 'png' : 'mp4';
}

async function uploadToSupabase(bytes, mime, kind, token, user, cfg) {
  if (!bytes || !bytes.length) throw new Error('Flow returned an empty file.');
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error('The generated file is larger than the 45 MB upload limit for this Glitch worker.');
  }
  const filename = 'flow-' + randomUUID() + '.' + extensionFor(mime, kind);
  const objectPath = user.id + '/' + filename;
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const headers = {
    apikey: cfg.anon,
    Authorization: 'Bearer ' + token,
    'Content-Type': mime,
    'x-upsert': 'false'
  };
  const upload = await fetch(cfg.url + '/storage/v1/object/glitch-media/' + encodedPath, {
    method: 'POST', headers, body: bytes, signal: AbortSignal.timeout(90000)
  });
  if (!upload.ok) {
    const detail = await upload.text().catch(() => '');
    if (upload.status === 404) throw new Error('The glitch-media Storage bucket is missing. Run the SQL setup included at the top of flow-worker.js.');
    if (upload.status === 403) throw new Error('Supabase blocked this upload. Run the glitch-media Storage policies from flow-worker.js in Supabase SQL Editor.');
    throw new Error('Supabase media upload failed (' + upload.status + '): ' + detail.slice(0, 240));
  }
  const signed = await fetch(cfg.url + '/storage/v1/object/sign/glitch-media/' + encodedPath, {
    method: 'POST',
    headers: { apikey: cfg.anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 30 }),
    signal: AbortSignal.timeout(20000)
  });
  if (!signed.ok) throw new Error('The media was uploaded, but Supabase could not create a private viewing link. Check the Storage read policy.');
  const signedData = await signed.json();
  const signedPath = String(signedData.signedURL || '');
  if (!signedPath) throw new Error('Supabase returned no signed media URL.');
  const url = /^https?:\/\//i.test(signedPath) ? signedPath : cfg.url + '/storage/v1' + (signedPath.startsWith('/') ? signedPath : '/' + signedPath);
  return { url, storagePath: objectPath, mime };
}

async function generateWithFlow(kind, prompt, token, user, cfg) {
  const page = await getFlowPage();
  await ensureFlowSignedIn(page);

  let promptBox = await findPromptBox(page);
  if (!promptBox) {
    const newProject = page.getByRole('button', { name: /new project|create project|start project/i }).first();
    if (await newProject.count().catch(() => 0) && await newProject.isVisible().catch(() => false)) {
      await newProject.click();
      await page.waitForTimeout(2500);
      promptBox = await findPromptBox(page);
    }
  }
  if (!promptBox) {
    throw new Error('Could not find Google Flow’s prompt box. Open a Flow project in the Chrome window and retry.');
  }

  const agentButton = page.getByRole('button', { name: /^agent$/i }).last();
  if (await agentButton.count().catch(() => 0) && await agentButton.isVisible().catch(() => false)) {
    const pressed = await agentButton.getAttribute('aria-pressed').catch(() => null);
    if (pressed === 'false') await agentButton.click().catch(() => {});
  }

  const before = await mediaSnapshot(page, kind);
  const instruction = 'Generate a ' + kind + ' now in this Google Flow project using this exact creative brief. Do not only rewrite the prompt; create the finished ' + kind + '.\n\n' + prompt;
  await promptBox.fill(instruction);
  await promptBox.press('Enter');
  const media = await waitForGeneratedMedia(page, kind, before);
  const extracted = await extractMedia(page, media, kind);
  const stored = await uploadToSupabase(extracted.bytes, extracted.mime, kind, token, user, cfg);
  return { ok: true, kind, provider: 'Google Flow', url: stored.url, storagePath: stored.storagePath, mime: stored.mime };
}

const server = http.createServer(async (req, res) => {
  if (!setCors(req, res)) return sendJson(res, 403, { error: 'This local worker only accepts requests from Glitch.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'Glitch Flow Worker', browserOpen: !!context, flowUrl: FLOW_URL });
  }
  if (req.method !== 'POST' || pathname !== '/generate') {
    return sendJson(res, 404, { error: 'Not found.' });
  }
  if (busy) return sendJson(res, 409, { error: 'The Flow browser is already generating another item. Wait for it to finish.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return sendJson(res, 401, { error: 'Sign in to Glitch before generating media.' });

  let body;
  try { body = await readJson(req); }
  catch (error) { return sendJson(res, 400, { error: error.message }); }
  const kind = body.kind === 'video' ? 'video' : body.kind === 'image' ? 'image' : '';
  const prompt = String(body.prompt || '').trim().slice(0, 5000);
  if (!kind || prompt.length < 5) return sendJson(res, 400, { error: 'Choose image or video and provide a prompt of at least five characters.' });

  busy = true;
  try {
    const { user, cfg } = await verifyVipUser(token);
    const result = await generateWithFlow(kind, prompt, token, user, cfg);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.status || 502, { error: error.message || 'Google Flow generation failed.' });
  } finally {
    busy = false;
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('Glitch Flow Worker is listening on http://127.0.0.1:' + PORT);
  console.log('Google Flow URL: ' + FLOW_URL);
  console.log('Chrome profile: ' + PROFILE_DIR);
  console.log('Open Glitch in this same browser/PC. The worker will open Chrome on the first generation.');
  console.log('Sign in to Google manually once if Flow asks. Your password is never read or stored by this worker.');
  console.log('Keep this terminal running while you use Glitch.');
  console.log('');
});

process.on('SIGINT', async () => {
  try { if (context) await context.close(); } catch {}
  server.close(() => process.exit(0));
});
