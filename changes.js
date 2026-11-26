// TransportLathund – ändringar sedan senaste fil, ångra, och sparning/inläsning av JSON-fil
//
// Så fungerar det:
// - All data sparas löpande i webbläsaren (localStorage) där sidan används, så inget försvinner vid omladdning.
// - "Spara till fil" laddar ner allt som en JSON-fil (säkerhetskopia, eller för att flytta till en annan dator).
// - "Öppna fil" läser in en sådan fil (eller en Excel-fil, se excel.js) och ersätter det som finns i webbläsaren.
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

// how: 'export' (filen laddades ner härifrån) eller 'open' (filen lästes in)
function setBaseline(fileName, savedAt, how = 'export') {
  baseline = { data: clone(placeData), fileName, savedAt: savedAt || new Date().toISOString(), how };
  store(BASELINE_KEY, JSON.stringify(baseline));
}

// ---------- Beräkna ändringar ----------
// Skillnaden mellan två versioner av datan, per plats/kategori/flöde/speditör
function diffData(base, current) {
  const out = [];
  for (const kind of KINDS) {
    const before = new Map(base[kind].map(x => [x.id, x]));
    const now = new Set(current[kind].map(x => x.id));
    for (const item of current[kind]) {
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
const computeChanges = () => diffData(baseData(), placeData);   // ändringar sedan senaste export/inläsning

// Slår upp kategori/flöde även om det bara finns i baseline (t.ex. borttaget)
// eller i en fil som håller på att läsas in (lookupExtra, sätts av excel.js)
let lookupExtra = null;
const findIn = (kind, id) => baseData()[kind].find(x => x.id === id) || (lookupExtra ? lookupExtra[kind].find(x => x.id === id) : undefined);
const anyCat = id => catById(id) || findIn('categories', id);
const anyFlow = id => flowById(id) || findIn('flows', id);
const flowName = id => (anyFlow(id) || {}).name || 'okänt flöde';
const anyCarrier = id => carrierById(id) || findIn('carriers', id);
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
  if (b.approx !== a.approx) lines.push(a.approx ? 'Position: uppskattad' : 'Position: exakt (var uppskattad)');
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
    ? `Ångra alla ${n} ändringar och återgå till hur det var i ${baseline.fileName || 'senaste filen'}?`
    : 'Ingen fil har exporterats eller lästs in ännu, så att ångra allt tömmer alla platser, kategorier, flöden och speditörer. Fortsätta?';
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

function downloadFile(name, content, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
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

// Läs in en Excel-fil (ersätter allt i webbläsaren, efter en förhandsvisning – se excel.js).
// JSON läses in via JSON-knappen under Data (import.js) och kompletterar i stället.
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileOpener = h('input', { type: 'file', accept: `.xlsx,${XLSX_TYPE}`, hidden: true });
document.body.append(fileOpener);
let openingFromWelcome = false;   // välkomstrutan
fileOpener.onchange = async () => {
  const f = fileOpener.files[0];
  fileOpener.value = '';
  openingFromWelcome = false;
  if (!f) return;
  if (/\.xlsx$/i.test(f.name)) { importExcelFile(f); return; }   // excel.js
  if (/\.xls$/i.test(f.name)) { uiAlert('Det gamla Excel-formatet (.xls) stöds inte. Spara filen som .xlsx i Excel och försök igen.'); return; }
  if (/\.json$/i.test(f.name)) { uiAlert('JSON-filer läses in via JSON-knappen under Data. Den importen kompletterar det som finns i stället för att ersätta allt.'); return; }
  uiAlert('Välj en Excel-fil (.xlsx).');
};
fileOpener.addEventListener('cancel', () => { openingFromWelcome = false; });
const openDataFile = () => fileOpener.click();

// ---------- Statusrutan uppe till höger ----------
function updateStatus() {
  const box = el('saveStatus');
  const n = computeChanges().length;
  box.innerHTML = '';
  box.classList.toggle('dirty', n > 0);

  if (n) {
    box.append(
      h('button', { type: 'button', title: 'Visa ändringar sedan senaste export (de finns sparade i webbläsaren)', onclick: openChangesDialog },
        h('span', { class: 'ss-dot' }, '●'), ` ${n} ${n === 1 ? 'ändring' : 'ändringar'}`, h('span', { class: 'ss-long' }, ' ej exporterade')),
      h('button', { type: 'button', class: 'ss-save', title: 'Ladda ner all data som Excel-fil (Ctrl+S)', onclick: () => exportToExcel() }, fa('file-excel'), ' Exportera', h('span', { class: 'ss-xl' }, ' till Excel')));
  } else if (baseline && baseline.fileName) {
    const what = baseline.how === 'open' ? 'Inläst från fil' : `Exporterat ${fmtDate(baseline.savedAt)}`;
    box.append(h('button', { type: 'button', title: `${baseline.fileName} (${fmtDate(baseline.savedAt)})`, onclick: openChangesDialog },
      h('span', { class: 'ss-ok' }, fa('check')), ' ' + what));
  }
  placeStatus();
  if (changesDlg.open) renderChangesView();
}

// Statusrutan sitter uppe till höger. Är fönstret så smalt att den skulle krocka med
// menyn eller sökfältet flyttas den ner precis under dem (fortfarande till höger).
function placeStatus() {
  const box = el('saveStatus');
  box.style.top = '';
  box.classList.remove('compact');
  if (!box.firstChild) return;
  const parts = [...document.querySelectorAll('#topbar .menubar, #topbar .filterbar > *')].map(x => x.getBoundingClientRect());
  const collides = () => {
    const a = box.getBoundingClientRect();
    return parts.some(r => r.left < a.right + 8 && r.right > a.left - 8 && r.top < a.bottom && r.bottom > a.top);
  };
  if (!collides()) return;
  box.classList.add('compact');   // först: kortare text ("3 ändringar")
  if (!collides()) return;
  box.style.top = Math.max(...parts.map(r => r.bottom)) + 8 + 'px';   // sedan: ner under menyn
}
window.addEventListener('resize', placeStatus);
if (document.fonts) document.fonts.ready.then(placeStatus);   // bredden ändras när ikonerna och typsnitten laddats

// Anropas av places.js varje gång datan ändras
function onDataChanged() { updateStatus(); }

// ---------- Modal: ändringar ----------
function openChangesDialog() {
  closeAllDialogs();
  rowUndoUnlocked = false;
  renderChangesView();
  changesDlg.showModal();
}

function fileInfo() {
  const parts = [h('div', { class: 'muted small' }, 'Excel-filen är huvudkopian: exportera, redigera i Excel och läs in den här igen. Inläsning ersätter allt på sidan, men du får se skillnaderna först. Allt du ändrar här sparas också automatiskt i den här webbläsaren, så inget försvinner om du glömmer att exportera.')];
  if (baseline && baseline.fileName) {
    parts.unshift(h('div', {}, 'Senaste fil: ', h('code', {}, baseline.fileName), ` (${fmtDate(baseline.savedAt)})`));
  } else {
    parts.unshift(h('div', {}, 'Ingen fil exporterad eller inläst ännu.'));
  }
  return h('div', { class: 'file-info' }, h('div', { class: 'fi-main' }, parts));
}

// Ångra-knapparna på enskilda rader är låsta tills man låser upp dem, så att man inte råkar
// ta bort något viktigt med ett felklick. Låses igen varje gång rutan öppnas.
let rowUndoUnlocked = false;

// Ändringarna som listor per typ (Platser, Kategorier …). extra(ch) kan lägga till en knapp per rad.
// Borttagna visas först, eftersom de är lättast att missa.
const TYPE_ORDER = { removed: 0, modified: 1, added: 2 };
function changeGroups(changes, extra) {
  return KINDS.map(kind => {
    const list = changes.filter(c => c.kind === kind).sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
    if (!list.length) return null;
    return h('div', { class: 'chg-group' }, h('h3', {}, `${KIND_LABEL[kind]} (${list.length})`),
      list.map(ch => {
        const icon = ch.kind === 'places' ? anyCat(ch.item.categoryId) : ch.item;
        const lines = describe(ch);
        return h('div', { class: 'chg-row' },
          badge(icon),
          h('div', { class: 'chg-main' },
            h('div', {}, h('span', { class: 'chg-type ' + ch.type }, TYPE_LABEL[ch.type]), h('strong', {}, ch.item.name)),
            lines.length ? h('ul', {}, lines.map(l => h('li', {}, l))) : null),
          extra ? extra(ch) : null);
      }));
  }).filter(Boolean);
}

function renderChangesView() {
  const view = el('changesView');
  const changes = computeChanges();
  const n = changes.length;

  // Ändringarna i en egen ram, med Ångra alla och låset för enskilda rader i ramens överkant
  const lockBtn = h('button', {
    type: 'button', class: 'small secondary' + (rowUndoUnlocked ? ' unlocked' : ''),
    title: rowUndoUnlocked ? 'Lås Ångra-knapparna igen' : 'Lås upp för att kunna ångra enskilda ändringar',
    onclick: () => { rowUndoUnlocked = !rowUndoUnlocked; renderChangesView(); }
  }, fa(rowUndoUnlocked ? 'lock-open' : 'lock'), rowUndoUnlocked ? ' Lås igen' : ' Lås upp ångra per rad');
  const box = h('section', { class: 'chg-box' },
    h('div', { class: 'chg-box-head' },
      h('h3', { class: 'spacer' }, n ? `Ändringar sedan senaste export (${n})` : 'Ändringar sedan senaste export'),
      n ? lockBtn : null,
      h('button', { type: 'button', class: 'small danger', disabled: !n, onclick: undoAll }, fa('rotate-left'), ' Ångra alla')),
    n ? null : h('div', { class: 'empty' }, 'Inga ändringar sedan senaste export.'),
    n && !rowUndoUnlocked ? h('div', { class: 'muted small chg-locked-hint' }, fa('lock'), ' Ångra-knapparna på raderna är låsta så att inget tas bort av misstag. Klicka på "Lås upp ångra per rad" för att använda dem.') : null,
    ...changeGroups(changes, ch => h('button', {
      type: 'button', class: 'small secondary', disabled: !rowUndoUnlocked,
      title: rowUndoUnlocked ? 'Återställ till hur det var i senaste filen' : 'Låst – klicka på "Lås upp ångra per rad" först',
      onclick: () => undoChange(ch)
    }, fa(rowUndoUnlocked ? 'rotate-left' : 'lock'), ' Ångra')));

  view.innerHTML = '';
  view.append(
    dlgHead('Data', () => changesDlg.close()),
    h('div', { class: 'dlg-body' }, fileInfo(), box),
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', title: 'Läs in en Excel-fil. Ersätter allt på sidan – du får se skillnaderna först.', onclick: openDataFile }, fa('file-import'), ' Importera från Excel'),
      h('button', { type: 'button', title: 'Ladda ner all data som Excel-fil (Ctrl+S)', onclick: () => exportToExcel() }, fa('file-export'), ' Exportera till Excel'),
      h('button', { type: 'button', class: 'secondary', title: 'Importera platser, kategorier, flöden eller speditörer från JSON. Kompletterar det som finns, tar inte bort något.', onclick: () => openImportDialog() }, fa('code'), ' JSON'),
      h('span', { class: 'spacer muted small', style: 'text-align:right' }, 'Ctrl+S exporterar till Excel')));
}

// Ctrl+S exporterar till Excel
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    exportToExcel();
  }
});

// ---------- Välkomstruta när inget finns sparat i webbläsaren ----------
async function showWelcome() {
  const choice = await uiDialog(
    'Välkommen till TransportLathund!\n\nDet finns ingen data sparad i den här webbläsaren. Har du en Excel-fil från TransportLathund kan du läsa in den. Annars börjar du med en tom lathund.',
    { buttons: [
      { label: 'Börja från början', value: 'fresh', class: 'secondary' },
      { label: 'Läs in Excel-fil…', value: 'file' }
    ] });
  if (choice === 'file') { openingFromWelcome = true; openDataFile(); }
  else persistPlaces();   // spara den tomma datan så att rutan inte visas igen
}

// ---------- Start ----------
updateStatus();
if (!hadLocalData) showWelcome();
