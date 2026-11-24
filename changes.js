// TransportLathund – ändringar sedan senaste fil, ångra, och sparning/inläsning av JSON-fil
//
// Så fungerar det:
// - All data sparas löpande i webbläsaren (localStorage) där sidan används, så inget försvinner vid omladdning.
// - "Spara till fil" laddar ner allt som en JSON-fil (säkerhetskopia, eller för att flytta till en annan dator).
// - "Öppna datafil" läser in en sådan fil och ersätter det som finns i webbläsaren.
// - "baseline" är innehållet i den senast sparade/inlästa filen. Ändringar = skillnaden mot den,
//   per plats/kategori/flöde/speditör. Varje ändring kan ångras för sig.
// - Finns ingen data i webbläsaren vid start visas en välkomstruta där man kan läsa in en fil.

const BASELINE_KEY = 'transportlathund.baseline';
const KIND_LABEL = { places: 'Platser', categories: 'Kategorier', flows: 'Flöden', carriers: 'Speditörer' };
const KINDS = Object.keys(KIND_LABEL);
const TYPE_LABEL = { added: 'Ny', removed: 'Borttagen', modified: 'Ändrad' };
const changesDlg = el('changesDialog');

let baseline = null;       // { data, fileName, savedAt }

try {
  const b = JSON.parse(recall(BASELINE_KEY));
  if (b && b.data) baseline = { ...b, data: normalizeData(b.data) };
} catch { /* ignoreras */ }

// Be webbläsaren att inte rensa lagringen automatiskt
try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch { /* ignoreras */ }

const baseData = () => (baseline ? baseline.data : emptyData());

function setBaseline(fileName, savedAt) {
  baseline = { data: clone(placeData), fileName, savedAt: savedAt || new Date().toISOString() };
  store(BASELINE_KEY, JSON.stringify(baseline));
}

// ---------- Beräkna ändringar ----------
function computeChanges() {
  const base = baseData();
  const out = [];
  for (const kind of KINDS) {
    const before = new Map(base[kind].map(x => [x.id, x]));
    const now = new Set(placeData[kind].map(x => x.id));
    for (const item of placeData[kind]) {
      const b = before.get(item.id);
      if (!b) out.push({ kind, type: 'added', id: item.id, item });
      else if (JSON.stringify(b) !== JSON.stringify(item)) out.push({ kind, type: 'modified', id: item.id, item, before: b });
    }
    for (const b of base[kind]) {
      if (!now.has(b.id)) out.push({ kind, type: 'removed', id: b.id, item: b });
    }
  }
  return out;
}

// Slår upp kategori/flöde även om det bara finns i baseline (t.ex. borttaget)
const anyCat = id => catById(id) || baseData().categories.find(c => c.id === id);
const anyFlow = id => flowById(id) || baseData().flows.find(f => f.id === id);
const flowName = id => (anyFlow(id) || {}).name || 'okänt flöde';
const anyCarrier = id => carrierById(id) || baseData().carriers.find(s => s.id === id);
const carrierName = id => (id ? (anyCarrier(id) || {}).name || 'okänd speditör' : 'ingen');
const contactLabel = c => c.name || c.role || c.phone || c.email || 'kontakt';

function diffById(before, after, key = 'id') {
  const b = new Map(before.map(x => [x[key], x]));
  const a = new Map(after.map(x => [x[key], x]));
  return {
    added: after.filter(x => !b.has(x[key])),
    removed: before.filter(x => !a.has(x[key])),
    changed: after.filter(x => b.has(x[key]) && JSON.stringify(b.get(x[key])) !== JSON.stringify(x)).map(x => [b.get(x[key]), x])
  };
}

function describePlaceDiff(b, a) {
  const lines = [];
  if (b.name !== a.name) lines.push(`Namn: ${b.name} → ${a.name}`);
  if (b.address !== a.address) lines.push(`Adress: ${b.address || '–'} → ${a.address || '–'}`);
  else if (b.lat !== a.lat || b.lon !== a.lon) lines.push('Position ändrad');
  if (b.categoryId !== a.categoryId) lines.push(`Kategori: ${(anyCat(b.categoryId) || {}).name || '?'} → ${(anyCat(a.categoryId) || {}).name || '?'}`);
  if (b.note !== a.note) lines.push('Anteckning ändrad');

  const ctx = c => (c.flowId ? ` (${flowName(c.flowId)})` : '');
  const cd = diffById(b.contacts, a.contacts);
  cd.added.forEach(c => lines.push(`Kontakt tillagd: ${contactLabel(c)}${ctx(c)}`));
  cd.removed.forEach(c => lines.push(`Kontakt borttagen: ${contactLabel(c)}${ctx(c)}`));
  cd.changed.forEach(([, c]) => lines.push(`Kontakt ändrad: ${contactLabel(c)}${ctx(c)}`));

  const fd = diffById(b.flows, a.flows, 'flowId');
  fd.added.forEach(pf => lines.push(`Flöde tillagt: ${flowName(pf.flowId)}${pf.times.length ? ` (${pf.times.length} tider)` : ''}`));
  fd.removed.forEach(pf => lines.push(`Flöde borttaget: ${flowName(pf.flowId)}`));
  fd.changed.forEach(([bf, af]) => {
    const fn = flowName(af.flowId);
    const td = diffById(bf.times, af.times);
    td.added.forEach(t => lines.push(`${fn}: ny tid – ${timeText(t)}`));
    td.removed.forEach(t => lines.push(`${fn}: tid borttagen – ${timeText(t)}`));
    td.changed.forEach(([bt, at]) => lines.push(`${fn}: ${timeText(bt)} → ${timeText(at)}`));
    if (bf.note !== af.note) lines.push(`${fn}: anteckning ändrad`);
  });
  return lines;
}

function describe(ch) {
  const it = ch.item;
  if (ch.kind === 'places') {
    if (ch.type === 'modified') return describePlaceDiff(ch.before, it);
    if (ch.type === 'added') {
      return [
        `${(anyCat(it.categoryId) || {}).name || '?'}${it.address ? ' · ' + it.address : ''}`,
        it.flows.length ? 'Flöden: ' + it.flows.map(pf => flowName(pf.flowId)).join(', ') : null
      ].filter(Boolean);
    }
    return [it.address].filter(Boolean);
  }
  if (ch.kind === 'carriers' && ch.type === 'added') {
    return it.contacts.length ? [`${it.contacts.length} kontakter`] : [];
  }
  if (ch.kind === 'flows' && ch.type === 'added') {
    return it.carrierId ? [`Speditör: ${carrierName(it.carrierId)}`] : [];
  }
  if (ch.type !== 'modified') return [];
  const b = ch.before;
  const lines = [
    b.name !== it.name ? `Namn: ${b.name} → ${it.name}` : null,
    b.icon !== it.icon ? `Ikon: ${iconLabel(b.icon) || '–'} → ${iconLabel(it.icon) || '–'}` : null,
    b.color !== it.color ? 'Färg ändrad' : null,
    ch.kind === 'flows' && b.carrierId !== it.carrierId ? `Speditör: ${carrierName(b.carrierId)} → ${carrierName(it.carrierId)}` : null
  ];
  if (ch.kind === 'carriers') {
    if (b.note !== it.note) lines.push('Anteckning ändrad');
    const cd = diffById(b.contacts, it.contacts);
    cd.added.forEach(c => lines.push(`Kontakt tillagd: ${contactLabel(c)}`));
    cd.removed.forEach(c => lines.push(`Kontakt borttagen: ${contactLabel(c)}`));
    cd.changed.forEach(([, c]) => lines.push(`Kontakt ändrad: ${contactLabel(c)}`));
  }
  return lines.filter(Boolean);
}

// ---------- Ångra ----------
function undoChange(ch) {
  const list = placeData[ch.kind];
  if (ch.type === 'added') {
    if (ch.kind === 'categories') {
      const n = placesInCategory(ch.id).length;
      if (n) { uiAlert(`Kategorin "${ch.item.name}" används av ${n} platser. Ångra eller flytta dem först.`); return; }
    }
    if (ch.kind === 'flows') {
      const n = placesWithFlow(ch.id).length;
      if (n) { uiAlert(`Flödet "${ch.item.name}" är kopplat till ${n} platser. Ångra eller koppla bort det först.`); return; }
    }
    if (ch.kind === 'carriers') {
      const n = flowsWithCarrier(ch.id).length;
      if (n) { uiAlert(`Speditören "${ch.item.name}" kör ${n} ${n === 1 ? 'flöde' : 'flöden'}. Ångra eller byt speditör på flödena först.`); return; }
    }
    placeData[ch.kind] = list.filter(x => x.id !== ch.id);
  } else {
    const base = baseData()[ch.kind];
    const original = clone(base.find(x => x.id === ch.id));
    if (ch.type === 'modified') {
      list[list.findIndex(x => x.id === ch.id)] = original;
    } else {
      list.splice(Math.min(base.findIndex(x => x.id === ch.id), list.length), 0, original);
    }
    // Ett återställt flöde behöver sin speditör
    const ensureCarrier = id => {
      if (!id || carrierById(id)) return;
      const s = baseData().carriers.find(x => x.id === id);
      if (s) placeData.carriers.push(clone(s));
    };
    // En återställd plats behöver sin kategori och sina flöden
    if (ch.kind === 'places') {
      if (!catById(original.categoryId)) {
        const c = baseData().categories.find(x => x.id === original.categoryId);
        if (c) placeData.categories.push(clone(c));
      }
      original.flows.forEach(pf => {
        if (!flowById(pf.flowId)) {
          const f = baseData().flows.find(x => x.id === pf.flowId);
          if (f) { placeData.flows.push(clone(f)); ensureCarrier(f.carrierId); }
        }
      });
    }
    if (ch.kind === 'flows') ensureCarrier(original.carrierId);
  }
  refreshPlaces();
}

async function undoAll() {
  const n = computeChanges().length;
  if (!n) return;
  const msg = baseline
    ? `Ångra alla ${n} ändringar och återgå till ${baseline.fileName || 'senast sparade läge'}?`
    : 'Det finns ingen sparad datafil ännu. Att ångra allt tömmer alla platser, kategorier och flöden. Fortsätta?';
  if (!await uiConfirm(msg, 'Ångra alla', true)) return;
  placeData = clone(baseData());
  refreshPlaces();
}

// ---------- Fil ----------
const pad = n => String(n).padStart(2, '0');
function fileNameFor(d) {
  return `transportlathund_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.json`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const countText = d => `${arr(d.places).length} platser, ${arr(d.categories).length} kategorier, ${arr(d.flows).length} flöden` +
  (arr(d.carriers).length ? `, ${arr(d.carriers).length} speditörer` : '');

function downloadFile(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Laddar ner all data som en JSON-fil
function saveToFile() {
  const now = new Date();
  const name = fileNameFor(now);
  downloadFile(name, JSON.stringify({ app: 'TransportLathund', version: 4, savedAt: now.toISOString(), ...placeData }, null, 2));
  setBaseline(name, now.toISOString());
  updateStatus();
}

// Läs in en datafil (ersätter allt i webbläsaren)
const fileOpener = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
document.body.append(fileOpener);
let openingFromWelcome = false;   // välkomstrutan: inget att ersätta, så ingen fråga
fileOpener.onchange = async () => {
  const f = fileOpener.files[0];
  fileOpener.value = '';
  if (!f) return;
  let raw;
  try { raw = JSON.parse(await f.text()); } catch (e) { uiAlert('Filen är inte giltig JSON: ' + e.message); return; }
  if (!raw || !Array.isArray(raw.categories) || !Array.isArray(raw.places)) {
    uiAlert('Filen ser inte ut som en datafil från TransportLathund.\n\nFör att lägga till platser från en egen lista, använd Platser → Importera JSON.');
    return;
  }
  const d = normalizeData(raw);
  const ask = !openingFromWelcome;
  openingFromWelcome = false;
  if (ask && !await uiConfirm(`Öppna ${f.name}?\n${countText(d)}\n\nAllt som finns sparat i webbläsaren nu (${countText(placeData)}) ersätts.`, 'Öppna', true)) return;
  placeData = d;
  setBaseline(f.name, raw.savedAt);
  refreshPlaces();
};
fileOpener.addEventListener('cancel', () => { openingFromWelcome = false; });
const openDataFile = () => fileOpener.click();

// ---------- Statusrutan uppe till höger ----------
function updateStatus() {
  const box = el('saveStatus');
  const n = computeChanges().length;
  box.innerHTML = '';
  box.classList.toggle('dirty', n > 0);

  if (!baseline) {
    box.append(h('button', { type: 'button', title: 'Läs in en sparad JSON-fil', onclick: openDataFile }, fa('folder-open'), ' Öppna datafil'));
  }
  if (n) {
    box.append(
      h('button', { type: 'button', title: 'Visa ändringar sedan senaste fil', onclick: openChangesDialog },
        h('span', { class: 'ss-dot' }, '●'), ` ${n} ${n === 1 ? 'ändring' : 'ändringar'} ej i fil`),
      h('button', { type: 'button', class: 'ss-save', title: 'Ladda ner all data som JSON (Ctrl+S)', onclick: saveToFile }, fa('download'), ' Spara till fil'));
  } else if (baseline && baseline.fileName) {
    box.append(h('button', { type: 'button', title: baseline.fileName, onclick: openChangesDialog },
      h('span', { class: 'ss-ok' }, fa('check')), ` Sparat ${fmtDate(baseline.savedAt)}`));
  }
  if (changesDlg.open) renderChangesView();
}

// Anropas av places.js varje gång datan ändras
function onDataChanged() { updateStatus(); }

// ---------- Modal: ändringar ----------
function openChangesDialog() {
  closeAllDialogs();
  renderChangesView();
  changesDlg.showModal();
}

function fileInfo() {
  const parts = [h('div', { class: 'muted small' }, 'All data sparas automatiskt i den här webbläsaren. Spara till fil för att ha en säkerhetskopia, eller för att flytta datan till en annan dator eller webbläsare.')];
  if (baseline && baseline.fileName) {
    parts.unshift(h('div', {}, 'Senaste fil: ', h('code', {}, baseline.fileName), ` (${fmtDate(baseline.savedAt)})`));
  } else {
    parts.unshift(h('div', {}, 'Ingen fil sparad eller inläst ännu.'));
  }
  return h('div', { class: 'file-info' },
    h('div', { class: 'fi-main' }, parts),
    h('button', { type: 'button', class: 'secondary small', onclick: openDataFile }, fa('folder-open'), ' Öppna datafil'));
}

function renderChangesView() {
  const view = el('changesView');
  const changes = computeChanges();
  const body = h('div', { class: 'dlg-body' }, fileInfo());

  if (!changes.length) {
    body.append(h('div', { class: 'empty' }, 'Inga ändringar sedan senaste fil.'));
  }
  for (const kind of KINDS) {
    const list = changes.filter(c => c.kind === kind);
    if (!list.length) continue;
    const group = h('div', { class: 'chg-group' }, h('h3', {}, `${KIND_LABEL[kind]} (${list.length})`));
    list.forEach(ch => {
      const icon = ch.kind === 'places' ? anyCat(ch.item.categoryId) : ch.item;
      const lines = describe(ch);
      group.append(h('div', { class: 'chg-row' },
        badge(icon),
        h('div', { class: 'chg-main' },
          h('div', {}, h('span', { class: 'chg-type ' + ch.type }, TYPE_LABEL[ch.type]), h('strong', {}, ch.item.name)),
          lines.length ? h('ul', {}, lines.map(l => h('li', {}, l))) : null),
        h('button', { type: 'button', class: 'small secondary', title: 'Återställ till hur det var i senaste filen', onclick: () => undoChange(ch) }, '↶ Ångra')));
    });
    body.append(group);
  }

  view.innerHTML = '';
  view.append(
    dlgHead(changes.length ? `Ändringar sedan senaste fil (${changes.length})` : 'Data och fil', () => changesDlg.close()),
    body,
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', class: 'danger', disabled: !changes.length, onclick: undoAll }, 'Ångra alla'),
      h('span', { class: 'spacer muted small' }, 'Tips: Ctrl+S sparar till fil'),
      h('button', { type: 'button', onclick: saveToFile }, fa('download'), ' Spara till fil')));
}

// Ctrl+S sparar
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveToFile();
  }
});

// ---------- Välkomstruta när inget finns sparat i webbläsaren ----------
async function showWelcome() {
  const choice = await uiDialog(
    'Välkommen till TransportLathund!\n\nDet finns ingen data sparad i den här webbläsaren. Har du en sparad JSON-fil kan du läsa in den. Annars börjar du med några standardkategorier och flöden.',
    { buttons: [
      { label: 'Börja från början', value: 'fresh', class: 'secondary' },
      { label: 'Läs in JSON-fil…', value: 'file' }
    ] });
  if (choice === 'file') { openingFromWelcome = true; openDataFile(); }
  else persistPlaces();   // spara standarddatan så att rutan inte visas igen
}

// ---------- Start ----------
updateStatus();
if (!hadLocalData) showWelcome();
