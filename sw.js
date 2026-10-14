/* Offline cache contains app assets only; no lyrics or recordings leave the device. */
const CACHE='voice-atelier-song-studio-v0.3.2';
const FILES=['./','./index.html','./styles.css','./app.js','./capture-worklet.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('voice-atelier-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  e.respondWith((async()=>{
    try{const response=await fetch(e.request);if(response.ok&&FILES.some(f=>new URL(f,self.registration.scope).href===e.request.url)){
      const cache=await caches.open(CACHE);await cache.put(e.request,response.clone());
    }return response;
    }catch(err){const cached=await caches.match(e.request);if(cached)return cached;throw err;}
  })());
});
