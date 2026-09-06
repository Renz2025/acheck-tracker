/* Maintenance Check Tracker — service worker
   Bump SW_VERSION only when a cached ASSET changes
   (sql-wasm.js/.wasm, xlsx.full.min.js, icons, manifest).
   index.html is network-first, so ordinary edits need no bump. */
const SW_VERSION = 'v1';
const CACHE = 'acheck-tracker-' + SW_VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './sql-wasm.js',
  './sql-wasm.wasm',
  './xlsx.full.min.js',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

/* install: pre-cache the shell, one file at a time so a single
   404 does not abort the whole install */
self.addEventListener('install', (ev)=>{
  ev.waitUntil((async ()=>{
    const c = await caches.open(CACHE);
    for (const url of ASSETS){
      try{
        await c.add(new Request(url, { cache: 'reload' }));
      }catch(err){
        console.warn('[sw] could not cache ' + url + ': ' + err.message);
      }
    }
  })());
});

/* activate: bin every cache that is not the current version */
self.addEventListener('activate', (ev)=>{
  ev.waitUntil((async ()=>{
    const names = await caches.keys();
    await Promise.all(names.map(n=>{
      if (n.startsWith('acheck-tracker-') && n !== CACHE) return caches.delete(n);
      return null;
    }));
    await self.clients.claim();
  })());
});

/* let the page trigger an immediate takeover */
self.addEventListener('message', (ev)=>{
  if (ev.data === 'skip-waiting') self.skipWaiting();
});

const isDoc = (req)=>
  req.mode === 'navigate' ||
  req.destination === 'document' ||
  (req.headers.get('accept') || '').includes('text/html');

self.addEventListener('fetch', (ev)=>{
  const req = ev.request;

  if (req.method !== 'GET') return;                       // never touch writes
  if (new URL(req.url).origin !== self.location.origin) return;  // ignore cross-origin

  /* HTML: network-first with a 4s timeout, cache as fallback.
     Keeps ordinary index.html edits appearing on a plain reload. */
  if (isDoc(req)){
    ev.respondWith((async ()=>{
      const c = await caches.open(CACHE);
      try{
        const net = await Promise.race([
          fetch(req),
          new Promise((_, rej)=> setTimeout(()=> rej(new Error('slow')), 4000))
        ]);
        if (net && net.ok) c.put('./index.html', net.clone());
        return net;
      }catch(err){
        return (await c.match('./index.html')) ||
               (await c.match(req)) ||
               new Response('<h1>Offline</h1><p>Open the app once while online.</p>',
                            { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  /* everything else: cache-first, fall back to network, then store it */
  ev.respondWith((async ()=>{
    const c   = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try{
      const net = await fetch(req);
      if (net && net.ok && net.type === 'basic') c.put(req, net.clone());
      return net;
    }catch(err){
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
