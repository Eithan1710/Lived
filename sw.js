/* Lived service worker
   - The page and config.js: network first (always the latest), cached copy when offline.
   - Icons / manifest: cache first.
   - Only this site's own files. Google APIs, sign-in, fonts and the AI endpoint are never intercepted. */
const CACHE = 'lived-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e)=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html') || url.pathname.endsWith('/config.js');
  if(fresh){
    e.respondWith(
      fetch(req).then(res=>{
        if(res && res.ok){ const copy = res.clone(); caches.open(CACHE).then(c=>c.put(req, copy)); }
        return res;
      }).catch(()=>caches.match(req).then(r=>r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(cached=>cached || fetch(req).then(res=>{
      if(res && res.ok){ const copy = res.clone(); caches.open(CACHE).then(c=>c.put(req, copy)); }
      return res;
    }))
  );
});
