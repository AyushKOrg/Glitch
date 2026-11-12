const CACHE='glitch-pwa-v2';
const SHELL=['/','/manifest.webmanifest','/css/styles.css','/js/app.js','/js/theme-init.js','/vendor/supabase.js','/logo.png','/logo-light.png','/favicon.ico','/apple-touch-icon-180.png','/android-touch-icon-512.png'];
const APP_FILES=new Set(['/','/index.html','/css/styles.css','/js/app.js','/js/theme-init.js','/vendor/supabase.js']);
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('glitch-pwa-')&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  // Always check the network for the HTML and executable app shell. This prevents
  // an installed phone/PWA from running an old auth bundle after a deployment.
  if(request.mode==='navigate'||APP_FILES.has(url.pathname)){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request,{cache:'no-store'});
        if(response&&response.ok){
          const cache=await caches.open(CACHE);
          await cache.put(request.mode==='navigate'?'/':request,response.clone());
        }
        return response;
      }catch(error){
        const cached=await caches.match(request)||await caches.match(request.mode==='navigate'?'/':url.pathname);
        if(cached)return cached;
        throw error;
      }
    })());
    return;
  }
  event.respondWith((async()=>{
    const cached=await caches.match(request);
    if(cached)return cached;
    const response=await fetch(request);
    if(response&&response.ok){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}
    return response;
  })());
});
