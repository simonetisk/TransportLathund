// TransportLathund – export till och import från Excel (.xlsx)
//
// Excel-filen innehåller ALL data, uppdelad på blad som i appen:
//   Verksamheter, Flöden per verksamhet (en rad per tid), Kontakter, Flöden,
//   Speditörer, Speditörskontakter och Kategorier (+ ett "Läs mig"-blad).
// Bladen hänger ihop via namn (det man ser), inte via id. Kolumnen "ID" längst till
// höger gör att appen känner igen poster som bytt namn; den kan lämnas tom på nya rader.
// Import ersätter allt i appen med innehållet i filen, efter en sammanfattning av vad som ändras.
//
// Biblioteket ExcelJS laddas först när det behövs (det är stort).

const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
const XL_EXTRA_ROWS = 1000;   // så många tomma rader får rullistor och formler efter sista raden

let excelJsLoading = null;
function loadExcelJs() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelJsLoading) {
    excelJsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = EXCELJS_URL;
      s.onload = () => resolve(window.ExcelJS);
      s.onerror = () => { excelJsLoading = null; reject(new Error('Kunde inte ladda Excel-stödet (ingen internetanslutning?)')); };
      document.head.append(s);
    });
  }
  return excelJsLoading;
}

// ---------- Bladens uppbyggnad ----------
// key = fältets namn i koden, header = rubriken i Excel, width = kolumnbredd
const XL = {
  places: { name: 'Verksamheter', cols: [
    { key: 'name', header: 'Namn', width: 40 },
    { key: 'category', header: 'Kategori', width: 20 },
    { key: 'address', header: 'Adress', width: 42 },
    { key: 'lat', header: 'Lat', width: 11 },
    { key: 'lon', header: 'Lon', width: 11 },
    { key: 'position', header: 'Position', width: 16 },
    { key: 'note', header: 'Anteckning', width: 40 },
    { key: 'id', header: 'ID', width: 15 }
  ] },
  placeFlows: { name: 'Flöden per verksamhet', cols: [
    { key: 'place', header: 'Verksamhet', width: 40 },
    { key: 'flow', header: 'Flöde', width: 20 },
    { key: 'carrier', header: 'Speditör (automatisk)', width: 22, auto: true },
    { key: 'type', header: 'Typ', width: 12 },
    { key: 'days', header: 'Dagar', width: 16 },
    { key: 'from', header: 'Från', width: 8 },
    { key: 'to', header: 'Till', width: 8 },
    { key: 'timeNote', header: 'Tidsnotering', width: 30 },
    { key: 'flowNote', header: 'Flödesanteckning', width: 36 }
  ] },
  contacts: { name: 'Kontakter', cols: [
    { key: 'place', header: 'Verksamhet', width: 40 },
    { key: 'flow', header: 'Gäller flöde', width: 18 },
    { key: 'name', header: 'Namn', width: 24 },
    { key: 'role', header: 'Roll', width: 22 },
    { key: 'phone', header: 'Telefon', width: 16 },
    { key: 'email', header: 'E-post', width: 30 }
  ] },
  flows: { name: 'Flöden', cols: [
    { key: 'name', header: 'Namn', width: 24 },
    { key: 'carrier', header: 'Speditör', width: 22 },
    { key: 'color', header: 'Färg', width: 10 },
    { key: 'icon', header: 'Ikon', width: 16 },
    { key: 'id', header: 'ID', width: 15 }
  ] },
  carriers: { name: 'Speditörer', cols: [
    { key: 'name', header: 'Namn', width: 24 },
    { key: 'note', header: 'Anteckning', width: 40 },
    { key: 'color', header: 'Färg', width: 10 },
    { key: 'icon', header: 'Ikon', width: 16 },
    { key: 'id', header: 'ID', width: 15 }
  ] },
  carrierContacts: { name: 'Speditörskontakter', cols: [
    { key: 'carrier', header: 'Speditör', width: 24 },
    { key: 'name', header: 'Namn', width: 24 },
    { key: 'role', header: 'Roll', width: 22 },
    { key: 'phone', header: 'Telefon', width: 16 },
    { key: 'email', header: 'E-post', width: 30 }
  ] },
  categories: { name: 'Kategorier', cols: [
    { key: 'name', header: 'Namn', width: 24 },
    { key: 'color', header: 'Färg', width: 10 },
    { key: 'icon', header: 'Ikon', width: 16 },
    { key: 'id', header: 'ID', width: 15 }
  ] }
};
const XL_ORDER = ['places', 'placeFlows', 'contacts', 'flows', 'carriers', 'carrierContacts', 'categories'];
const POSITION_TEXT = { '': 'Exakt', street: 'Ungefär (väg)', area: 'Ungefär (ort)' };
const TEXT_KEYS = ['phone', 'from', 'to', 'days', 'id', 'name', 'address'];   // lagras som text så att Excel inte tolkar om dem

const README = [
  ['TransportLathund – datafil', 'title'],
  ['Den här filen innehåller all data från TransportLathund. Redigera den här, och läs in den på sidan igen för att se den på kartan.', ''],
  ['', ''],
  ['Bladen', 'h'],
  ['Verksamheter – en rad per verksamhet med namn, kategori och adress.', ''],
  ['Flöden per verksamhet – en rad per hämtnings-/leveranstid. En verksamhet med flera flöden har flera rader. Ett flöde utan tider = en rad med bara Verksamhet och Flöde.', ''],
  ['Kontakter – kontaktpersoner på verksamheterna. Fyll i "Gäller flöde" om kontakten bara gäller ett visst flöde.', ''],
  ['Flöden – flödestyperna (Textil, Post, Prover …) och vilken speditör som kör dem.', ''],
  ['Speditörer och Speditörskontakter – speditörerna och deras kontaktpersoner.', ''],
  ['Kategorier – typer av verksamheter (Hälsocentral, Sjukhus …).', ''],
  ['', ''],
  ['Så fungerar det', 'h'],
  ['• Bladen hänger ihop via namnen. Välj helst namn ur rullistan, så att stavningen blir exakt rätt.', ''],
  ['• Byter du namn på en verksamhet/ett flöde/en speditör: byt det på alla blad där det används.', ''],
  ['• Nya rader: lämna ID tomt. Ändra aldrig ett befintligt ID – det är så sidan känner igen posten.', ''],
  ['• Lat/Lon tomma → sidan söker upp adressen. Ändrar du adressen räcker det att ändra Adress; positionen söks upp på nytt.', ''],
  ['• Dagar skrivs t.ex. "Mån–Fre", "Mån, Ons, Fre", "Vardagar" eller "Alla dagar". Tider skrivs "08:00".', ''],
  ['• Typ är Hämtning eller Leverans.', ''],
  ['• "Speditör (automatisk)" räknas fram från bladet Flöden – ändra speditör där.', ''],
  ['• Färg skrivs som #rrggbb. Ikon är ett namn från fontawesome.com, t.ex. truck eller house-medical.', ''],
  ['• Tar du bort en rad här försvinner den från sidan när filen läses in.', ''],
  ['', ''],
  ['Läs in filen på sidan: Data → Öppna fil (JSON eller Excel).', '']
];

const xlRange = (sheetName, col, rows) => `'${sheetName}'!$${col}$2:$${col}$${rows}`;
const colLetter = i => String.fromCharCode(65 + i);   // räcker för A–Z
const argb = hex => 'FF' + safeColor(hex).slice(1).toUpperCase();
const iconText = ic => (isFa(ic) ? ic.slice(3) : str(ic));

// ---------- Export ----------
function buildWorkbook(ExcelJS, d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TransportLathund';
  wb.created = new Date();

  const cat = id => d.categories.find(c => c.id === id);
  const flow = id => d.flows.find(f => f.id === id);
  const carrier = id => (id ? d.carriers.find(s => s.id === id) : null);
  const byName = list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  // Läs mig
  const rm = wb.addWorksheet('Läs mig', { properties: { tabColor: { argb: 'FF8EA8F5' } } });
  rm.getColumn(1).width = 120;
  README.forEach(([text, kind]) => {
    const c = rm.addRow([text]).getCell(1);
    c.alignment = { wrapText: true, vertical: 'top' };
    if (kind === 'title') c.font = { bold: true, size: 16 };
    if (kind === 'h') c.font = { bold: true, size: 12 };
  });

  const rows = {
    places: byName(d.places).map(p => ({
      name: p.name, category: (cat(p.categoryId) || {}).name || '', address: p.address,
      lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6,
      position: POSITION_TEXT[p.approx || ''], note: p.note, id: p.id
    })),
    placeFlows: [], contacts: [], carrierContacts: [],
    flows: byName(d.flows).map(f => ({ name: f.name, carrier: (carrier(f.carrierId) || {}).name || '', color: f.color, icon: iconText(f.icon), id: f.id })),
    carriers: byName(d.carriers).map(s => ({ name: s.name, note: s.note, color: s.color, icon: iconText(s.icon), id: s.id })),
    categories: byName(d.categories).map(c => ({ name: c.name, color: c.color, icon: iconText(c.icon), id: c.id }))
  };
  byName(d.places).forEach(p => {
    const pfs = [...p.flows].sort((a, b) => str((flow(a.flowId) || {}).name).localeCompare(str((flow(b.flowId) || {}).name), 'sv'));
    pfs.forEach(pf => {
      const f = flow(pf.flowId);
      if (!f) return;
      const base = { place: p.name, flow: f.name, carrier: (carrier(f.carrierId) || {}).name || '' };
      const times = sortTimes(pf.times);
      if (!times.length) rows.placeFlows.push({ ...base, flowNote: pf.note });
      times.forEach((t, i) => rows.placeFlows.push({
        ...base, type: TIME_TYPES[t.type], days: formatDays(t.days), from: t.from, to: t.to, timeNote: t.note,
        flowNote: i === 0 ? pf.note : ''
      }));
    });
    p.contacts.forEach(c => rows.contacts.push({
      place: p.name, flow: c.flowId ? (flow(c.flowId) || {}).name || '' : '', name: c.name, role: c.role, phone: c.phone, email: c.email
    }));
  });
  byName(d.carriers).forEach(s => s.contacts.forEach(c => rows.carrierContacts.push({
    carrier: s.name, name: c.name, role: c.role, phone: c.phone, email: c.email
  })));

  const sheets = {};
  XL_ORDER.forEach(kind => {
    const def = XL[kind];
    const ws = wb.addWorksheet(def.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = def.cols.map(c => ({ key: c.key, header: c.header, width: c.width }));
    def.cols.forEach((c, i) => {
      if (TEXT_KEYS.includes(c.key)) ws.getColumn(i + 1).numFmt = '@';
    });
    rows[kind].forEach(r => ws.addRow(r));
    sheets[kind] = { ws, def, last: Math.max(rows[kind].length + 1, 2) + XL_EXTRA_ROWS };
  });

  // Rubrikrad, filter, grå ID-/autokolumner och färgrutor
  XL_ORDER.forEach(kind => {
    const { ws, def, last } = sheets[kind];
    const header = ws.getRow(1);
    header.height = 22;
    header.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF34495E' } };
      c.alignment = { vertical: 'middle' };
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: def.cols.length } };
    def.cols.forEach((c, i) => {
      if (c.key === 'id' || c.auto) {
        header.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F8C8D' } };
        ws.getColumn(i + 1).font = { color: { argb: 'FF888888' }, italic: true };
        header.getCell(i + 1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      }
      if (c.key === 'color') {
        ws.getColumn(i + 1).eachCell((cell, r) => {
          if (r > 1 && /^#[0-9a-f]{6}$/i.test(str(cell.value))) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(cell.value) } };
            cell.font = { color: { argb: isLightColor(cell.value) ? 'FF222222' : 'FFFFFFFF' } };
          }
        });
      }
    });
    if (def.cols.some(c => c.key === 'id')) {
      header.getCell(def.cols.length).note = 'Fylls i av sidan. Lämna tomt på nya rader och ändra inte befintliga.';
    }
  });

  // Rullistor (varnar men tillåter annat, så att man kan skriva in nytt först)
  const list = (kind, colKey, formula, prompt, strict) => {
    const { ws, def, last } = sheets[kind];
    const i = def.cols.findIndex(c => c.key === colKey);
    ws.dataValidations.add(`${colLetter(i)}2:${colLetter(i)}${last}`, {
      type: 'list', allowBlank: true, formulae: [formula],
      showErrorMessage: true, errorStyle: strict ? 'stop' : 'warning',
      errorTitle: 'Okänt värde', error: prompt, showInputMessage: false
    });
  };
  const nameRange = kind => xlRange(XL[kind].name, 'A', sheets[kind].last);
  list('places', 'category', nameRange('categories'), 'Kategorin finns inte på bladet Kategorier. Den skapas när filen läses in.');
  list('placeFlows', 'place', nameRange('places'), 'Verksamheten finns inte på bladet Verksamheter.');
  list('placeFlows', 'flow', nameRange('flows'), 'Flödet finns inte på bladet Flöden. Det skapas när filen läses in.');
  list('placeFlows', 'type', '"Hämtning,Leverans"', 'Välj Hämtning eller Leverans.', true);
  list('contacts', 'place', nameRange('places'), 'Verksamheten finns inte på bladet Verksamheter.');
  list('contacts', 'flow', nameRange('flows'), 'Flödet finns inte på bladet Flöden.');
  list('flows', 'carrier', nameRange('carriers'), 'Speditören finns inte på bladet Speditörer. Den skapas när filen läses in.');
  list('carrierContacts', 'carrier', nameRange('carriers'), 'Speditören finns inte på bladet Speditörer.');
  list('places', 'position', '"Exakt,Ungefär (väg),Ungefär (ort)"', 'Välj Exakt, Ungefär (väg) eller Ungefär (ort).', true);

  // Speditör (automatisk): slås upp från bladet Flöden
  {
    const { ws, def, last } = sheets.placeFlows;
    const fi = def.cols.findIndex(c => c.key === 'flow');
    const ci = def.cols.findIndex(c => c.key === 'carrier');
    const fl = XL.flows.name;
    for (let r = 2; r <= last; r++) {
      const cell = ws.getRow(r).getCell(ci + 1);
      const result = str(cell.value);
      cell.value = { formula: `IF(${colLetter(fi)}${r}="","",IFERROR(VLOOKUP(${colLetter(fi)}${r},'${fl}'!$A:$B,2,FALSE)&"",""))`, result };
    }
  }
  return wb;
}

async function exportToExcel() {
  let ExcelJS;
  try { ExcelJS = await loadExcelJs(); } catch (e) { uiAlert(e.message); return; }
  const now = new Date();
  const name = fileNameFor(now).replace(/\.json$/, '.xlsx');
  const buf = await buildWorkbook(ExcelJS, placeData).xlsx.writeBuffer();
  downloadFile(name, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  setBaseline(name, now.toISOString());
  updateStatus();
}

// ---------- Import ----------
// Cellens innehåll som text (klarar formler, länkar, formaterad text och tider)
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    if (v.getUTCFullYear() < 1901) {   // en ren tid, t.ex. 08:00
      const mins = Math.round((v.getUTCHours() * 60 + v.getUTCMinutes() + v.getUTCSeconds() / 60));
      return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
    }
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('').trim();
    if ('formula' in v || 'sharedFormula' in v) return cellText(v.result);
    if ('text' in v) return cellText(v.text);
    if ('error' in v) return '';
    return '';
  }
  return String(v).trim();
}
// Tid som tal (andel av dygn), t.ex. 0.375 = 09:00
function timeCell(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  return cellText(v);
}

const normHeader = s => str(s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[*:]/g, '').trim();

// Läser ett blad till en lista { row, ...fält }. Kolumnerna hittas via rubrikerna (ordningen spelar ingen roll).
function readSheet(wb, kind, errors) {
  const def = XL[kind];
  const ws = wb.worksheets.find(w => normHeader(w.name) === normHeader(def.name));
  if (!ws) return null;
  const colOf = {};
  ws.getRow(1).eachCell((c, i) => {
    const hdr = normHeader(cellText(c.value));
    const col = def.cols.find(x => normHeader(x.header) === hdr);
    if (col && !colOf[col.key]) colOf[col.key] = i;
  });
  if (!colOf.name && !colOf.place && !colOf.carrier) {
    errors.push(`Bladet "${def.name}": hittar inte rubrikraden (rad 1).`);
    return [];
  }
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r === 1) return;
    const o = { row: r };
    let any = false;
    def.cols.forEach(c => {
      if (!colOf[c.key] || c.auto) return;
      const raw = row.getCell(colOf[c.key]).value;
      o[c.key] = c.key === 'from' || c.key === 'to' ? timeCell(raw) : (c.key === 'lat' || c.key === 'lon') && typeof raw === 'number' ? raw : cellText(raw);
      if (o[c.key] !== '' && o[c.key] != null) any = true;
    });
    if (any) out.push(o);
  });
  return out;
}

const iconFrom = (v, fallback) => {
  const s = str(v).trim();
  if (!s) return fallback;
  if (/^(fa:)?[a-z0-9-]+$/.test(s)) return 'fa:' + s.replace(/^fa:/, '');
  return EMOJI_FA[s] ? 'fa:' + EMOJI_FA[s] : fallback;   // emoji → motsvarande ikon (places.js)
};
const colorFrom = (v, fallback) => {
  const s = str(v).trim();
  return /^#?[0-9a-f]{6}$/i.test(s) ? ('#' + s.replace('#', '')).toLowerCase() : fallback;
};

// Gör om en Excel-arbetsbok till appens data. Ändrar ingenting; returnerar { data, errors, warnings, toGeocode }.
function workbookToData(wb, current) {
  const errors = [];
  const warnings = [];
  const sheet = kind => readSheet(wb, kind, errors);
  const where = (kind, r) => `${XL[kind].name}, rad ${r.row}`;
  const key = s => str(s).trim().toLowerCase();

  const placesRows = sheet('places');
  if (placesRows == null) {
    errors.push(`Hittar inget blad som heter "${XL.places.name}". Är det rätt fil?`);
    return { errors, warnings };
  }

  // Gemensam hantering av register (kategorier, flöden, speditörer): namn är unika, id återanvänds
  const usedIds = new Set();
  function resolveId(r, kindData) {
    const id = str(r.id).trim();
    if (id && !usedIds.has(id)) { usedIds.add(id); return id; }
    const same = kindData.find(x => key(x.name) === key(r.name) && !usedIds.has(x.id));
    if (same) { usedIds.add(same.id); return same.id; }
    const nid = uid();
    usedIds.add(nid);
    return nid;
  }
  function buildRegistry(kind, rows, make) {
    const out = [];
    const names = new Map();
    (rows || []).forEach(r => {
      if (!r.name) { errors.push(`${where(kind, r)}: Namn saknas.`); return; }
      if (names.has(key(r.name))) { errors.push(`${where(kind, r)}: "${r.name}" finns redan på rad ${names.get(key(r.name))}. Namnen måste vara unika.`); return; }
      names.set(key(r.name), r.row);
      const id = resolveId(r, current[kind]);
      const old = current[kind].find(x => x.id === id) || {};
      out.push(make(r, id, old, out.length));
    });
    return out;
  }
  const findName = (list, name) => list.find(x => key(x.name) === key(name));
  // Skapar en post som används men inte finns på sitt eget blad
  function ensure(list, kind, name, make) {
    let x = findName(list, name);
    if (!x) {
      const old = findName(current[kind], name) || {};
      x = make(name, old.id && !usedIds.has(old.id) ? old.id : uid(), old, list.length);
      usedIds.add(x.id);
      list.push(x);
      warnings.push(`${{ categories: 'Kategorin', flows: 'Flödet', carriers: 'Speditören' }[kind]} "${name}" fanns inte på bladet ${XL[kind].name} och skapades.`);
    }
    return x;
  }

  const makeCarrier = (name, id, old, n, r = {}) => ({
    id, name, note: r.note != null ? r.note : str(old.note),
    color: colorFrom(r.color, old.color || PALETTE[n % PALETTE.length]),
    icon: iconFrom(r.icon, old.icon || guessIcon(name) || 'fa:truck'), contacts: []
  });
  const carriers = buildRegistry('carriers', sheet('carriers'), (r, id, old, n) => makeCarrier(r.name, id, old, n, r));
  const ensureCarrier = name => ensure(carriers, 'carriers', name, makeCarrier);

  const makeFlow = (name, id, old, n, r = {}) => ({
    id, name, color: colorFrom(r.color, old.color || PALETTE[(n + 2) % PALETTE.length]),
    icon: iconFrom(r.icon, old.icon || guessIcon(name) || 'fa:arrows-rotate'),
    carrierId: r.carrier ? ensureCarrier(r.carrier).id : (r.row ? null : old.carrierId || null)
  });
  const flows = buildRegistry('flows', sheet('flows'), (r, id, old, n) => makeFlow(r.name, id, old, n, r));
  const ensureFlow = name => ensure(flows, 'flows', name, makeFlow);

  const makeCat = (name, id, old, n, r = {}) => ({
    id, name, color: colorFrom(r.color, old.color || PALETTE[n % PALETTE.length]),
    icon: iconFrom(r.icon, old.icon || guessIcon(name) || 'fa:location-dot')
  });
  const categories = buildRegistry('categories', sheet('categories'), (r, id, old, n) => makeCat(r.name, id, old, n, r));
  const ensureCat = name => ensure(categories, 'categories', name, makeCat);

  // Speditörskontakter
  (sheet('carrierContacts') || []).forEach(r => {
    if (!r.carrier) { errors.push(`${where('carrierContacts', r)}: Speditör saknas.`); return; }
    const s = findName(carriers, r.carrier);
    if (!s) { errors.push(`${where('carrierContacts', r)}: speditören "${r.carrier}" finns inte på bladet ${XL.carriers.name}.`); return; }
    if (!r.name && !r.role && !r.phone && !r.email) return;
    s.contacts.push({ id: uid(), name: str(r.name), role: str(r.role), phone: str(r.phone), email: str(r.email) });
  });
  carriers.forEach(s => {
    const old = current.carriers.find(x => x.id === s.id);
    if (old) s.contacts = reuseIds(s.contacts, old.contacts, c => [c.name, c.role, c.phone, c.email].join('|'));
  });

  // Verksamheter
  const places = [];
  const toGeocode = [];
  const placeNames = new Map();
  placesRows.forEach(r => {
    if (!r.name) { errors.push(`${where('places', r)}: Namn saknas.`); return; }
    if (placeNames.has(key(r.name))) { errors.push(`${where('places', r)}: "${r.name}" finns redan på rad ${placeNames.get(key(r.name))}. Namnen måste vara unika.`); return; }
    placeNames.set(key(r.name), r.row);
    if (!r.category) { errors.push(`${where('places', r)}: Kategori saknas för "${r.name}".`); return; }
    const id = resolveId(r, current.places);
    const old = current.places.find(x => x.id === id);
    const p = {
      id, name: r.name, address: str(r.address), lat: null, lon: null,
      categoryId: ensureCat(r.category).id, note: str(r.note), contacts: [], flows: [], approx: ''
    };
    let lat = null, lon = null;
    try {
      lat = parseCoord(r.lat, 'lat');
      lon = parseCoord(r.lon, 'lon');
    } catch (e) { errors.push(`${where('places', r)}: ${e.message}`); return; }
    if ((lat == null) !== (lon == null)) { errors.push(`${where('places', r)}: både Lat och Lon behövs (eller ingen av dem).`); return; }
    const addrChanged = old && normAddr(old.address) !== normAddr(p.address);
    const samePosAsOld = old && lat != null && Math.abs(lat - old.lat) < 1e-5 && Math.abs(lon - old.lon) < 1e-5;
    if (lat != null && !(addrChanged && samePosAsOld)) {
      if (!SWEDEN_BOUNDS.contains([lat, lon])) { errors.push(`${where('places', r)}: ${lat}, ${lon} ligger inte i Sverige (är Lat och Lon omkastade?).`); return; }
      p.lat = lat; p.lon = lon;
      const pos = Object.keys(POSITION_TEXT).find(k => key(POSITION_TEXT[k]) === key(r.position));
      p.approx = pos != null ? pos : (samePosAsOld ? old.approx : '');
    } else if (old && !addrChanged) {
      p.lat = old.lat; p.lon = old.lon; p.approx = old.approx;
    } else if (p.address) {
      toGeocode.push(p);
    } else {
      errors.push(`${where('places', r)}: "${r.name}" har varken adress eller Lat/Lon.`);
      return;
    }
    places.push(p);
  });
  const placeByName = name => findName(places, name);

  // Flöden per verksamhet (en rad per tid)
  (sheet('placeFlows') || []).forEach(r => {
    if (!r.place) { errors.push(`${where('placeFlows', r)}: Verksamhet saknas.`); return; }
    if (!r.flow) { errors.push(`${where('placeFlows', r)}: Flöde saknas.`); return; }
    const p = placeByName(r.place);
    if (!p) { if (!placeNames.has(key(r.place))) errors.push(`${where('placeFlows', r)}: verksamheten "${r.place}" finns inte på bladet ${XL.places.name}.`); return; }
    const f = ensureFlow(r.flow);
    let pf = p.flows.find(x => x.flowId === f.id);
    if (!pf) { pf = { flowId: f.id, note: '', times: [] }; p.flows.push(pf); }
    if (r.flowNote && !pf.note.split(' / ').includes(r.flowNote)) pf.note = pf.note ? `${pf.note} / ${r.flowNote}` : r.flowNote;
    const hasTime = r.type || r.from || r.to || r.days || r.timeNote;
    if (!hasTime) return;
    try {
      pf.times.push({
        id: uid(),
        type: parseType(r.type),
        days: key(r.days) === 'inga dagar' ? [] : parseDays(r.days),
        from: parseTime(r.from, true),
        to: parseTime(r.to, false),
        note: str(r.timeNote)
      });
    } catch (e) {
      errors.push(`${where('placeFlows', r)}: ${e.message.replace('("fran")', '(Från)').replace('("hämtning" eller "leverans")', '(Hämtning eller Leverans)')}.`);
    }
  });

  // Kontakter på verksamheterna
  (sheet('contacts') || []).forEach(r => {
    if (!r.place) { errors.push(`${where('contacts', r)}: Verksamhet saknas.`); return; }
    const p = placeByName(r.place);
    if (!p) { if (!placeNames.has(key(r.place))) errors.push(`${where('contacts', r)}: verksamheten "${r.place}" finns inte på bladet ${XL.places.name}.`); return; }
    if (!r.name && !r.role && !r.phone && !r.email) return;
    let flowId = null;
    if (r.flow) {
      const f = findName(flows, r.flow);
      if (!f) { errors.push(`${where('contacts', r)}: flödet "${r.flow}" finns inte på bladet ${XL.flows.name}.`); return; }
      flowId = f.id;
    }
    p.contacts.push({ id: uid(), name: str(r.name), role: str(r.role), phone: str(r.phone), email: str(r.email), flowId });
  });

  // Behåll id:n och ordning på det som inte ändrats (så att ändringslistan bara visar riktiga ändringar)
  places.forEach(p => {
    const old = current.places.find(x => x.id === p.id);
    if (!old) return;
    p.contacts = keepOrder(reuseIds(p.contacts, old.contacts, contactSig), old.contacts, c => c.id);
    p.flows.forEach(pf => {
      const o = old.flows.find(x => x.flowId === pf.flowId);
      if (o) pf.times = keepOrder(reuseIds(pf.times, o.times, timeSig), o.times, t => t.id);
    });
    p.flows = keepOrder(p.flows, old.flows, pf => pf.flowId);
  });
  carriers.forEach(s => {
    const old = current.carriers.find(x => x.id === s.id);
    if (old) s.contacts = keepOrder(s.contacts, old.contacts, c => c.id);
  });
  const ordered = kind => list => keepOrder(list, current[kind], x => x.id);

  return {
    data: {
      categories: ordered('categories')(categories), flows: ordered('flows')(flows),
      carriers: ordered('carriers')(carriers), places: ordered('places')(places)
    },
    errors, warnings, toGeocode
  };
}

// Sorterar list i samma ordning som oldList (nya poster sist, i sin ordning)
function keepOrder(list, oldList, keyOf) {
  const idx = new Map(oldList.map((x, i) => [keyOf(x), i]));
  return list.map((x, i) => [x, idx.has(keyOf(x)) ? idx.get(keyOf(x)) : oldList.length + i])
    .sort((a, b) => a[1] - b[1]).map(a => a[0]);
}

// Liten ruta som visar hur det går medan filen läses in
function progressBox(text) {
  const msg = h('div', { class: 'uidlg-msg' }, text);
  const dlg = h('dialog', { class: 'uidlg' }, msg);
  dlg.addEventListener('cancel', e => e.preventDefault());
  document.body.append(dlg);
  dlg.showModal();
  return { set: t => { msg.textContent = t; }, close: () => { dlg.close(); dlg.remove(); } };
}

const listText = (title, lines, max = 15) => lines.length
  ? `\n\n${title}\n` + lines.slice(0, max).map(l => '• ' + l).join('\n') + (lines.length > max ? `\n… och ${lines.length - max} till` : '')
  : '';

async function importExcelFile(file) {
  const box = progressBox(`Läser in ${file.name}…`);
  let res;
  try {
    const ExcelJS = await loadExcelJs();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    res = workbookToData(wb, placeData);
  } catch (e) {
    box.close();
    uiAlert('Kunde inte läsa Excel-filen: ' + e.message);
    return;
  }
  if (res.errors.length) {
    box.close();
    uiAlert(`Filen lästes inte in, eftersom något behöver rättas i Excel först:${listText('', res.errors, 25)}\n\nInget har ändrats på sidan.`);
    return;
  }

  // Sök upp nya och ändrade adresser (flera samtidigt; svaren sparas i geocodeWithFallback)
  const failed = [];
  const queue = [...res.toGeocode];
  let done = 0;
  const total = queue.length;
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      box.set(`Söker upp adresser: ${done + 1} av ${total}…\n${p.name}`);
      try {
        const pos = await geocodeWithFallback(p.address);
        if (pos) { p.lat = pos.lat; p.lon = pos.lon; p.approx = pos.approx; } else failed.push(p);
      } catch { failed.push(p); }
      done++;
    }
  };
  if (total) await Promise.all(Array.from({ length: GEOCODE_WORKERS }, worker));
  box.close();

  const d = res.data;
  // Verksamheter vars adress inte hittades: behåll gammal position om det finns en, annars hoppa över dem
  const skipped = [];
  failed.forEach(p => {
    const old = placeData.places.find(x => x.id === p.id);
    if (old) { p.lat = old.lat; p.lon = old.lon; p.approx = old.approx; res.warnings.push(`${p.name}: nya adressen hittades inte, nålen står kvar på den gamla platsen.`); }
    else skipped.push(p);
  });
  d.places = d.places.filter(p => !skipped.includes(p));
  const approx = d.places.filter(p => p.approx && res.toGeocode.includes(p));

  const data = normalizeData(d);
  const notes = [
    [`${skipped.length} verksamheter kommer inte med – adressen hittades inte (rätta adressen eller fyll i Lat/Lon i Excel):`, skipped.map(p => `${p.name} – ${p.address}`), 15],
    [`${approx.length} får ungefärlig position (nålen har streckad kant och "?", och kan justeras på kartan):`, approx.map(p => p.name), 8],
    ['Att tänka på:', res.warnings, 8]
  ];
  if (!await previewImport(file.name, data, notes)) return;
  placeData = data;
  setBaseline(file.name, new Date(file.lastModified || Date.now()).toISOString(), 'open');
  refreshPlaces();
}

// Sista kontrollen före inläsning: visar exakt vad som skiljer mellan sidan nu och filen
// (nya, ändrade och borttagna poster), så att man kan avbryta om något ser fel ut.
// notes = [[rubrik, rader, max], …]. Svarar true om man väljer "Läs in".
function previewImport(fileName, data, notes) {
  const changes = diffData(placeData, data);
  const removed = changes.filter(c => c.type === 'removed').length;
  lookupExtra = data;   // så att nya kategorier/flöden i filen får namn i listan
  let groups;
  try { groups = changeGroups(changes); } finally { lookupExtra = null; }

  const noteBox = ([title, lines, max]) => lines.length
    ? h('div', { class: 'notice' }, h('strong', {}, title),
      h('ul', {}, lines.slice(0, max).map(l => h('li', {}, l)), lines.length > max ? h('li', {}, `… och ${lines.length - max} till`) : null))
    : null;

  return new Promise(resolve => {
    const dlg = h('dialog', { class: 'bigdlg' });
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(false); });
    dlg.append(h('div', { class: 'dlg-view' },
      dlgHead(`Läs in ${fileName}?`, () => done(false)),
      h('div', { class: 'dlg-body' },
        h('div', { class: 'file-info' }, h('div', { class: 'fi-main' },
          h('div', {}, h('strong', {}, 'Allt på sidan ersätts med innehållet i filen.')),
          h('div', { class: 'muted small' }, `Nu: ${countText(placeData)}`),
          h('div', { class: 'muted small' }, `Efter: ${countText(data)}`))),
        removed ? h('div', { class: 'notice' }, h('strong', {}, `${removed} ${removed === 1 ? 'post finns' : 'poster finns'} på sidan men inte i filen och tas bort.`),
          ' De står först i listorna nedan. Ser det fel ut: avbryt och kontrollera filen.') : null,
        notes.map(noteBox),
        changes.length ? groups : h('div', { class: 'empty' }, 'Inga skillnader mot det som finns på sidan nu.')),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'secondary', onclick: () => done(false) }, 'Avbryt'),
        h('span', { class: 'spacer muted small' }, changes.length ? `${changes.length} ${changes.length === 1 ? 'skillnad' : 'skillnader'}` : ''),
        h('button', { type: 'button', class: removed ? 'danger' : '', onclick: () => done(true) }, 'Läs in'))));
    document.body.append(dlg);
    dlg.showModal();
  });
}
