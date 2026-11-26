// TransportLathund – kärna: karta, kartstilar, adressökning och förslagslistor
// Allt körs i webbläsaren. Externa tjänster:
//   Kartbilder:  Esri (fungerar utan nyckel även när sidan öppnas som fil)
//   Geokodning:  Photon (photon.komoot.io), med Nominatim (OpenStreetMap) som reserv vid import

const PHOTON = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const LAYER_KEY = 'transportlathund.layer';
const THEME_KEY = 'transportlathund.theme';

// Sveriges utsträckning (lite marginal). Används för kartgränser och adressökning.
const SWEDEN_BOUNDS = L.latLngBounds([54.9, 10.4], [69.2, 24.4]);
const SWEDEN_BBOX = '10.4,54.9,24.4,69.2'; // minLon,minLat,maxLon,maxLat (Photon)
// Startvy när sidan laddas: Västerbottens län
const START_BOUNDS = L.latLngBounds([63.45, 14.35], [66.0, 21.5]);
// Hur långt utanför Sverige man får panorera (andel av Sveriges storlek på varje sida).
// 0.3 ≈ 4 grader (~300–400 km), så platser nära gränsen kan ligga mitt på skärmen.
const PAN_MARGIN = 0.3;

// ---------- Tema (mörkt som standard) ----------
function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignoreras */ }
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.innerHTML = `<i class="fa-solid fa-${theme === 'dark' ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
    btn.title = theme === 'dark' ? 'Byt till ljust tema' : 'Byt till mörkt tema';
  }
}
setTheme(getTheme());
document.getElementById('themeToggle').onclick = () => setTheme(getTheme() === 'dark' ? 'light' : 'dark');

// ---------- Karta ----------
const map = L.map('map', {
  maxBounds: SWEDEN_BOUNDS.pad(PAN_MARGIN),
  maxBoundsViscosity: 0.8, // mjuk kant: kartan bromsar och studsar tillbaka i stället för att tvärstanna
  maxZoom: 19, // behövs av klustringen (utfällning sker vid maxzoom)
  zoomControl: false
});
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Lägsta zoom = den zoom där hela Sverige precis får plats i fönstret.
function updateMinZoom() {
  map.setMinZoom(map.getBoundsZoom(SWEDEN_BOUNDS));
}
updateMinZoom();
// Utfyllnad uppe så att länet inte hamnar under menyraden
// Kvartszoom bara här, så länet fyller skärmen; sedan hela zoomsteg igen
// (första zoomningen rundar av till närmaste heltal).
map.options.zoomSnap = 0.25;
map.fitBounds(START_BOUNDS, { paddingTopLeft: [20, 110], paddingBottomRight: [20, 20] });
map.options.zoomSnap = 1;
map.on('resize', updateMinZoom);

// Kartstilar. OSM:s och CARTO:s tile-servrar blockerar sidor som öppnas via file://
// (ingen Referer), därför används Esris kartor, som fungerar utan nyckel.
// Inställningarna gör att färre rutor laddas om: fler rutor runt skärmen sparas (keepBuffer)
// och nya hämtas först när man slutat zooma/panorera, vilket är lättare för långsamma datorer.
// Bara rutor som ligger (delvis) inom Sveriges ruta hämtas.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const esri = (service, extra = {}) =>
  L.tileLayer(`${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 19,
    attribution: 'Kartor &copy; Esri, HERE, Garmin, &copy; OpenStreetMap-bidragsgivare',
    crossOrigin: true,        // så att kartcachen (sw.js) kan spara rutorna
    bounds: SWEDEN_BOUNDS,    // hämta bara rutor runt Sverige
    keepBuffer: 4,
    updateWhenZooming: false,
    updateWhenIdle: true,
    ...extra
  });
// Enkla bildkartor: reserv om vektorkartan inte går att ladda (se vectormap.js)
const esriCanvas = tone => L.layerGroup([
  esri(`Canvas/World_${tone}_Gray_Base`, { maxNativeZoom: 16 }),
  esri(`Canvas/World_${tone}_Gray_Reference`, { maxNativeZoom: 16 })
]);

const baseLayers = {};
if (typeof VECTOR_LAYERS === 'object') {
  baseLayers['Vektor mörk'] = VECTOR_LAYERS['Vektor mörk'].setFallback(esriCanvas('Dark'));
  baseLayers['Vektor ljus'] = VECTOR_LAYERS['Vektor ljus'].setFallback(esriCanvas('Light'));
} else {
  // vectormap.js saknas: använd bildkartorna direkt
  baseLayers['Vektor mörk'] = esriCanvas('Dark');
  baseLayers['Vektor ljus'] = esriCanvas('Light');
}
baseLayers['Satellit'] = L.layerGroup([
  esri('World_Imagery', { attribution: 'Bilder &copy; Esri, Maxar, Earthstar Geographics' }),
  esri('Reference/World_Boundaries_and_Places')
]);

let startLayer = 'Vektor mörk';
try { const s = localStorage.getItem(LAYER_KEY); if (s && baseLayers[s]) startLayer = s; } catch { /* ignoreras */ }
baseLayers[startLayer].addTo(map);
// Uppe till höger sitter sparstatusen, så kartväljaren ligger nere till höger
L.control.layers(baseLayers, null, { position: 'bottomright' }).addTo(map);
map.on('baselayerchange', e => {
  try { localStorage.setItem(LAYER_KEY, e.name); } catch { /* ignoreras */ }
});

// ---------- Hjälpfunktioner ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- Geokodning ----------
function formatPhotonFeature(f) {
  const p = f.properties;
  const street = [p.street || p.name, p.housenumber].filter(Boolean).join(' ');
  const main = p.name && p.street && p.name !== p.street ? `${p.name}, ${street}` : (street || p.name || '');
  const place = [p.postcode, p.city || p.town || p.village || p.county].filter(Boolean).join(' ');
  return {
    main, place, full: [main, place].filter(Boolean).join(', '),
    housenumber: p.housenumber || '',
    type: p.type || '',                 // Photon: house, street, city, district, postcode …
    isStreet: p.osm_key === 'highway' || p.type === 'street'   // träffen är en hel väg, inte en adresspunkt
  };
}

// Husnumret i en adress, t.ex. "Försörjningsvägen 1C, 907 37 Umeå" → "1C"
function houseNumberOf(addr) {
  const m = String(addr || '').split(',')[0].trim().match(/\s(\d+\s?[a-zA-Z]?)$/);
  return m ? m[1].replace(/\s/g, '').toUpperCase() : '';
}

// Hur exakt en sökträff är: '' = exakt adress, 'street' = bara vägen, 'area' = bara ort/område
function approxOf(hit, wantedNumber) {
  const hn = String(hit.housenumber || '').replace(/\s/g, '').toUpperCase();
  if (hn) return !wantedNumber || hn === wantedNumber ? '' : 'street';
  if (hit.isStreet) return 'street';
  if (['city', 'district', 'locality', 'county', 'state', 'country', 'postcode', 'other'].includes(hit.type)) return 'area';
  return wantedNumber ? 'street' : '';   // t.ex. en namngiven byggnad utan husnummer
}

// Söker upp en adress och provar enklare varianter om den inte hittas:
// hela adressen → utan husnummer → utan postnummer → bara orten.
// Returnerar { lat, lon, approx } eller null.
// Svaren sparas under sidans livstid, så samma adress bara söks upp en gång
// (importen förhandshämtar alla adresser parallellt och läser sedan härifrån).
const geocodeCache = new Map();
function geocodeWithFallback(addr) {
  const key = String(addr).trim().toLowerCase();
  if (!geocodeCache.has(key)) {
    const p = geocodeUncached(addr);
    geocodeCache.set(key, p);
    p.catch(() => geocodeCache.delete(key));   // nätverksfel: försök igen nästa gång
  }
  return geocodeCache.get(key);
}

async function geocodeUncached(addr) {
  const parts = String(addr).split(',').map(s => s.trim()).filter(Boolean);
  const first = parts[0] || '';
  const num = houseNumberOf(addr);
  const street = num ? first.replace(/\s\d+\s?[a-zA-Z]?$/, '').trim() : first;
  const rest = parts.slice(1);
  const restNoZip = rest.map(s => s.replace(/\b\d{3}\s?\d{2}\b/, '').trim()).filter(Boolean);
  const attempts = [
    { q: addr },
    { q: [street, ...rest].join(', ') },
    { q: [street, ...restNoZip].join(', ') },
    { q: rest.join(', '), area: true },
    { q: restNoZip.join(', '), area: true }
  ].filter((a, i, all) => a.q && all.findIndex(b => b.q === a.q) === i);

  for (const a of attempts) {
    const hits = await lookupAddress(a.q);
    if (!hits.length) continue;
    const hit = hits[0];
    return { lat: hit.lat, lon: hit.lon, approx: a.area ? 'area' : approxOf(hit, num) };
  }
  return null;
}

// fetch som ger upp efter en stund i stället för att hänga när en tjänst inte svarar
async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(t); }
}

// Om Photon inte svarar används Nominatim en stund (5 min) innan Photon provas igen.
let photonDownUntil = 0;
async function lookupAddress(q) {
  if (Date.now() >= photonDownUntil) {
    try {
      const hits = await searchAddress(q, 1);
      await new Promise(r => setTimeout(r, 120));   // var snäll mot den fria söktjänsten
      return hits;
    } catch {
      photonDownUntil = Date.now() + 5 * 60 * 1000;
    }
  }
  return searchNominatim(q);
}

// Nominatim tillåter högst ett anrop per sekund, så anropen ställs i kö.
// (Används bara för enstaka uppslag och import, inte för förslag medan man skriver – det förbjuder Nominatims regler.)
let nominatimQueue = Promise.resolve();
function searchNominatim(q) {
  const run = nominatimQueue.then(async () => {
    const b = map.getBounds();   // föredra träffar i det område kartan visar
    const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=se&accept-language=sv` +
      `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&q=${encodeURIComponent(q)}`;
    try {
      const res = await fetchWithTimeout(url, 10000);
      if (!res.ok) throw new Error('Adressökning misslyckades');
      return (await res.json()).map(formatNominatimResult);
    } finally {
      await new Promise(r => setTimeout(r, 1100));
    }
  });
  nominatimQueue = run.catch(() => {});
  return run;
}

const NOMINATIM_AREA = ['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state', 'country', 'postcode', 'suburb', 'quarter', 'neighbourhood', 'city_district'];
function formatNominatimResult(r) {
  const a = r.address || {};
  const road = a.road || a.pedestrian || a.footway || '';
  const main = [road || r.name, a.house_number].filter(Boolean).join(' ');
  const place = [a.postcode, a.city || a.town || a.village || a.municipality].filter(Boolean).join(' ');
  return {
    main, place, full: [main, place].filter(Boolean).join(', '),
    housenumber: a.house_number || '',
    type: NOMINATIM_AREA.includes(r.addresstype) ? 'city' : (r.addresstype || ''),
    isStreet: !a.house_number && (r.category === 'highway' || r.addresstype === 'road'),
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon)
  };
}

async function searchAddress(q, limit = 6) {
  const c = map.getCenter();
  // bbox begränsar till Sveriges ruta; filtret på landskod tar bort träffar i
  // grannländer som råkar ligga inom rutan (Norge, Finland, Danmark).
  const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=12&bbox=${SWEDEN_BBOX}&lat=${c.lat}&lon=${c.lng}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error('Adressökning misslyckades');
  const data = await res.json();
  return data.features
    .filter(f => f.properties.countrycode === 'SE')
    .slice(0, limit)
    .map(f => ({
      ...formatPhotonFeature(f),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0]
    }));
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetchWithTimeout(`${PHOTON}/reverse?lat=${lat}&lon=${lon}`, 5000);
    const data = await res.json();
    if (data.features && data.features.length) return formatPhotonFeature(data.features[0]).full;
  } catch (e) { /* faller tillbaka på koordinater */ }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// ---------- Förslagslista under adressfält ----------
// onChoose(r) anropas när ett förslag väljs, onEdit() när användaren skriver (valfri).
// Egna platser (places.js) och ev. sparade adresser (route.js) visas före sökträffarna.
function attachAutocomplete(input, wrap, onChoose, onEdit) {
  let list = null;
  let results = [];
  let sel = -1;

  const close = () => { if (list) { list.remove(); list = null; } sel = -1; };

  const show = () => {
    close();
    const own = typeof getPlaceSuggestions === 'function' ? getPlaceSuggestions(input.value) : [];
    const saved = typeof getSavedSuggestions === 'function' ? getSavedSuggestions(input.value) : [];
    const all = [...own, ...saved, ...results];
    if (!all.length) return;
    list = document.createElement('ul');
    list.className = 'suggestions';
    all.forEach((r, i) => {
      const li = document.createElement('li');
      li.innerHTML = `${r.iconHtml || ''}${escapeHtml(r.main)}<small>${escapeHtml(r.place)}</small>`;
      li.onmousedown = e => { e.preventDefault(); choose(r); };
      if (i === sel) li.classList.add('sel');
      list.appendChild(li);
    });
    list._items = all;
    wrap.appendChild(list);
  };

  const choose = r => {
    close();
    onChoose(r);
  };

  const doSearch = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 3) { results = []; show(); return; }
    try { results = await searchAddress(q); } catch { results = []; }
    if (document.activeElement === input) show();
  }, 300);

  input.addEventListener('input', () => {
    if (onEdit) onEdit();
    doSearch();
  });
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', e => {
    if (!list) return;
    const items = list._items;
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(items[Math.max(sel, 0)]); e.preventDefault(); return; }
    else if (e.key === 'Escape') { close(); e.preventDefault(); return; } // stänger bara listan, inte dialogen
    else return;
    [...list.children].forEach((li, i) => li.classList.toggle('sel', i === sel));
  });
}

// ---------- Kartcache ----------
// sw.js sparar kartrutor lokalt så att de inte laddas ner igen (bara när sidan körs från en webbadress)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('Kartcachen kunde inte startas:', e)));
}
