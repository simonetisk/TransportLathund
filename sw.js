// TransportLathund – kartcache (service worker)
// Sparar kartrutor, typsnitt och kartbibliotek i webbläsaren, så att kartan inte behöver
// laddas ner igen när man panorerar tillbaka eller zoomar ut och in. Gör stor skillnad
// med långsam uppkoppling. Appens egna filer (html/js/css) cachas INTE här, så nya
// versioner av sidan slår alltid igenom direkt.
//
// Fungerar bara när sidan körs från en webbadress (t.ex. GitHub Pages), inte via file://.
// Registreras i app.js.

const CACHE = 'tl-karta-v1';
const MAX_ENTRIES = 6000;           // ungefär 100–300 MB beroende på karta; äldsta tas bort först
const TRIM_EVERY = 200;             // städa efter så här många nya rutor

// Vad som cachas, och hur:
//  'cache'   = ta från cachen om den finns, annars nätet (kartrutor, typsnitt, bibliotek med fast version)
//  'network' = nätet först, cachen om nätet inte svarar (kartstilar som kan uppdateras)
function strategy(url) {
  const u = new URL(url);
  if (u.hostname === 'server.arcgisonline.com' && u.pathname.includes('/tile/')) return 'cache';
  if (u.hostname === 'tiles.openfreemap.org') {
    if (/\.(pbf|png|jpg|webp)$/.test(u.pathname) || u.pathname.startsWith('/fonts/') || u.pathname.startsWith('/sprites/')) return 'cache';
    return 'network';   // stilar och tilejson
  }
  if (u.hostname === 'unpkg.com' && /@\d/.test(u.pathname)) return 'cache';                       // versionslåsta bibliotek
  if (u.hostname === 'cdnjs.cloudflare.com' && /\/\d+\.\d+/.test(u.pathname)) return 'cache';
  return null;   // allt annat går direkt till nätet som vanligt
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  // Ta bort gamla cacheversioner
  for (const k of await caches.keys()) if (k.startsWith('tl-karta-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

let added = 0;
async function trim(cache) {
  const keys = await cache.keys();   // i den ordning de lades till
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

// Sparar bara fullständiga, lyckade svar (inte "opaka" svar, som tar orimligt mycket plats)
async function store(cache, req, res) {
  if (!res || !res.ok || res.type === 'opaque') return;
  await cache.put(req, res);
  if (++added % TRIM_EVERY === 0) trim(cache);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const how = strategy(req.url);
  if (!how) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (how === 'cache') {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      e.waitUntil(store(cache, req, res.clone()));
      return res;
    }
    try {
      const res = await fetch(req);
      e.waitUntil(store(cache, req, res.clone()));
      return res;
    } catch (err) {
      const hit = await cache.match(req);
      if (hit) return hit;
      throw err;
    }
  })());
});
