// TransportLathund – ruttplanering (AVSTÄNGD för tillfället)
//
// Slå på igen genom att lägga till följande rad i index.html, efter places.js:
//   <script src="route.js"></script>
// Filen skapar själv sin menyknapp och sitt ruttkort.
//
// Ruttberäkning: OSRM demo-server (router.project-osrm.org), personbil.

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const SAVED_KEY = 'transportlathund.saved';
const ROUTE_OPEN_KEY = 'transportlathund.routeopen';

// ---------- Gränssnitt: menyknapp och ruttkort ----------
(function buildRouteUi() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.route = '1';
  btn.textContent = '🧭 Rutt';
  btn.onclick = () => setRouteOpen(document.getElementById('routePanel').hidden);
  document.querySelector('.menubar .brand').after(btn);

  const panel = document.createElement('aside');
  panel.id = 'routePanel';
  panel.className = 'floatcard';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="card-head"><h2>🧭 Rutt</h2><button type="button" id="routeClose" class="icon" title="Stäng">✕</button></div>
    <div id="stops"></div>
    <div class="row">
      <button id="addStop" type="button">+ Lägg till stopp</button>
      <button id="clearAll" type="button" class="secondary">Rensa</button>
    </div>
    <p class="hint">Skriv en adress eller ett platsnamn och välj ett förslag, eller klicka på 📍 och sedan i kartan. Markörerna kan dras.</p>
    <div id="summary" hidden></div>
    <div id="legs"></div>
    <h3>Sparade adresser</h3>
    <ul id="saved"></ul>
    <p class="hint small">Spara med ☆ bredvid ett fält.</p>`;
  document.body.append(panel);
  document.getElementById('routeClose').onclick = () => setRouteOpen(false);
})();

function setRouteOpen(open) {
  document.getElementById('routePanel').hidden = !open;
  document.querySelector('[data-route]').classList.toggle('active', open);
  try { localStorage.setItem(ROUTE_OPEN_KEY, open ? '1' : '0'); } catch { /* ignoreras */ }
}

const routeLayer = L.layerGroup().addTo(map);

// ---------- State ----------
// stop = { id, label, text, lat, lon, marker }
let stops = [];
let nextId = 1;
let pickingId = null;
let routes = [];
let activeRoute = 0;

function newStop(label) {
  return { id: nextId++, label, text: '', lat: null, lon: null, marker: null };
}
stops.push(newStop('Avsändare'), newStop('Mottagare'));

// Anropas från places.js när man börjar välja en plats i kartan
function cancelRoutePick() {
  if (!pickingId) return;
  pickingId = null;
  renderStops();
}

function colorFor(index) {
  if (index === 0) return '#2e9e5b';
  if (index === stops.length - 1) return '#c0392b';
  return '#1f6feb';
}
function labelFor(index) {
  if (index === 0) return 'Avsändare';
  if (index === stops.length - 1) return 'Mottagare';
  return `Stopp ${index}`;
}
function fmtDist(m) { return m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`; }
function fmtTime(s) {
  const hh = Math.floor(s / 3600), min = Math.round((s % 3600) / 60);
  return hh ? `${hh} h ${min} min` : `${min} min`;
}

// ---------- Sparade adresser ----------
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; }
}
function storeSaved(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* ignoreras */ }
}
function getSavedSuggestions(q) {
  return loadSaved()
    .filter(s => q.length < 2 || s.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 3)
    .map(s => ({ main: '★ ' + s.name, place: s.text, full: s.text, lat: s.lat, lon: s.lon }));
}
async function saveStop(stop) {
  if (stop.lat == null) return;
  const name = await uiPrompt('Namn på adressen (t.ex. "Lagret Västberga"):', stop.text);
  if (name === null) return;
  const list = loadSaved();
  list.push({ name: name || stop.text, text: stop.text, lat: stop.lat, lon: stop.lon });
  storeSaved(list);
  renderSaved();
}

function renderSaved() {
  const ul = document.getElementById('saved');
  const list = loadSaved();
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = '<li><span class="hint">Inga sparade adresser ännu.</span></li>';
    return;
  }
  list.forEach((s, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = s.name;
    span.title = s.text;
    const use = document.createElement('button');
    use.textContent = 'Använd';
    use.className = 'icon';
    use.onclick = () => {
      const target = stops.find(st => st.lat == null) || stops[stops.length - 1];
      setStopLocation(target, s.lat, s.lon, s.text);
    };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.className = 'icon';
    del.title = 'Ta bort';
    del.onclick = () => { list.splice(i, 1); storeSaved(list); renderSaved(); };
    li.append(span, use, del);
    ul.appendChild(li);
  });
}

// ---------- Stopp-fält ----------
function renderStops() {
  const container = document.getElementById('stops');
  container.innerHTML = '';

  stops.forEach((stop, index) => {
    stop.label = labelFor(index);
    const wrap = document.createElement('div');
    wrap.className = 'stop';

    const label = document.createElement('label');
    label.innerHTML = `<span class="dot" style="background:${colorFor(index)}"></span>${stop.label}`;

    const row = document.createElement('div');
    row.className = 'inputrow';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Sök adress…';
    input.value = stop.text;
    input.autocomplete = 'off';
    if (stop.lat != null) input.classList.add('ok');
    if (pickingId === stop.id) input.classList.add('picking');

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'icon' + (pickingId === stop.id ? ' active' : '');
    pick.textContent = '📍';
    pick.title = 'Välj i kartan';
    pick.onclick = () => {
      if (typeof setPlacePicking === 'function') setPlacePicking(false);
      pickingId = pickingId === stop.id ? null : stop.id;
      map.getContainer().style.cursor = pickingId ? 'crosshair' : '';
      renderStops();
    };

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'icon';
    save.textContent = '☆';
    save.title = 'Spara adress';
    save.disabled = stop.lat == null;
    save.onclick = () => saveStop(stop);

    row.append(input, pick, save);

    if (index !== 0 && index !== stops.length - 1) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'icon';
      rm.textContent = '✕';
      rm.title = 'Ta bort stopp';
      rm.onclick = () => removeStop(stop);
      row.appendChild(rm);
    }

    wrap.append(label, row);
    attachAutocomplete(input, wrap,
      r => setStopLocation(stop, r.lat, r.lon, r.full),
      () => {
        stop.text = input.value;
        stop.lat = stop.lon = null;
        input.classList.remove('ok');
      });
    container.appendChild(wrap);
  });

  updateMarkers();
}

function setStopLocation(stop, lat, lon, text) {
  stop.lat = lat;
  stop.lon = lon;
  stop.text = text;
  renderStops();
  fitToStops();
  calculateRoute();
}

// Används av platsernas popup ("Som avsändare / mottagare") om man vill återinföra det
function usePlaceInRoute(p, which) {
  map.closePopup();
  setRouteOpen(true);
  const stop = which === 'from' ? stops[0] : stops[stops.length - 1];
  setStopLocation(stop, p.lat, p.lon, p.address ? `${p.name}, ${p.address}` : p.name);
}

function removeStop(stop) {
  if (stop.marker) map.removeLayer(stop.marker);
  stops = stops.filter(s => s !== stop);
  renderStops();
  calculateRoute();
}

// ---------- Markörer ----------
function updateMarkers() {
  stops.forEach((stop, index) => {
    if (stop.lat == null) {
      if (stop.marker) { map.removeLayer(stop.marker); stop.marker = null; }
      return;
    }
    const icon = L.divIcon({
      className: '',
      html: `<div style="background:${colorFor(index)};width:26px;height:26px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font:bold 12px/20px system-ui;text-align:center">${index === 0 ? 'A' : index === stops.length - 1 ? 'B' : index}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
    if (!stop.marker) {
      stop.marker = L.marker([stop.lat, stop.lon], { draggable: true, icon }).addTo(map);
      stop.marker.on('dragend', async e => {
        const { lat, lng } = e.target.getLatLng();
        stop.lat = lat; stop.lon = lng;
        stop.text = await reverseGeocode(lat, lng);
        renderStops();
        calculateRoute();
      });
    } else {
      stop.marker.setLatLng([stop.lat, stop.lon]);
      stop.marker.setIcon(icon);
    }
    stop.marker.bindTooltip(`${stop.label}: ${stop.text}`);
  });
}

function fitToStops() {
  const pts = stops.filter(s => s.lat != null).map(s => [s.lat, s.lon]);
  if (pts.length === 1) map.setView(pts[0], 14);
  else if (pts.length > 1) {
    const panel = document.getElementById('routePanel');
    const left = panel && !panel.hidden && window.innerWidth > 760 ? panel.offsetWidth + 40 : 40;
    map.fitBounds(pts, { paddingTopLeft: [left, 130], paddingBottomRight: [40, 40] });
  }
}

map.on('click', async e => {
  if (!pickingId) return;
  const stop = stops.find(s => s.id === pickingId);
  pickingId = null;
  map.getContainer().style.cursor = '';
  if (!stop) return;
  const { lat, lng } = e.latlng;
  stop.lat = lat; stop.lon = lng;
  stop.text = 'Hämtar adress…';
  renderStops();
  stop.text = await reverseGeocode(lat, lng);
  renderStops();
  calculateRoute();
});

// ---------- Rutt ----------
async function calculateRoute() {
  routeLayer.clearLayers();
  const summary = document.getElementById('summary');
  const legsEl = document.getElementById('legs');
  legsEl.innerHTML = '';
  routes = [];

  const located = stops.filter(s => s.lat != null);
  if (located.length < 2 || located.length !== stops.length) {
    summary.hidden = true;
    return;
  }

  summary.hidden = false;
  summary.innerHTML = 'Beräknar rutt…';

  const coords = located.map(s => `${s.lon},${s.lat}`).join(';');
  const alternatives = located.length === 2 ? 'true' : 'false';
  const url = `${OSRM}/${coords}?overview=full&geometries=geojson&alternatives=${alternatives}&steps=false`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error(data.message || data.code);
    routes = data.routes;
    activeRoute = 0;
    drawRoutes();
  } catch (err) {
    summary.innerHTML = `<div class="error">Kunde inte beräkna rutt: ${escapeHtml(err.message)}</div>`;
  }
}

function drawRoutes() {
  routeLayer.clearLayers();
  routes.forEach((r, i) => {
    if (i === activeRoute) return;
    const line = L.geoJSON(r.geometry, { style: { color: '#8a96a3', weight: 5, opacity: 0.7 } }).addTo(routeLayer);
    line.on('click', () => { activeRoute = i; drawRoutes(); });
    line.bindTooltip(`Alternativ: ${fmtDist(r.distance)}, ${fmtTime(r.duration)}`);
  });
  const r = routes[activeRoute];
  L.geoJSON(r.geometry, { style: { color: '#1f6feb', weight: 6, opacity: 0.9 } }).addTo(routeLayer);

  const summary = document.getElementById('summary');
  summary.innerHTML = `<strong>${fmtDist(r.distance)}</strong> · ${fmtTime(r.duration)}<div class="hint small">Uppskattad körtid för personbil (OSRM).</div>`;
  if (routes.length > 1) {
    const alts = document.createElement('div');
    alts.className = 'alts';
    routes.forEach((rt, i) => {
      const b = document.createElement('button');
      b.className = i === activeRoute ? '' : 'secondary';
      b.textContent = `Rutt ${i + 1}: ${fmtDist(rt.distance)}, ${fmtTime(rt.duration)}`;
      b.onclick = () => { activeRoute = i; drawRoutes(); };
      alts.appendChild(b);
    });
    summary.appendChild(alts);
  }

  const legsEl = document.getElementById('legs');
  legsEl.innerHTML = '';
  if (r.legs.length > 1) {
    r.legs.forEach((leg, i) => {
      const d = document.createElement('div');
      d.textContent = `${stops[i].label} → ${stops[i + 1].label}: ${fmtDist(leg.distance)}, ${fmtTime(leg.duration)}`;
      legsEl.appendChild(d);
    });
  }
}

// ---------- Knappar ----------
document.getElementById('addStop').onclick = () => {
  stops.splice(stops.length - 1, 0, newStop(''));
  renderStops();
};

document.getElementById('clearAll').onclick = () => {
  stops.forEach(s => s.marker && map.removeLayer(s.marker));
  stops = [newStop('Avsändare'), newStop('Mottagare')];
  pickingId = null;
  map.getContainer().style.cursor = '';
  renderStops();
  calculateRoute();
};

// ---------- Start ----------
renderStops();
renderSaved();
setRouteOpen(localStorage.getItem(ROUTE_OPEN_KEY) === '1');
