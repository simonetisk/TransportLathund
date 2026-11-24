// TransportLathund – platser, kategorier, flöden, tider och kontakter
// Laddas efter app.js och använder dess globala funktioner:
// map, attachAutocomplete, reverseGeocode, escapeHtml.
// changes.js sköter sparning/inläsning av JSON-fil och ångra, import.js sköter JSON-import.

const PLACES_KEY = 'transportlathund.places';
const FILTERS_KEY = 'transportlathund.filters';

const PALETTE = ['#e74c3c', '#2ecc71', '#3498db', '#f0a020', '#b07cf0', '#1abc9c', '#ff6fb5', '#e6e04a'];

// ---------- Ikoner ----------
// En ikon sparas som "fa:namn" (Font Awesome, solid) eller som en emoji (äldre data).
// Namnen är desamma som på fontawesome.com, t.ex. "circle-h" eller "truck-fast".
const FA_ICONS = {
  'Vård': ['circle-h', 'hospital', 'house-medical', 'house-chimney-medical', 'stethoscope', 'user-doctor', 'tooth',
    'kit-medical', 'briefcase-medical', 'pills', 'prescription-bottle-medical', 'mortar-pestle', 'syringe',
    'droplet', 'vial', 'vials', 'flask', 'heart-pulse', 'brain', 'wheelchair', 'baby', 'file-medical', 'shirt'],
  'Byggnader': ['warehouse', 'building', 'building-columns', 'industry', 'school', 'book', 'landmark', 'store', 'house'],
  'Post och gods': ['envelope', 'envelopes-bulk', 'envelope-open-text', 'box', 'box-archive', 'boxes-stacked',
    'dolly', 'pallet', 'truck-ramp-box', 'people-carry-box', 'clipboard-list'],
  'Transport': ['truck', 'truck-fast', 'truck-medical', 'van-shuttle', 'car', 'route'],
  'Övrigt': ['snowflake', 'temperature-low', 'triangle-exclamation', 'key', 'star', 'location-dot', 'flag', 'recycle', 'clock']
};
const EMOJI_ICONS = ['🏥', '🩺', '🦷', '💊', '🧪', '🩸', '📚', '🏭', '✉️', '📦', '🚚', '⭐'];

const isFa = ic => /^fa:[a-z0-9-]+$/.test(ic || '');
// HTML för en ikon (till markörer och innerHTML)
function iconHtml(ic) {
  if (!ic) return '';
  return isFa(ic) ? `<i class="fa-solid fa-${ic.slice(3)}" aria-hidden="true"></i>` : escapeHtml(ic);
}
// Ikon som element (till h())
const iconNode = ic => h('span', { class: 'ic', html: iconHtml(ic) });
const fa = name => iconNode('fa:' + name);
// Ikonen som text (i ändringslistan och <option>, där Font Awesome inte kan visas)
const iconLabel = ic => (isFa(ic) ? ic.slice(3) : ic || '');

// Tolka det man skriver i "eget"-fältet: "truck", "fa-truck", "fa-solid fa-truck",
// <i class="fa-solid fa-truck"></i> eller en emoji. Returnerar null om ikonen inte finns.
function parseIconInput(v) {
  v = str(v).trim();
  if (!v) return '';
  const m = v.match(/fa-(?!solid\b|regular\b|brands\b)([a-z0-9-]+)/) || v.match(/^(?:fa:)?([a-z0-9-]+)$/);
  if (m) {
    const probe = h('i', { class: `fa-solid fa-${m[1]}`, style: 'position:absolute;visibility:hidden' });
    document.body.append(probe);
    const content = getComputedStyle(probe, '::before').content;
    probe.remove();
    return content && content !== 'none' && content !== 'normal' ? 'fa:' + m[1] : null;
  }
  return /[^\x00-\x7f]/.test(v) ? v.slice(0, 8) : null;
}

// Gissa ikon utifrån namn (nya kategorier/flöden vid import och vid uppgradering)
const NAME_ICON = {
  sjukhus: 'circle-h', 'hälsocentral': 'house-medical', 'vårdcentral': 'house-medical',
  'folktandvård': 'tooth', tandvård: 'tooth', lager: 'warehouse', bibliotek: 'book', apotek: 'pills', skola: 'school',
  'blod och prover': 'droplet', prover: 'droplet', blod: 'droplet', post: 'envelope', brev: 'envelope', internpost: 'envelope',
  paket: 'box-archive', 'läkemedel': 'pills', kyl: 'snowflake', 'speditör': 'truck', expressbud: 'truck-fast', bud: 'truck-fast'
};
const EMOJI_FA = {
  '🏥': 'circle-h', '🩺': 'house-medical', '🦷': 'tooth', '💊': 'pills', '🧪': 'vial', '💉': 'syringe', '🩸': 'droplet',
  '📚': 'book', '🏫': 'school', '🏭': 'warehouse', '🏢': 'building', '✉️': 'envelope', '📨': 'envelope', '📬': 'envelope',
  '📦': 'box-archive', '🚚': 'truck', '🚑': 'truck-medical', '❄️': 'snowflake', '⚠️': 'triangle-exclamation',
  '🔑': 'key', '⭐': 'star', '📍': 'location-dot', '🔄': 'arrows-rotate', '♿': 'wheelchair', '👶': 'baby', '🧠': 'brain'
};
const guessIcon = name => (NAME_ICON[str(name).trim().toLowerCase()] ? 'fa:' + NAME_ICON[str(name).trim().toLowerCase()] : '');
const DAY_NAMES = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const TIME_TYPES = { pickup: 'Hämtning', delivery: 'Leverans' };
const WEEKDAYS = [1, 2, 3, 4, 5];
const PENCIL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

// ---------- Små hjälpfunktioner ----------
const el = id => document.getElementById(id);
const str = v => (v == null ? '' : String(v));
const arr = v => (Array.isArray(v) ? v : []);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#999999');
const validTime = v => (/^\d{2}:\d{2}$/.test(v) ? v : '');
const clone = o => JSON.parse(JSON.stringify(o));
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignoreras */ } };
const recall = k => { try { return localStorage.getItem(k); } catch { return null; } };

// Skapar ett element: h('div', { class: 'x', onclick: fn }, 'text', barn...)
function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : String(c));
  }
  return e;
}

// ---------- Egna dialogrutor ----------
// Ersätter webbläsarens confirm/alert/prompt, som är blockerade i vissa miljöer
// (t.ex. inbäddade förhandsvisningar) och då tyst avbryter det man försöker göra.
function uiDialog(message, { buttons, input } = {}) {
  return new Promise(resolve => {
    const dlg = h('dialog', { class: 'uidlg' });
    const field = input != null ? h('input', { type: 'text', value: input }) : null;
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    const btns = buttons.map(b => h('button', {
      type: 'button', class: b.class || '',
      onclick: () => done(b.value === '__input' ? field.value : b.value)
    }, b.label));
    if (field) field.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(field.value); } };
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    dlg.append(h('div', { class: 'uidlg-msg' }, message), field, h('div', { class: 'uidlg-btns' }, btns));
    document.body.append(dlg);
    dlg.showModal();
    (field || btns[btns.length - 1]).focus();
  });
}
const uiAlert = message => uiDialog(message, { buttons: [{ label: 'OK', value: true }] });
const uiConfirm = (message, okLabel = 'OK', danger = false) => uiDialog(message, {
  buttons: [{ label: 'Avbryt', value: false, class: 'secondary' }, { label: okLabel, value: true, class: danger ? 'danger' : '' }]
}).then(v => v === true);
const uiPrompt = (message, value = '') => uiDialog(message, {
  input: value,
  buttons: [{ label: 'Avbryt', value: null, class: 'secondary' }, { label: 'OK', value: '__input' }]
});

// ---------- Datamodell ----------
// {
//   categories: [{ id, name, color, icon }],
//   flows:      [{ id, name, color, icon, carrierId|null }],   // carrierId = speditören som kör flödet
//   carriers:   [{ id, name, color, icon, note, contacts: [{ id, name, role, phone, email }] }],   // speditörer
//   places: [{
//     id, name, address, lat, lon, categoryId, note,
//     contacts: [{ id, name, role, phone, email, flowId|null }],   // flowId = kontakt för ett visst flöde
//     flows:    [{ flowId, note, times: [{ id, type: 'pickup'|'delivery', from, to, days: [1..7], note }] }]
//   }]
// }
// Ikoner: "fa:namn" (Font Awesome) eller emoji.
// Vilka kategorier/flöden som visas på kartan sparas separat (FILTERS_KEY), inte i datafilen.
const normIcon = ic => str(ic).slice(0, 40);
const normCategory = c => ({ id: str(c.id) || uid(), name: str(c.name), color: safeColor(c.color), icon: normIcon(c.icon) });
const normFlow = f => ({ id: str(f.id) || uid(), name: str(f.name), color: safeColor(f.color), icon: normIcon(f.icon), carrierId: f.carrierId ? str(f.carrierId) : null });
const normCarrierContact = c => ({ id: str(c.id) || uid(), name: str(c.name), role: str(c.role), phone: str(c.phone), email: str(c.email) });
const normCarrier = s => ({
  id: str(s.id) || uid(), name: str(s.name), color: safeColor(s.color), icon: normIcon(s.icon), note: str(s.note),
  contacts: arr(s.contacts).map(normCarrierContact)
});
const normContact = c => ({ id: str(c.id) || uid(), name: str(c.name), role: str(c.role), phone: str(c.phone), email: str(c.email), flowId: c.flowId ? str(c.flowId) : null });
const normTime = t => ({
  id: str(t.id) || uid(),
  type: t.type === 'delivery' ? 'delivery' : 'pickup',
  from: validTime(t.from), to: validTime(t.to),
  days: Array.isArray(t.days) ? [...new Set(t.days.map(Number).filter(d => d >= 1 && d <= 7))].sort((a, b) => a - b) : [...WEEKDAYS],
  note: str(t.note)
});
const normPlaceFlow = pf => ({ flowId: str(pf.flowId), note: str(pf.note), times: arr(pf.times).map(normTime) });
const normPlace = p => ({
  id: str(p.id) || uid(), name: str(p.name), address: str(p.address),
  lat: Number(p.lat), lon: Number(p.lon), categoryId: str(p.categoryId), note: str(p.note),
  contacts: arr(p.contacts).map(normContact),
  flows: arr(p.flows).map(normPlaceFlow)
});
const validPlace = p => p && p.name && p.lat != null && p.lon != null && isFinite(p.lat) && isFinite(p.lon);

function normalizeData(d) {
  // En tidig version kopplade speditören per plats och flöde. Flytta upp den till flödet
  // (den speditör som används flest gånger), om flödet inte redan har en.
  arr(d.flows).forEach(f => {
    if (!f || f.carrierId) return;
    const count = {};
    arr(d.places).forEach(p => arr(p && p.flows).forEach(pf => {
      if (pf && pf.flowId === f.id && pf.carrierId) count[pf.carrierId] = (count[pf.carrierId] || 0) + 1;
    }));
    const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    if (best) f.carrierId = best[0];
  });
  return {
    categories: arr(d.categories).filter(c => c && c.name).map(normCategory),
    flows: arr(d.flows).filter(f => f && f.name).map(normFlow),
    carriers: arr(d.carriers).filter(s => s && s.name).map(normCarrier),
    places: arr(d.places).filter(validPlace).map(normPlace)
  };
}

const emptyData = () => ({ categories: [], flows: [], carriers: [], places: [] });

function defaultData() {
  return {
    categories: [
      { id: uid(), name: 'Sjukhus', color: '#e74c3c', icon: 'fa:circle-h' },
      { id: uid(), name: 'Hälsocentral', color: '#2ecc71', icon: 'fa:house-medical' },
      { id: uid(), name: 'Folktandvård', color: '#3498db', icon: 'fa:tooth' },
      { id: uid(), name: 'Lager', color: '#f0a020', icon: 'fa:warehouse' }
    ],
    flows: [
      { id: uid(), name: 'Post', color: '#3498db', icon: 'fa:envelope', carrierId: null },
      { id: uid(), name: 'Paket', color: '#f0a020', icon: 'fa:box-archive', carrierId: null },
      { id: uid(), name: 'Blod och prover', color: '#e74c3c', icon: 'fa:droplet', carrierId: null }
    ],
    carriers: [],
    places: []
  };
}

// Byter emoji-ikoner mot Font Awesome (görs en gång; syns som osparade ändringar)
const ICONS_UPGRADED_KEY = 'transportlathund.icons-fa';
function upgradeIcons(d) {
  [...d.categories, ...d.flows].forEach(x => {
    if (isFa(x.icon)) return;
    const fromName = guessIcon(x.name);
    if (fromName) x.icon = fromName;
    else if (EMOJI_FA[x.icon]) x.icon = 'fa:' + EMOJI_FA[x.icon];
  });
}

// Filter (vad som visas på kartan) – sparas bara i webbläsaren
let filters = { hiddenCats: [], hiddenFlows: [], showNoFlow: true };

function loadPlaceData() {
  let raw = null;
  try { raw = JSON.parse(recall(PLACES_KEY)); } catch { /* ignoreras */ }
  if (!raw || !Array.isArray(raw.categories)) return defaultData();

  const d = normalizeData(raw);
  if (!raw.version) {
    // Uppgradering från första prototypen
    d.categories.forEach(c => { if (!c.icon) c.icon = guessIcon(c.name); });
    if (!d.flows.length) d.flows = defaultData().flows;
  }
  if (!recall(ICONS_UPGRADED_KEY)) {
    upgradeIcons(d);
    store(ICONS_UPGRADED_KEY, '1');
  }
  // Tidigare versioner sparade "visible" i datan – flytta det till filtren
  if (!recall(FILTERS_KEY)) {
    filters.hiddenCats = arr(raw.categories).filter(c => c && c.visible === false).map(c => str(c.id));
    filters.hiddenFlows = arr(raw.flows).filter(f => f && f.visible === false).map(f => str(f.id));
    const old = recall('transportlathund.shownoflow');
    if (old === '0') filters.showNoFlow = false;
  }
  return d;
}

try { const f = JSON.parse(recall(FILTERS_KEY)); if (f) filters = { ...filters, ...f }; } catch { /* ignoreras */ }
// Fanns det data sparad i webbläsaren vid start? Annars visar changes.js en välkomstruta.
const hadLocalData = !!recall(PLACES_KEY);
let placeData = loadPlaceData();

const saveFilters = () => store(FILTERS_KEY, JSON.stringify(filters));
const catVisible = c => !filters.hiddenCats.includes(c.id);
const flowVisible = f => !filters.hiddenFlows.includes(f.id);
function setCatVisible(id, v) {
  filters.hiddenCats = filters.hiddenCats.filter(x => x !== id);
  if (!v) filters.hiddenCats.push(id);
  saveFilters();
}
function setFlowVisible(id, v) {
  filters.hiddenFlows = filters.hiddenFlows.filter(x => x !== id);
  if (!v) filters.hiddenFlows.push(id);
  saveFilters();
}
function setShowNoFlow(v) { filters.showNoFlow = v; saveFilters(); }

// Arbetskopian sparas i webbläsaren direkt; changes.js räknar ut vad som skiljer mot senast sparade fil
function persistPlaces() {
  store(PLACES_KEY, JSON.stringify({ version: 4, ...placeData }));
  if (typeof onDataChanged === 'function') onDataChanged();
}

const catById = id => placeData.categories.find(c => c.id === id);
const flowById = id => placeData.flows.find(f => f.id === id);
const carrierById = id => (id ? placeData.carriers.find(s => s.id === id) : undefined);
const placeLabel = p => (p.address ? `${p.name}, ${p.address}` : p.name);
const placesWithFlow = flowId => placeData.places.filter(p => p.flows.some(pf => pf.flowId === flowId));
const flowsWithCarrier = carrierId => placeData.flows.filter(f => f.carrierId === carrierId);
const flowCarrier = flowId => carrierById((flowById(flowId) || {}).carrierId);
const placesInCategory = catId => placeData.places.filter(p => p.categoryId === catId);
const sortByName = list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'sv'));

// Sparar och ritar om allt som visar data
function refreshPlaces() {
  persistPlaces();
  redraw();
}
// Ritar om utan att spara (t.ex. när bara filtren ändras)
function redraw() {
  renderFilterBar();
  renderPlaceMarkers();
  if (el('placeRows')) renderPlaceRows();
  if (flowsDlg.open) renderRegistryView('flows');
  if (catsDlg.open) renderRegistryView('categories');
  if (carriersDlg.open) renderRegistryView('carriers');
}

// ---------- Formattering ----------
function formatDays(days) {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return 'Alla dagar';
  if (!d.length) return 'Inga dagar';
  const parts = [];
  for (let i = 0; i < d.length;) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
    if (j - i >= 2) parts.push(`${DAY_NAMES[d[i] - 1]}–${DAY_NAMES[d[j] - 1]}`);
    else for (let k = i; k <= j; k++) parts.push(DAY_NAMES[d[k] - 1]);
    i = j + 1;
  }
  return parts.join(', ');
}

const formatTimeRange = t => (t.to ? `${t.from}–${t.to}` : t.from);
const sortTimes = times => [...times].sort((a, b) => (a.type === b.type ? a.from.localeCompare(b.from) : a.type === 'pickup' ? -1 : 1));
const timeText = t => `${TIME_TYPES[t.type]} ${formatDays(t.days)} ${formatTimeRange(t)}${t.note ? ` – ${t.note}` : ''}`;

// Ljus bakgrund → mörk ikon, annars vit ikon. Bygger på färgens upplevda ljushet (relativ luminans).
// Gränsen är satt så att mellantoner (röd, blå, turkos) behåller vit ikon och bara
// tydligt ljusa färger (ljusgrön, gul, orange, ljusgrå) får mörk. Höj värdet för fler vita ikoner.
const LIGHT_COLOR_LIMIT = 0.4;
function isLightColor(hex) {
  const c = safeColor(hex).slice(1).match(/../g).map(x => {
    const v = parseInt(x, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > LIGHT_COLOR_LIMIT;
}
const onColorClass = hex => (isLightColor(hex) ? ' on-light' : '');

// Ikonfärg: samma färgton som bakgrunden men med motsatt ljusstyrka.
// Ljus bakgrund → mörk nyans (ICON_DARK_L), mörk bakgrund → ljus nyans (ICON_LIGHT_L).
const ICON_DARK_L = 20;   // % ljushet för mörka ikoner (lägre = mörkare)
const ICON_LIGHT_L = 80;  // % ljushet för ljusa ikoner (högre = ljusare, 100 = vit)
function iconColorFor(hex) {
  const [r, g, b] = safeColor(hex).slice(1).match(/../g).map(x => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let hue = 0, sat = 0;
  if (d) {
    sat = d / (1 - Math.abs(2 * l - 1));
    hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = Math.round(hue * 60 + 360) % 360;
  }
  const light = isLightColor(hex);
  // Mörka nyanser blir gråaktiga om mättnaden är låg, så den hålls uppe lite
  const s = Math.round(Math.min(1, light ? Math.max(sat, 0.35) : sat) * 100);
  return `hsl(${hue} ${s}% ${light ? ICON_DARK_L : ICON_LIGHT_L}%)`;
}
// Stil för en färgad cirkel med ikon (bakgrund + ikonfärg)
const colorStyle = hex => `background:${safeColor(hex)};color:${iconColorFor(hex)}`;

function badge(item, size) {
  return h('span', {
    class: 'badge' + onColorClass(item && item.color),
    style: `${colorStyle(item && item.color)}${size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.48)}px` : ''}`,
    html: iconHtml(item && item.icon)
  });
}
// Ikon + namn, t.ex. i chips och rubriker
const named = item => [iconNode(item.icon), ' ', item.name];

function timeLine(t, cls) {
  return h('div', { class: cls },
    h('span', { class: 'tt ' + t.type }, TIME_TYPES[t.type]),
    ` ${formatDays(t.days)} ${formatTimeRange(t)}`,
    t.note ? h('span', { class: 'muted' }, ` – ${t.note}`) : null);
}

function contactView(c) {
  const who = c.name || c.role || 'Kontakt';
  // Namn och roll på första raden, telefon och e-post på egna rader under
  return h('div', { class: 'pp-contact' },
    h('div', { class: 'c-who' }, fa('user'), h('strong', {}, who),
      c.name && c.role ? h('span', { class: 'muted' }, c.role) : null),
    c.phone ? h('div', { class: 'c-line' }, fa('phone'), h('a', { href: 'tel:' + c.phone.replace(/[^\d+]/g, '') }, c.phone)) : null,
    c.email ? h('div', { class: 'c-line' }, fa('envelope'), h('a', { href: 'mailto:' + c.email }, c.email)) : null);
}

function flowChips(p) {
  return p.flows.map(pf => {
    const f = flowById(pf.flowId);
    if (!f) return null;
    return h('span', {
      class: 'chip', style: `border-color:${safeColor(f.color)}`,
      title: [sortTimes(pf.times).map(timeText).join('\n') || 'Inga tider angivna',
        flowCarrier(pf.flowId) ? `Speditör: ${flowCarrier(pf.flowId).name}` : ''].filter(Boolean).join('\n')
    }, named(f));
  });
}

// Rad om flödets speditör (popup, platsredigering och flödesöversikt)
// withContacts: true = visa kontakterna, 'toggle' = dolda tills man klickar på speditören.
// Vid 'toggle': opts = { open, onToggle } – den som anropar håller reda på läget och ritar om.
function carrierLine(flow, withContacts, opts = {}) {
  const s = carrierById(flow && flow.carrierId);
  if (!s) return null;
  const style = `border-color:${safeColor(s.color)}`;
  if (withContacts !== 'toggle') {
    return h('div', { class: 'pp-carrier' },
      h('div', {}, h('span', { class: 'muted' }, 'Speditör: '), h('span', { class: 'carrier-tag', style }, named(s))),
      withContacts ? s.contacts.map(contactView) : null);
  }
  const info = [...s.contacts.map(c => [c.name || c.role || 'Kontakt', c.name && c.role ? `(${c.role})` : '', c.phone, c.email].filter(Boolean).join(' ')), s.note].filter(Boolean);
  if (!info.length) {
    return h('div', { class: 'pp-carrier' }, h('div', {}, h('span', { class: 'muted' }, 'Speditör: '), h('span', { class: 'carrier-tag', style }, named(s))));
  }
  const open = !!opts.open;
  const tag = h('button', {
    type: 'button', class: 'carrier-tag clickable', style, 'aria-expanded': String(open),
    title: open ? 'Klicka för att dölja' : `${info.join('\n')}\n\nKlicka för att visa`,
    // Vänta tills klicket är färdigbehandlat innan innehållet byts ut, annars tror
    // kartan att man klickat utanför popupen och stänger den.
    onclick: e => { e.stopPropagation(); if (opts.onToggle) setTimeout(opts.onToggle, 0); }
  }, named(s), h('span', { class: 'chev' }, fa(open ? 'chevron-up' : 'chevron-down')));
  return h('div', { class: 'pp-carrier' },
    h('div', {}, h('span', { class: 'muted' }, 'Speditör: '), tag),
    open ? h('div', { class: 'pp-carrier-details' },
      s.contacts.map(contactView),
      s.note ? h('div', { class: 'note' }, s.note) : null) : null);
}

function dlgHead(title, onClose, back) {
  return h('div', { class: 'dlg-head' },
    back ? h('button', { type: 'button', class: 'secondary small', onclick: back }, '← Tillbaka') : null,
    h('h2', {}, title),
    h('button', { type: 'button', class: 'icon', title: 'Stäng', onclick: onClose }, '✕'));
}

// ---------- Menyrad ----------
const placesDlg = el('placesDialog');
const flowsDlg = el('flowsDialog');
const catsDlg = el('categoriesDialog');
const carriersDlg = el('carriersDialog');

function closeAllDialogs() {
  document.querySelectorAll('dialog').forEach(d => { if (d.open) d.close(); });
  editDraft = null;
  setDraftMarker(null);
}

document.querySelectorAll('[data-open]').forEach(b => {
  b.onclick = () => {
    closeDropdowns();
    const what = b.dataset.open;
    if (what === 'places') openPlacesDialog();
    else if (what === 'flows') openRegistryDialog('flows');
    else if (what === 'categories') openRegistryDialog('categories');
    else if (what === 'carriers') openRegistryDialog('carriers');
  };
});

// ---------- Filtermenyer under menyraden ----------
function closeDropdowns() {
  document.querySelectorAll('.dropdown').forEach(d => {
    d.classList.remove('open');
    d.querySelector('.dd-panel').hidden = true;
  });
}

document.querySelectorAll('.dropdown').forEach(dd => {
  dd.querySelector('.dd-btn').onclick = () => {
    const panel = dd.querySelector('.dd-panel');
    const willOpen = panel.hidden;
    closeDropdowns();
    panel.hidden = !willOpen;
    dd.classList.toggle('open', willOpen);
  };
});
document.addEventListener('mousedown', e => { if (!e.target.closest('.dropdown')) closeDropdowns(); });

function filterOption(item, checked, count, onchange) {
  return h('label', {},
    h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) }),
    item ? badge(item) : h('span', { class: 'badge', style: 'background:var(--panel-3);color:var(--muted)' }, '∅'),
    item ? item.name : 'Utan flöden',
    h('span', { class: 'count' }, count));
}

function renderFilterBar() {
  // Platser (kategorier)
  const cats = placeData.categories;
  const visCats = cats.filter(catVisible).length;
  el('ddCats').querySelector('.dd-btn').innerHTML =
    `${iconHtml('fa:location-dot')} Platser · <b>${visCats === cats.length ? 'Alla' : `${visCats} av ${cats.length}`}</b> ▾`;
  const cp = el('ddCats').querySelector('.dd-panel');
  cp.innerHTML = '';
  cats.forEach(c => cp.append(filterOption(c, catVisible(c), placesInCategory(c.id).length, v => { setCatVisible(c.id, v); redraw(); })));
  if (!cats.length) cp.append(h('div', { class: 'hint' }, 'Inga kategorier. Skapa dem under Kategorier.'));
  cp.append(h('div', { class: 'dd-foot' },
    h('button', { type: 'button', class: 'small secondary', onclick: () => { filters.hiddenCats = []; saveFilters(); redraw(); } }, 'Visa alla'),
    h('button', { type: 'button', class: 'small secondary', onclick: () => { filters.hiddenCats = cats.map(c => c.id); saveFilters(); redraw(); } }, 'Dölj alla')));

  // Flöden
  const flows = placeData.flows;
  const visFlows = flows.filter(flowVisible).length;
  const allFlows = visFlows === flows.length && filters.showNoFlow;
  el('ddFlows').querySelector('.dd-btn').innerHTML =
    `${iconHtml('fa:arrows-rotate')} Flöden · <b>${allFlows ? 'Alla' : `${visFlows} av ${flows.length}${filters.showNoFlow ? ' + utan' : ''}`}</b> ▾`;
  const fp = el('ddFlows').querySelector('.dd-panel');
  fp.innerHTML = '';
  flows.forEach(f => fp.append(filterOption(f, flowVisible(f), placesWithFlow(f.id).length, v => { setFlowVisible(f.id, v); redraw(); })));
  fp.append(h('div', { class: 'dd-sep' }),
    filterOption(null, filters.showNoFlow, placeData.places.filter(p => !p.flows.length).length, v => { setShowNoFlow(v); redraw(); }));
  fp.append(h('div', { class: 'dd-foot' },
    h('button', { type: 'button', class: 'small secondary', onclick: () => { filters.hiddenFlows = []; filters.showNoFlow = true; saveFilters(); redraw(); } }, 'Visa alla'),
    h('button', { type: 'button', class: 'small secondary', onclick: () => { filters.hiddenFlows = flows.map(f => f.id); filters.showNoFlow = false; saveFilters(); redraw(); } }, 'Dölj alla')));
}

// En plats visas om kategorin är vald och den har minst ett valt flöde
// (eller saknar flöden och "Utan flöden" är valt).
function isPlaceShown(p) {
  const c = catById(p.categoryId);
  if (!c || !catVisible(c)) return false;
  if (!p.flows.length) return filters.showNoFlow;
  return p.flows.some(pf => { const f = flowById(pf.flowId); return f && flowVisible(f); });
}

// ---------- Kartmarkörer ----------
// Egen pane: ovanpå ev. ruttlinjer men under ruttens A/B-markörer.
map.createPane('places').style.zIndex = 450;

// Klusterbubbla: antal platser, med en ring i de ingående kategoriernas färger.
function clusterIcon(cluster) {
  const markers = cluster.getAllChildMarkers();
  const counts = {};
  markers.forEach(m => { const c = m.options.catColor; counts[c] = (counts[c] || 0) + 1; });
  let at = 0;
  const stops = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => {
    const from = at; at += n / markers.length * 360;
    return `${c} ${from}deg ${at}deg`;
  }).join(', ');
  const n = markers.length;
  const size = n < 10 ? 34 : n < 50 ? 40 : 46;
  return L.divIcon({
    className: '',
    html: `<div class="pcluster" style="width:${size}px;height:${size}px;background:conic-gradient(${stops})"><span>${n}</span></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2]
  });
}

// Utan nätverk (eller om biblioteket inte laddats) faller vi tillbaka på vanliga markörer.
const CLUSTERING = typeof L.markerClusterGroup === 'function';
const placeLayer = (CLUSTERING ? L.markerClusterGroup({
  clusterPane: 'places',
  maxClusterRadius: 45,           // px: hur nära markörer måste ligga för att slås ihop
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,        // platser på samma adress fälls ut i en ring
  spiderLegPolylineOptions: { weight: 1.5, color: '#9aa3b5', opacity: 0.7 },
  iconCreateFunction: clusterIcon
}) : L.layerGroup()).addTo(map);
const placeMarkers = {};

function markerIcon(cat) {
  const color = safeColor(cat.color);
  if (!cat.icon) {
    return L.divIcon({ className: '', html: `<div class="pmark small" style="background:${color}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8] });
  }
  return L.divIcon({ className: '', html: `<div class="pmark${onColorClass(color)}" style="${colorStyle(color)}">${iconHtml(cat.icon)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
}

function renderPlaceMarkers() {
  placeLayer.clearLayers();
  Object.keys(placeMarkers).forEach(k => delete placeMarkers[k]);
  const markers = placeData.places.filter(isPlaceShown).map(p => {
    const cat = catById(p.categoryId);
    return placeMarkers[p.id] = L.marker([p.lat, p.lon], { icon: markerIcon(cat), pane: 'places', catColor: safeColor(cat.color) })
      .bindTooltip(p.name, { direction: 'top', offset: [0, -12] })
      .bindPopup(() => buildPopup(p), { minWidth: 300, maxWidth: 400, maxHeight: 440, autoPanPaddingTopLeft: [20, 130] });
  });
  // addLayers lägger till alla på en gång (mycket snabbare än en och en i ett kluster)
  if (CLUSTERING) placeLayer.addLayers(markers);
  else markers.forEach(m => m.addTo(placeLayer));
}

// Vilka speditörer som är utfällda i den öppna popupen ("platsId|flödesId"). Nollställs när popupen stängs.
const shownCarrierInfo = new Set();
map.on('popupclose', () => shownCarrierInfo.clear());

function buildPopup(p) {
  const cat = catById(p.categoryId);
  const d = h('div', { class: 'placepopup' },
    h('button', {
      type: 'button', class: 'pp-edit', title: 'Redigera', html: PENCIL_SVG,
      onclick: () => { map.closePopup(); openPlaceEditor(p, 'close'); }
    }),
    h('div', { class: 'pp-head' }, badge(cat, 32), h('div', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, cat ? cat.name : ''))),
    p.address ? h('div', {}, p.address) : null,
    p.note ? h('div', { class: 'note' }, p.note) : null);

  const general = p.contacts.filter(c => !c.flowId);
  if (general.length) d.append(h('div', { class: 'pp-sec' }, h('div', { class: 'pp-label' }, 'Kontakter'), general.map(contactView)));

  if (!p.flows.length) d.append(h('div', { class: 'pp-sec muted' }, 'Inga flöden kopplade.'));
  p.flows.forEach(pf => {
    const f = flowById(pf.flowId);
    if (!f) return;
    const sec = h('div', { class: 'pp-flow', style: `border-left-color:${safeColor(f.color)}` },
      h('div', { class: 'pp-flowname' }, named(f)));
    sortTimes(pf.times).forEach(t => sec.append(timeLine(t, 'pp-time')));
    if (!pf.times.length) sec.append(h('div', { class: 'muted' }, 'Inga tider angivna.'));
    if (pf.note) sec.append(h('div', { class: 'note' }, pf.note));
    p.contacts.filter(c => c.flowId === pf.flowId).forEach(c => sec.append(contactView(c)));
    // Speditörens kontakter visas först vid klick. Popupen byggs om (update) så att
    // storlek och position räknas om och den inte hamnar under menyraden.
    const key = p.id + '|' + f.id;
    const cl = carrierLine(f, 'toggle', {
      open: shownCarrierInfo.has(key),
      onToggle: () => {
        if (!shownCarrierInfo.delete(key)) shownCarrierInfo.add(key);
        const m = placeMarkers[p.id];
        if (m && m.isPopupOpen()) m.getPopup().update();
      }
    });
    if (cl) sec.append(cl);
    d.append(sec);
  });
  return d;
}

// Visa en plats på kartan, och slå på dess filter om den är dold
function showOnMap(p) {
  closeAllDialogs();
  if (!isPlaceShown(p)) {
    setCatVisible(p.categoryId, true);
    if (!p.flows.length) setShowNoFlow(true);
    else if (!p.flows.some(pf => { const f = flowById(pf.flowId); return f && flowVisible(f); })) setFlowVisible(p.flows[0].flowId, true);
    redraw();
  }
  const marker = placeMarkers[p.id];
  map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 14));
  map.once('moveend', () => {
    if (!marker) return;
    // Ligger platsen kvar i ett kluster zoomar/fäller klustringen ut den först
    if (CLUSTERING) placeLayer.zoomToShowLayer(marker, () => marker.openPopup());
    else marker.openPopup();
  });
}

// ---------- Ikonväljare ----------
let pickerEl = null;

function openIconPicker(anchor, onPick) {
  closeIconPicker();
  const pick = icon => { onPick(icon); closeIconPicker(); };
  const msg = h('div', { class: 'ip-msg' });
  const pickCustom = () => {
    const ic = parseIconInput(custom.value);
    if (ic === null) { msg.textContent = `Hittar ingen ikon "${custom.value.trim()}". Använd namnet från fontawesome.com, t.ex. truck-fast.`; return; }
    pick(ic);
  };
  const custom = h('input', {
    placeholder: 'Namn från fontawesome.com, t.ex. truck-fast', maxLength: 80,
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); pickCustom(); } },
    oninput: () => { msg.textContent = ''; }
  });
  pickerEl = h('div', { class: 'iconpicker' },
    Object.entries(FA_ICONS).flatMap(([group, names]) => [
      h('div', { class: 'ip-group' }, group),
      h('div', { class: 'ip-grid' }, names.map(n => h('button', { type: 'button', title: n, onclick: () => pick('fa:' + n) }, fa(n))))
    ]),
    h('div', { class: 'ip-group' }, 'Emoji'),
    h('div', { class: 'ip-grid' }, EMOJI_ICONS.map(ic => h('button', { type: 'button', onclick: () => pick(ic) }, ic))),
    h('div', { class: 'ip-row' },
      custom,
      h('button', { type: 'button', class: 'small', onclick: pickCustom }, 'OK'),
      h('button', { type: 'button', class: 'small secondary', onclick: () => pick('') }, 'Ingen')),
    msg,
    h('div', { class: 'ip-hint' }, 'Alla gratis "solid"-ikoner på fontawesome.com fungerar. Du kan också klistra in en emoji.'));
  // Inuti en öppen modal måste väljaren ligga i modalen, annars hamnar den bakom
  (anchor.closest('dialog') || document.body).append(pickerEl);

  const r = anchor.getBoundingClientRect();
  const ph = pickerEl.offsetHeight;
  const pw = pickerEl.offsetWidth;
  let left = r.left, top;
  if (r.bottom + ph + 8 <= innerHeight) top = r.bottom + 4;        // under knappen
  else if (r.top - ph - 4 >= 4) top = r.top - ph - 4;             // ovanför
  else { top = Math.min(r.top, innerHeight - ph - 8); left = r.right + 8; } // bredvid
  pickerEl.style.left = Math.max(4, Math.min(left, innerWidth - pw - 8)) + 'px';
  pickerEl.style.top = Math.max(4, top) + 'px';
  setTimeout(() => document.addEventListener('mousedown', pickerOutside), 0);
}
function pickerOutside(e) { if (pickerEl && !pickerEl.contains(e.target)) closeIconPicker(); }
function closeIconPicker() {
  if (!pickerEl) return;
  pickerEl.remove();
  pickerEl = null;
  document.removeEventListener('mousedown', pickerOutside);
}

// ---------- Modal: Flöden / Kategorier / Speditörer ----------
// Två lägen, som för platser:
//  - Visning: en lista. Klick på en rad fäller ut detaljer (bara läsning).
//  - Redigering: ett eget formulär (Redigera / + Ny). Ändringar gäller först när man klickar Klar.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const REGISTRY = {
  flows: {
    dlg: () => flowsDlg, view: 'flowsView', icon: 'arrows-rotate', title: 'Flöden', label: 'Flödet', one: 'flöde',
    newLabel: 'Nytt flöde', editLabel: 'Redigera flöde', defaultIcon: 'fa:box',
    hint: 'Flöden är det som hämtas och lämnas, t.ex. post eller paket. Klicka på ett flöde för att se speditör, platser och tider.',
    placeholder: 'T.ex. Blod och prover',
    norm: normFlow,
    blank: () => ({ carrierId: null }),
    places: item => placesWithFlow(item.id),
    summary: item => {
      const s = carrierById(item.carrierId);
      return [s ? h('span', { class: 'carrier-tag', style: `border-color:${safeColor(s.color)}` }, named(s)) : h('span', { class: 'muted' }, 'Ingen speditör'),
        ' · ', plural(placesWithFlow(item.id).length, 'plats', 'platser')];
    },
    overview: item => flowOverview(item)
  },
  categories: {
    dlg: () => catsDlg, view: 'categoriesView', icon: 'tags', title: 'Kategorier', label: 'Kategorin', one: 'kategori',
    newLabel: 'Ny kategori', editLabel: 'Redigera kategori', defaultIcon: 'fa:location-dot',
    hint: 'Kategorier anger vilken typ av plats det är och styr ikon och färg på kartan. Klicka på en kategori för att se dess platser.',
    placeholder: 'T.ex. Apotek',
    norm: normCategory,
    blank: () => ({}),
    places: item => placesInCategory(item.id),
    summary: item => plural(placesInCategory(item.id).length, 'plats', 'platser'),
    overview: item => categoryOverview(item)
  },
  carriers: {
    dlg: () => carriersDlg, view: 'carriersView', icon: 'truck', title: 'Speditörer', label: 'Speditören', one: 'speditör',
    newLabel: 'Ny speditör', editLabel: 'Redigera speditör', defaultIcon: 'fa:truck',
    hint: 'Speditörer är de som kör godset. Klicka på en speditör för att se kontakter, anteckning och vilka flöden den kör. Vilken speditör som kör ett flöde väljer du när du redigerar flödet.',
    placeholder: 'T.ex. PostNord',
    norm: normCarrier,
    blank: () => ({ note: '', contacts: [] }),
    places: item => flowsWithCarrier(item.id), // antal flöden som speditören kör
    summary: item => `${plural(item.contacts.length, 'kontakt', 'kontakter')} · ${plural(flowsWithCarrier(item.id).length, 'flöde', 'flöden')}`,
    overview: item => carrierOverview(item)
  }
};
const expanded = new Set();     // utfällda rader i visningsläget
let regEdit = null;             // { kind, id (null = ny), draft } när ett formulär är öppet

function openRegistryDialog(kind) {
  closeAllDialogs();
  renderRegistryView(kind);
  REGISTRY[kind].dlg().showModal();
}

// Öppna formuläret för en befintlig post (item) eller en ny (item = null)
function openRegistryEditor(kind, item) {
  const cfg = REGISTRY[kind];
  if (!cfg.dlg().open) openRegistryDialog(kind);
  regEdit = {
    kind,
    id: item ? item.id : null,
    draft: item ? clone(item) : { id: null, name: '', color: PALETTE[placeData[kind].length % PALETTE.length], icon: cfg.defaultIcon, ...cfg.blank() }
  };
  renderRegistryView(kind);
  const name = el('re-name');
  if (name && !item) name.focus();
}

function leaveRegistryEditor() {
  const kind = regEdit && regEdit.kind;
  regEdit = null;
  closeIconPicker();
  if (kind) renderRegistryView(kind);
}

// Esc eller stängning: lämna formuläret (Esc går tillbaka till listan i stället för att stänga)
Object.entries(REGISTRY).forEach(([kind, cfg]) => {
  cfg.dlg().addEventListener('cancel', e => {
    if (regEdit && regEdit.kind === kind) { e.preventDefault(); leaveRegistryEditor(); }
  });
  cfg.dlg().addEventListener('close', () => { if (regEdit && regEdit.kind === kind) regEdit = null; closeIconPicker(); });
});

async function deleteRegistryItem(kind, item) {
  const n = REGISTRY[kind].places(item).length;
  if (kind === 'categories') {
    if (!await uiConfirm(n ? `Ta bort kategorin "${item.name}" och dess ${n} platser?` : `Ta bort kategorin "${item.name}"?`, 'Ta bort', true)) return false;
    placeData.places = placeData.places.filter(p => p.categoryId !== item.id);
    placeData.categories = placeData.categories.filter(c => c.id !== item.id);
  } else if (kind === 'carriers') {
    const msg = n
      ? `Ta bort speditören "${item.name}" och dess kontakter? Den kopplas bort från ${plural(n, 'flöde', 'flöden')}.`
      : `Ta bort speditören "${item.name}" och dess kontakter?`;
    if (!await uiConfirm(msg, 'Ta bort', true)) return false;
    placeData.flows.forEach(f => { if (f.carrierId === item.id) f.carrierId = null; });
    placeData.carriers = placeData.carriers.filter(s => s.id !== item.id);
  } else {
    const msg = n
      ? `Ta bort flödet "${item.name}"? Det kopplas bort från ${n} platser och deras tider för flödet försvinner. Kontaktpersoner för flödet blir kvar som allmänna kontakter.`
      : `Ta bort flödet "${item.name}"?`;
    if (!await uiConfirm(msg, 'Ta bort', true)) return false;
    placeData.places.forEach(p => {
      if (!p.flows.some(pf => pf.flowId === item.id)) return;
      p.flows = p.flows.filter(pf => pf.flowId !== item.id);
      p.contacts.forEach(c => { if (c.flowId === item.id) c.flowId = null; });
    });
    placeData.flows = placeData.flows.filter(f => f.id !== item.id);
  }
  if (regEdit && regEdit.id === item.id) regEdit = null;
  expanded.delete(item.id);
  refreshPlaces();
  return true;
}

// ----- Visningsläge: detaljer under en utfälld rad -----

// Flöde: speditören med kontakter, sedan platserna med tider
function flowOverview(flow) {
  const places = sortByName(placesWithFlow(flow.id));
  const s = carrierById(flow.carrierId);
  const carrier = s
    ? h('div', { class: 'ov-row' },
        badge(s),
        h('div', { class: 'ov-main' },
          h('div', {}, h('span', { class: 'muted' }, 'Speditör: '), h('strong', {}, s.name)),
          s.contacts.map(contactView)),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'small secondary', onclick: () => { expanded.add(s.id); openRegistryDialog('carriers'); } }, 'Visa speditören')))
    : h('div', { class: 'hint' }, 'Ingen speditör vald. Välj en under Redigera.');
  return h('div', { class: 'overview' },
    h('div', { class: 'sub' }, 'Speditör'),
    carrier,
    h('div', { class: 'sub' }, 'Platser'),
    places.length ? places.map(p => {
      const pf = p.flows.find(x => x.flowId === flow.id);
      const times = sortTimes(pf.times);
      return h('div', { class: 'ov-row' },
        badge(catById(p.categoryId)),
        h('div', { class: 'ov-main' },
          h('strong', {}, p.name), h('div', { class: 'muted' }, p.address),
          times.length ? times.map(t => timeLine(t, 'ov-time')) : h('div', { class: 'muted' }, 'Inga tider angivna.'),
          pf.note ? h('div', { class: 'note' }, pf.note) : null,
          p.contacts.filter(c => c.flowId === flow.id).map(contactView)),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'small secondary', onclick: () => showOnMap(p) }, 'Visa på kartan'),
          h('button', { type: 'button', class: 'small secondary', onclick: () => openPlaceEditor(p, 'close') }, 'Redigera plats')));
    }) : h('div', { class: 'hint' }, 'Inga platser har det här flödet ännu. Koppla det till en plats under Platser.'));
}

// Kategori: platserna med flöden
function categoryOverview(cat) {
  const places = sortByName(placesInCategory(cat.id));
  if (!places.length) return h('div', { class: 'overview' }, h('div', { class: 'hint' }, 'Inga platser i den här kategorin ännu.'));
  return h('div', { class: 'overview' }, places.map(p => h('div', { class: 'ov-row' },
    h('div', { class: 'ov-main' },
      h('strong', {}, p.name), h('div', { class: 'muted' }, p.address),
      p.flows.length ? h('div', { class: 'flowchips', style: 'margin-top:4px' }, flowChips(p)) : null),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'small secondary', onclick: () => showOnMap(p) }, 'Visa på kartan'),
      h('button', { type: 'button', class: 'small secondary', onclick: () => openPlaceEditor(p, 'close') }, 'Redigera plats')))));
}

// Speditör: flöden den kör, kontakter och anteckning (bara läsning)
function carrierOverview(s) {
  const uses = sortByName(flowsWithCarrier(s.id)).map(f => {
    const places = sortByName(placesWithFlow(f.id));
    return h('div', { class: 'ov-row' },
      badge(f),
      h('div', { class: 'ov-main' },
        h('strong', {}, f.name),
        h('div', { class: 'muted' }, places.length ? `${plural(places.length, 'plats', 'platser')}: ${places.map(p => p.name).join(', ')}` : 'Inga platser har flödet ännu.')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'small secondary', onclick: () => { expanded.add(f.id); openRegistryDialog('flows'); } }, 'Visa flödet')));
  });
  return h('div', { class: 'overview carrier-ov' },
    h('div', { class: 'sub' }, 'Kör flöden'),
    uses.length ? uses : h('div', { class: 'hint' }, 'Kör inga flöden ännu. Välj speditören när du redigerar ett flöde.'),
    h('div', { class: 'sub' }, 'Kontakter'),
    s.contacts.length ? s.contacts.map(contactView) : h('div', { class: 'hint' }, 'Inga kontakter inlagda.'),
    h('div', { class: 'sub' }, 'Anteckning'),
    s.note ? h('div', { class: 'note-text' }, s.note) : h('div', { class: 'hint' }, 'Ingen anteckning.'));
}

// ----- Visningsläge: listan -----
function renderRegistryView(kind) {
  if (regEdit && regEdit.kind === kind) { renderRegistryEditor(kind); return; }
  const cfg = REGISTRY[kind];
  const list = sortByName(placeData[kind]);
  const view = el(cfg.view);
  const oldBody = view.querySelector('.dlg-body');
  const scroll = oldBody && oldBody.dataset.mode === 'list' ? oldBody.scrollTop : 0;

  const rows = h('div', { class: 'reglist' });
  list.forEach(item => {
    const isOpen = expanded.has(item.id);
    const toggle = () => { if (isOpen) expanded.delete(item.id); else expanded.add(item.id); renderRegistryView(kind); };
    rows.append(h('div', {
      class: 'regrow' + (isOpen ? ' open' : ''), tabindex: 0, role: 'button', 'aria-expanded': String(isOpen),
      title: isOpen ? 'Klicka för att fälla ihop' : 'Klicka för att visa detaljer',
      onclick: toggle,
      onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggle(); } }
    },
      h('span', { class: 'chev' }, isOpen ? '▾' : '▸'),
      badge(item, 30),
      h('div', { class: 'reg-main' }, h('strong', {}, item.name), h('div', { class: 'reg-sum' }, cfg.summary(item))),
      h('button', {
        type: 'button', class: 'small secondary', title: `Redigera ${item.name}`,
        onclick: e => { e.stopPropagation(); openRegistryEditor(kind, item); }
      }, fa('pen'), ' Redigera')));
    if (isOpen) rows.append(cfg.overview(item));
  });
  if (!list.length) rows.append(h('div', { class: 'empty' }, `Inga ännu. Klicka på "+ ${cfg.newLabel}" för att lägga till.`));

  view.innerHTML = '';
  view.append(
    dlgHead([fa(cfg.icon), ' ', cfg.title], () => cfg.dlg().close()),
    h('div', { class: 'dlg-toolbar' },
      h('p', { class: 'hint spacer' }, cfg.hint),
      h('button', { type: 'button', onclick: () => openRegistryEditor(kind, null) }, '+ ', cfg.newLabel)),
    h('div', { class: 'dlg-body', 'data-mode': 'list' }, rows),
    h('div', { class: 'dlg-foot' }, h('span', { class: 'muted spacer' }, plural(list.length, cfg.one, cfg.title.toLowerCase()))));
  view.querySelector('.dlg-body').scrollTop = scroll;
}

// ----- Redigeringsläge -----

// Välj vilken speditör som kör flödet (i formuläret), eller skapa en ny direkt
function carrierSelect(d) {
  const sel = h('select', {
    title: 'Speditör som kör flödet',
    onchange: async e => {
      if (e.target.value !== '__new') { d.carrierId = e.target.value || null; return; }
      const name = await uiPrompt('Namn på den nya speditören:');
      if (name && name.trim()) {
        const existing = placeData.carriers.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
        const c = existing || { id: uid(), name: name.trim(), color: PALETTE[placeData.carriers.length % PALETTE.length], icon: 'fa:truck', note: '', contacts: [] };
        if (!existing) { placeData.carriers.push(c); refreshPlaces(); }
        d.carrierId = c.id;
      }
      renderRegistryEditor('flows');
    }
  },
  h('option', { value: '' }, 'Ingen speditör'),
  sortByName(placeData.carriers).map(c => h('option', { value: c.id }, c.name)),
  h('option', { value: '__new' }, '+ Ny speditör…'));
  sel.value = carrierById(d.carrierId) ? d.carrierId : '';
  return sel;
}

function carrierContactsEditor(d) {
  return h('div', { class: 'contacts' },
    d.contacts.map(c => h('div', { class: 'contact-row' },
      bound(c, 'name', { placeholder: 'Namn' }),
      bound(c, 'role', { placeholder: 'Roll, t.ex. kundtjänst' }),
      bound(c, 'phone', { type: 'tel', placeholder: 'Telefon' }),
      bound(c, 'email', { type: 'email', placeholder: 'E-post' }),
      h('button', {
        type: 'button', class: 'icon', title: 'Ta bort kontakt',
        onclick: () => { d.contacts = d.contacts.filter(x => x !== c); renderRegistryEditor('carriers'); }
      }, '✕'))),
    h('button', {
      type: 'button', class: 'small secondary',
      onclick: () => { d.contacts.push({ id: uid(), name: '', role: '', phone: '', email: '' }); renderRegistryEditor('carriers'); }
    }, '+ Lägg till kontakt'));
}

function renderRegistryEditor(kind) {
  const cfg = REGISTRY[kind];
  const d = regEdit.draft;
  const view = el(cfg.view);
  const old = view.querySelector('.dlg-body');
  const scroll = old && old.dataset.mode === 'edit' ? old.scrollTop : 0;

  // Förhandsvisning av färg + ikon, uppdateras direkt när man byter färg
  let preview = badge(d, 44);
  const iconBtn = h('button', { type: 'button', class: 'secondary', title: 'Välj ikon' }, d.icon ? iconNode(d.icon) : '·', ' Byt ikon');
  iconBtn.onclick = () => openIconPicker(iconBtn, icon => { d.icon = icon; renderRegistryEditor(kind); });
  const color = h('input', {
    type: 'color', class: 'swatch', value: safeColor(d.color), title: 'Välj färg',
    oninput: e => { d.color = e.target.value; const nb = badge(d, 44); preview.replaceWith(nb); preview = nb; }
  });

  const fields = [
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, 'Namn', bound(d, 'name', { id: 're-name', placeholder: cfg.placeholder })),
      h('div', { class: 'field' }, 'Utseende', h('div', { class: 'look-row' }, preview, iconBtn, color)))
  ];
  if (kind === 'flows') {
    fields.push(h('label', { class: 'field' }, 'Speditör som kör flödet', carrierSelect(d)),
      h('p', { class: 'hint small' }, 'Kontaktuppgifter till speditören lägger du in under Speditörer.'));
  }
  if (kind === 'carriers') {
    fields.push(h('h3', {}, 'Kontakter'), carrierContactsEditor(d),
      h('label', { class: 'field' }, 'Anteckning',
        h('textarea', { rows: 3, placeholder: 'T.ex. kundnummer, bokningsrutin, öppettider', value: d.note, oninput: e => { d.note = e.target.value; } })));
  }

  const original = regEdit.id ? placeData[kind].find(x => x.id === regEdit.id) : null;
  view.innerHTML = '';
  view.append(
    dlgHead(regEdit.id ? cfg.editLabel : cfg.newLabel, () => cfg.dlg().close(), leaveRegistryEditor),
    h('div', { class: 'dlg-body reg-edit', 'data-mode': 'edit' }, fields),
    h('div', { class: 'dlg-foot' },
      original ? h('button', {
        type: 'button', class: 'danger',
        onclick: async () => { if (await deleteRegistryItem(kind, original)) leaveRegistryEditor(); }
      }, 'Ta bort') : null,
      h('span', { id: 're-error', class: 'error spacer' }),
      h('button', { type: 'button', class: 'secondary', onclick: leaveRegistryEditor }, 'Avbryt'),
      h('button', { type: 'button', onclick: saveRegistryItem }, 'Klar')));
  view.querySelector('.dlg-body').scrollTop = scroll;
}

function saveRegistryItem() {
  const { kind, id, draft: d } = regEdit;
  const cfg = REGISTRY[kind];
  const list = placeData[kind];
  const err = msg => { el('re-error').textContent = msg; };

  d.name = d.name.trim();
  if (!d.name) return err('Ange ett namn.');
  if (list.some(x => x.id !== id && x.name.toLowerCase() === d.name.toLowerCase())) return err(`${cfg.label} "${d.name}" finns redan.`);
  if (kind === 'flows' && !carrierById(d.carrierId)) d.carrierId = null;
  if (kind === 'carriers') d.contacts = d.contacts.filter(c => [c.name, c.role, c.phone, c.email].some(v => v && v.trim()));

  const clean = cfg.norm({ ...d, id: id || uid() });
  if (id) {
    const i = list.findIndex(x => x.id === id);
    // Spara bara om något faktiskt ändrats, så att det inte blir en tom "ändring"
    if (i >= 0 && JSON.stringify(cfg.norm(list[i])) !== JSON.stringify(clean)) list[i] = clean;
    else if (i < 0) list.push(clean);
  } else {
    list.push(clean);
  }
  expanded.add(clean.id); // visa resultatet utfällt i listan
  regEdit = null;
  closeIconPicker();
  refreshPlaces();
  if (!cfg.dlg().open) return;
  renderRegistryView(kind);
}

// ---------- Modal: Platser (lista) ----------
const listFilter = { q: '', cat: 'all', flow: 'all' };

function openPlacesDialog() {
  closeAllDialogs();
  showPlacesList();
  placesDlg.showModal();
}

function showPlacesList() {
  editDraft = null;
  editingId = null;
  setDraftMarker(null);
  const view = el('placesView');

  const search = h('input', {
    type: 'search', placeholder: 'Sök namn, adress, kontakt, flöde…', value: listFilter.q,
    oninput: e => { listFilter.q = e.target.value; renderPlaceRows(); }
  });
  const catSel = h('select', { onchange: e => { listFilter.cat = e.target.value; renderPlaceRows(); } },
    h('option', { value: 'all' }, 'Alla kategorier'),
    placeData.categories.map(c => h('option', { value: c.id }, c.name)));
  catSel.value = catById(listFilter.cat) ? listFilter.cat : 'all';
  const flowSel = h('select', { onchange: e => { listFilter.flow = e.target.value; renderPlaceRows(); } },
    h('option', { value: 'all' }, 'Alla flöden'),
    placeData.flows.map(f => h('option', { value: f.id }, f.name)),
    h('option', { value: 'none' }, 'Utan flöden'));
  flowSel.value = listFilter.flow === 'none' || flowById(listFilter.flow) ? listFilter.flow : 'all';

  view.innerHTML = '';
  view.append(
    dlgHead([fa('location-dot'), ' Platser'], closeAllDialogs),
    h('div', { class: 'dlg-toolbar' }, search, catSel, flowSel,
      h('button', { type: 'button', class: 'secondary', onclick: () => openImportDialog() }, fa('file-import'), ' Importera JSON'),
      h('button', { type: 'button', onclick: () => openPlaceEditor(null, 'list') }, '+ Ny plats')),
    h('div', { class: 'dlg-body' }, h('div', { id: 'placeRows' })),
    h('div', { class: 'dlg-foot' }, h('span', { id: 'placeCount', class: 'muted spacer' })));
  renderPlaceRows();
}

function placeSearchText(p) {
  const cat = catById(p.categoryId);
  const flows = p.flows.map(pf => (flowById(pf.flowId) || {}).name);
  const contacts = p.contacts.map(c => `${c.name} ${c.role} ${c.phone} ${c.email}`);
  const carriers = p.flows.map(pf => (flowCarrier(pf.flowId) || {}).name);
  return [p.name, p.address, p.note, cat && cat.name, ...flows, ...carriers, ...contacts].join(' ').toLowerCase();
}

function renderPlaceRows() {
  const box = el('placeRows');
  if (!box) return;
  const q = listFilter.q.trim().toLowerCase();
  const rows = sortByName(placeData.places
    .filter(p => listFilter.cat === 'all' || p.categoryId === listFilter.cat)
    .filter(p => listFilter.flow === 'all' || (listFilter.flow === 'none' ? !p.flows.length : p.flows.some(pf => pf.flowId === listFilter.flow)))
    .filter(p => !q || placeSearchText(p).includes(q)));

  box.innerHTML = '';
  if (!rows.length) {
    box.append(h('div', { class: 'empty' }, placeData.places.length ? 'Inga platser matchar filtret.' : 'Inga platser ännu. Klicka på "+ Ny plats" eller importera från JSON.'));
  } else {
    box.append(h('div', { class: 'trow thead' },
      ['', 'Namn', 'Kategori', 'Flöden', 'Kontakter', ''].map(t => h('span', {}, t))));
  }
  rows.forEach(p => {
    const cat = catById(p.categoryId);
    box.append(h('div', { class: 'trow' },
      badge(cat),
      h('div', {}, h('strong', {}, p.name), h('small', {}, p.address)),
      h('div', {}, cat ? cat.name : ''),
      h('div', { class: 'flowchips' }, flowChips(p)),
      h('div', { class: 'muted', title: `${p.contacts.length} kontaktpersoner` }, p.contacts.length ? [fa('user'), ` ${p.contacts.length}`] : ''),
      h('div', { class: 'tactions' },
        h('button', { type: 'button', class: 'small secondary', onclick: () => showOnMap(p) }, 'Visa'),
        h('button', { type: 'button', class: 'small', onclick: () => openPlaceEditor(p, 'list') }, 'Redigera'))));
  });
  const count = el('placeCount');
  if (count) count.textContent = `${rows.length} av ${placeData.places.length} platser`;
}

// ---------- Modal: Platser (redigering) ----------
let editDraft = null;      // kopia av platsen som redigeras
let editingId = null;      // null = ny plats
let editReturn = 'close';  // 'list' = tillbaka till listan efteråt, 'close' = stäng modalen
let lastCategoryId = null;
let placePicking = false;
let draftMarker = null;

function setDraftMarker(lat, lon) {
  if (lat == null) {
    if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; }
    return;
  }
  if (!draftMarker) {
    draftMarker = L.circleMarker([lat, lon], {
      pane: 'places', radius: 18, color: '#ffffff', weight: 2, dashArray: '4 3',
      fillColor: '#ffffff', fillOpacity: 0.2, interactive: false
    }).addTo(map);
  } else {
    draftMarker.setLatLng([lat, lon]);
  }
}

function openPlaceEditor(place, ret) {
  if (ret === 'close') closeAllDialogs();
  editReturn = ret;
  editingId = place ? place.id : null;
  editDraft = place
    ? clone(place)
    : {
        id: null, name: '', address: '', lat: null, lon: null,
        categoryId: (catById(lastCategoryId) || placeData.categories[0] || {}).id || '',
        note: '', contacts: [], flows: []
      };
  renderEditor();
  if (!placesDlg.open) placesDlg.showModal();
  setDraftMarker(editDraft.lat, editDraft.lon);
  if (!place) el('pe-name').focus();
}

function leaveEditor() {
  editDraft = null;
  editingId = null;
  setDraftMarker(null);
  if (editReturn === 'list') showPlacesList();
  else closeAllDialogs();
}

placesDlg.addEventListener('cancel', e => {
  e.preventDefault();
  if (editDraft) leaveEditor(); else closeAllDialogs();
});

// Textfält som skriver direkt till ett objekt
function bound(obj, key, props = {}) {
  return h('input', { type: 'text', value: obj[key] || '', ...props, oninput: e => { obj[key] = e.target.value; } });
}

function contactsEditor(flowId) {
  const wrap = h('div', { class: 'contacts' });
  editDraft.contacts.filter(c => c.flowId === flowId).forEach(c => {
    wrap.append(h('div', { class: 'contact-row' },
      bound(c, 'name', { placeholder: 'Namn' }),
      bound(c, 'role', { placeholder: 'Roll (valfritt)' }),
      bound(c, 'phone', { type: 'tel', placeholder: 'Telefon' }),
      bound(c, 'email', { type: 'email', placeholder: 'E-post' }),
      h('button', {
        type: 'button', class: 'icon', title: 'Ta bort kontakt',
        onclick: () => { editDraft.contacts = editDraft.contacts.filter(x => x !== c); renderEditor(); }
      }, '✕')));
  });
  wrap.append(h('button', {
    type: 'button', class: 'small secondary',
    onclick: () => { editDraft.contacts.push({ id: uid(), name: '', role: '', phone: '', email: '', flowId }); renderEditor(); }
  }, flowId ? '+ Kontakt för flödet' : '+ Lägg till kontakt'));
  return wrap;
}

function timesEditor(pf) {
  const wrap = h('div', { class: 'times' });
  pf.times.forEach(t => {
    const typeSel = h('select', { onchange: e => { t.type = e.target.value; } },
      Object.entries(TIME_TYPES).map(([k, v]) => h('option', { value: k }, v)));
    typeSel.value = t.type;

    const days = h('div', { class: 'days' }, DAY_NAMES.map((dn, i) => {
      const d = i + 1;
      const b = h('button', { type: 'button', class: 'day' + (t.days.includes(d) ? ' on' : ''), title: dn }, dn.slice(0, 2));
      b.onclick = () => {
        t.days = t.days.includes(d) ? t.days.filter(x => x !== d) : [...t.days, d].sort((a, c) => a - c);
        b.classList.toggle('on', t.days.includes(d));
      };
      return b;
    }));

    wrap.append(h('div', { class: 'time-row' },
      typeSel,
      h('input', { type: 'time', value: t.from, title: 'Tid / starttid', oninput: e => { t.from = e.target.value; } }),
      h('span', {}, '–'),
      h('input', { type: 'time', value: t.to, title: 'Sluttid (valfritt, för tidsfönster)', oninput: e => { t.to = e.target.value; } }),
      days,
      bound(t, 'note', { class: 'tnote', placeholder: 'Notering, t.ex. "ring vid ankomst"' }),
      h('button', { type: 'button', class: 'icon', title: 'Ta bort tid', onclick: () => { pf.times = pf.times.filter(x => x !== t); renderEditor(); } }, '✕')));
  });

  const addTime = type => () => {
    pf.times.push({ id: uid(), type, from: '', to: '', days: [...WEEKDAYS], note: '' });
    renderEditor();
  };
  wrap.append(h('div', { class: 'row' },
    h('button', { type: 'button', class: 'small secondary', onclick: addTime('pickup') }, '+ Hämtningstid'),
    h('button', { type: 'button', class: 'small secondary', onclick: addTime('delivery') }, '+ Leveranstid')));
  return wrap;
}

function flowsEditor() {
  const wrap = h('div', {});
  editDraft.flows.forEach(pf => {
    const f = flowById(pf.flowId);
    wrap.append(h('div', { class: 'flow-block', style: `border-left-color:${safeColor(f && f.color)}` },
      h('div', { class: 'flow-head' },
        h('strong', {}, f ? named(f) : 'Okänt flöde'),
        h('button', {
          type: 'button', class: 'small secondary', title: 'Koppla bort flödet från platsen',
          onclick: async () => {
            if ((pf.times.length || editDraft.contacts.some(c => c.flowId === pf.flowId)) &&
                !await uiConfirm(`Koppla bort ${f ? f.name : 'flödet'}? Tider och kontakter för flödet tas bort.`, 'Koppla bort', true)) return;
            editDraft.flows = editDraft.flows.filter(x => x !== pf);
            editDraft.contacts = editDraft.contacts.filter(c => c.flowId !== pf.flowId);
            renderEditor();
          }
        }, 'Koppla bort')),
      f && carrierById(f.carrierId) ? carrierLine(f, false) : null,
      h('div', { class: 'sub' }, 'Tider'),
      timesEditor(pf),
      h('textarea', { rows: 1, placeholder: 'Anteckning för flödet (valfritt)', value: pf.note, oninput: e => { pf.note = e.target.value; } }),
      h('div', { class: 'sub' }, 'Kontaktpersoner för flödet'),
      contactsEditor(pf.flowId)));
  });

  const available = placeData.flows.filter(f => !editDraft.flows.some(pf => pf.flowId === f.id));
  if (!placeData.flows.length) {
    wrap.append(h('p', { class: 'hint' }, 'Inga flöden finns ännu. Skapa dem under Flöden i menyn.'));
  } else if (available.length) {
    const sel = h('select', {}, available.map(f => h('option', { value: f.id }, f.name)));
    wrap.append(h('div', { class: 'add-flow' }, sel,
      h('button', {
        type: 'button', class: 'small',
        onclick: () => { editDraft.flows.push({ flowId: sel.value, note: '', times: [] }); renderEditor(); }
      }, '+ Koppla flöde')));
  }
  return wrap;
}

function renderEditor() {
  const view = el('placesView');
  const old = view.querySelector('.dlg-body');
  const scroll = old && el('pe-name') ? old.scrollTop : 0;
  const d = editDraft;

  // Adressfält med förslag och val i kartan
  const addrInput = h('input', { id: 'pe-addr', type: 'text', placeholder: 'Sök adress…', autocomplete: 'off', value: d.address, class: d.lat != null ? 'ok' : '' });
  const addrWrap = h('div', { class: 'stop' },
    h('label', {}, 'Adress'),
    h('div', { class: 'inputrow' }, addrInput,
      h('button', { type: 'button', class: 'icon', title: 'Välj i kartan', onclick: startPlacePick }, fa('location-dot'), ' Välj i kartan')));
  attachAutocomplete(addrInput, addrWrap,
    r => {
      d.address = r.full;
      d.lat = r.lat;
      d.lon = r.lon;
      addrInput.value = r.full;
      addrInput.classList.add('ok');
      if (!d.name.trim()) {
        // T.ex. "Stadsbiblioteket, Sveavägen 73" -> "Stadsbiblioteket" (ta bort ev. ikon-prefix)
        d.name = (r.name || r.main.split(',')[0]).replace(/^[^\p{L}\d]+/u, '');
        el('pe-name').value = d.name;
      }
      setDraftMarker(d.lat, d.lon);
      map.panTo([d.lat, d.lon]);
    },
    () => {
      d.address = addrInput.value;
      d.lat = d.lon = null;
      addrInput.classList.remove('ok');
      setDraftMarker(null);
    });

  const catSel = h('select', { onchange: e => { d.categoryId = e.target.value; } },
    placeData.categories.map(c => h('option', { value: c.id }, c.name)));
  catSel.value = d.categoryId;

  view.innerHTML = '';
  view.append(
    dlgHead(editingId ? 'Redigera plats' : 'Ny plats', closeAllDialogs, editReturn === 'list' ? leaveEditor : null),
    h('div', { class: 'dlg-body' },
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Namn', bound(d, 'name', { id: 'pe-name', placeholder: 'T.ex. Akademiska sjukhuset, entré 70' })),
        h('label', { class: 'field' }, 'Kategori', catSel)),
      addrWrap,
      h('label', { class: 'field' }, 'Anteckning',
        h('textarea', { rows: 2, placeholder: 'T.ex. lastkaj på baksidan, portkod 1234', value: d.note, oninput: e => { d.note = e.target.value; } })),
      h('h3', {}, 'Kontaktpersoner för platsen'),
      contactsEditor(null),
      h('h3', {}, 'Flöden och tider'),
      flowsEditor()),
    h('div', { class: 'dlg-foot' },
      editingId ? h('button', { type: 'button', class: 'danger', onclick: deleteEditedPlace }, 'Ta bort plats') : null,
      h('span', { id: 'pe-error', class: 'error spacer' }),
      h('button', { type: 'button', class: 'secondary', onclick: leaveEditor }, 'Avbryt'),
      h('button', { type: 'button', onclick: savePlace }, 'Klar')));

  view.querySelector('.dlg-body').scrollTop = scroll;
}

function savePlace() {
  const d = editDraft;
  const err = msg => { el('pe-error').textContent = msg; };

  d.name = d.name.trim();
  if (!d.name) return err('Ange ett namn.');
  if (!catById(d.categoryId)) return err('Välj en kategori (skapa en under Kategorier om listan är tom).');
  if (d.lat == null) return err('Välj en adress i förslagslistan eller i kartan.');
  for (const pf of d.flows) {
    const fname = (flowById(pf.flowId) || {}).name || 'flödet';
    if (pf.times.some(t => !t.from)) return err(`Ange en tid för alla rader under ${fname}, eller ta bort tomma rader.`);
    if (pf.times.some(t => !t.days.length)) return err(`Välj minst en veckodag för alla tider under ${fname}.`);
  }

  // Ta bort helt tomma kontakter
  d.contacts = d.contacts.filter(c => [c.name, c.role, c.phone, c.email].some(v => v && v.trim()));
  const clean = normPlace({ ...d, id: editingId || uid() });

  if (editingId) {
    const i = placeData.places.findIndex(p => p.id === editingId);
    // Spara bara om något faktiskt ändrats, så att det inte blir en tom "ändring"
    if (JSON.stringify(placeData.places[i]) !== JSON.stringify(clean)) placeData.places[i] = clean;
  } else {
    placeData.places.push(clean);
  }
  lastCategoryId = clean.categoryId;
  setCatVisible(clean.categoryId, true);

  leaveEditor();
  refreshPlaces();
}

async function deleteEditedPlace() {
  if (!await uiConfirm(`Ta bort "${editDraft.name || 'platsen'}"?`, 'Ta bort', true)) return;
  placeData.places = placeData.places.filter(p => p.id !== editingId);
  leaveEditor();
  refreshPlaces();
}

// ---------- Välj plats i kartan ----------
const banner = h('div', { class: 'map-banner', hidden: true }, 'Klicka i kartan där platsen ligger (Esc avbryter)');
document.body.append(banner);

function startPlacePick() {
  if (typeof cancelRoutePick === 'function') cancelRoutePick();
  placePicking = true;
  placesDlg.close();
  banner.hidden = false;
  map.getContainer().style.cursor = 'crosshair';
}

// Anropas även från route.js när man börjar välja ett ruttstopp i kartan
function setPlacePicking(on) {
  if (on) { startPlacePick(); return; }
  if (!placePicking) return;
  placePicking = false;
  banner.hidden = true;
  map.getContainer().style.cursor = '';
  if (editDraft && !placesDlg.open) placesDlg.showModal();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && placePicking) setPlacePicking(false);
});

map.on('click', async e => {
  if (!placePicking || !editDraft) return;
  const d = editDraft;
  const { lat, lng } = e.latlng;
  d.lat = lat;
  d.lon = lng;
  d.address = 'Hämtar adress…';
  setDraftMarker(lat, lng);
  setPlacePicking(false);
  renderEditor();
  const addr = await reverseGeocode(lat, lng);
  if (editDraft === d) {
    d.address = addr;
    const input = el('pe-addr');
    if (input) input.value = addr;
  }
});

// ---------- Förslag i adressfält (används av app.js) ----------
function getPlaceSuggestions(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  return placeData.places
    .filter(p => {
      const c = catById(p.categoryId);
      return `${p.name} ${p.address} ${c ? c.name : ''}`.toLowerCase().includes(q);
    })
    .slice(0, 5)
    .map(p => {
      const c = catById(p.categoryId);
      return {
        name: p.name,
        main: p.name,
        iconHtml: `<span class="badge sug-badge${onColorClass(c && c.color)}" style="${colorStyle(c && c.color)}">${iconHtml(c && c.icon)}</span>`,
        place: [c && c.name, p.address].filter(Boolean).join(' · '),
        full: placeLabel(p),
        lat: p.lat,
        lon: p.lon
      };
    });
}

// ---------- Start ----------
redraw();
