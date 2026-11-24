// TransportLathund – importera platser från JSON
// Formatet är gjort för att vara lätt att skriva för hand eller ta fram ur Excel:
// namn på kategorier och flöden i stället för interna id:n, svenska fältnamn
// (engelska fungerar också), och adress räcker – koordinaterna söks upp automatiskt.

const importDlg = el('importDialog');

const IMPORT_EXAMPLE = {
  platser: [
    {
      namn: 'Akademiska sjukhuset',
      kategori: 'Sjukhus',
      adress: 'Sjukhusvägen 1, 751 85 Uppsala',
      anteckning: 'Godsmottagning entré 70',
      kontakter: [
        { namn: 'Anna Andersson', roll: 'Godsmottagning', telefon: '018-611 00 00', epost: 'anna@example.se' },
        { roll: 'Växeln', telefon: '018-611 00 01' }
      ],
      floden: [
        {
          flode: 'Post',
          speditor: 'PostNord',
          anteckning: 'Lämnas i postrummet',
          tider: [
            { typ: 'hämtning', fran: '09:00', dagar: 'mån-fre' },
            { typ: 'leverans', fran: '13:00', till: '13:30', dagar: ['mån', 'ons', 'fre'], notering: 'Ring vid ankomst' }
          ],
          kontakter: [{ namn: 'Bo Berg', epost: 'bo@example.se' }]
        },
        {
          flode: 'Paket',
          speditor: 'DHL',
          tider: [{ typ: 'hämtning', fran: '15:00', dagar: 'alla' }]
        }
      ]
    },
    {
      namn: 'Gottsunda vårdcentral',
      kategori: 'Hälsocentral',
      lat: 59.809,
      lon: 17.623
    }
  ]
};

// Ikoner för nya kategorier/flöden/speditörer: gissas från namnet (guessIcon i places.js)

// ---------- Tolkning ----------
const pickKey = (o, ...keys) => {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return undefined;
};

const DAY_ALIASES = {
  'mån': 1, man: 1, 'måndag': 1, mandag: 1, mon: 1, monday: 1,
  tis: 2, tisdag: 2, tue: 2, tuesday: 2,
  ons: 3, onsdag: 3, wed: 3, wednesday: 3,
  tor: 4, tors: 4, torsdag: 4, thu: 4, thursday: 4,
  fre: 5, fredag: 5, fri: 5, friday: 5,
  'lör': 6, lor: 6, 'lördag': 6, lordag: 6, sat: 6, saturday: 6,
  'sön': 7, son: 7, 'söndag': 7, sondag: 7, sun: 7, sunday: 7
};
const DAY_GROUPS = {
  alla: [1, 2, 3, 4, 5, 6, 7], 'alla dagar': [1, 2, 3, 4, 5, 6, 7], dagligen: [1, 2, 3, 4, 5, 6, 7], 'varje dag': [1, 2, 3, 4, 5, 6, 7],
  vardagar: WEEKDAYS, vardag: WEEKDAYS, helg: [6, 7], helger: [6, 7], helgdagar: [6, 7]
};

function parseDays(v) {
  if (v == null || v === '') return [...WEEKDAYS];
  const out = new Set();
  const addToken = raw => {
    const tok = String(raw).trim().toLowerCase().replace(/\.$/, '');
    if (!tok) return;
    if (/^[1-7]$/.test(tok)) { out.add(Number(tok)); return; }
    if (DAY_GROUPS[tok]) { DAY_GROUPS[tok].forEach(d => out.add(d)); return; }
    const range = tok.split(/\s*[-–]\s*/);
    if (range.length === 2 && DAY_ALIASES[range[0]] && DAY_ALIASES[range[1]]) {
      let d = DAY_ALIASES[range[0]];
      const end = DAY_ALIASES[range[1]];
      out.add(d);
      while (d !== end) { d = d % 7 + 1; out.add(d); }   // klarar även t.ex. "fre-mån"
      return;
    }
    if (DAY_ALIASES[tok]) { out.add(DAY_ALIASES[tok]); return; }
    throw new Error(`okänd dag "${raw}"`);
  };
  (Array.isArray(v) ? v : [v]).forEach(x => String(x).split(/[,;]/).forEach(addToken));
  if (!out.size) throw new Error('inga dagar angivna');
  return [...out].sort((a, b) => a - b);
}

function parseTime(v, required) {
  if (v == null || v === '') {
    if (required) throw new Error('tid saknas ("fran")');
    return '';
  }
  const m = String(v).trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`ogiltig tid "${v}" (skriv t.ex. "09:00")`);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function parseType(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) throw new Error('typ saknas ("hämtning" eller "leverans")');
  if (/^(h|pick)/.test(s)) return 'pickup';
  if (/^(l|del)/.test(s)) return 'delivery';
  throw new Error(`okänd typ "${v}" (använd "hämtning" eller "leverans")`);
}

function parseCoord(v, label) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n)) throw new Error(`ogiltig ${label} "${v}"`);
  return n;
}

function parseContact(c, flowId) {
  if (!c || typeof c !== 'object') throw new Error('en kontakt är inte ett objekt');
  const contact = {
    id: uid(), flowId,
    name: str(pickKey(c, 'namn', 'name')).trim(),
    role: str(pickKey(c, 'roll', 'role')).trim(),
    phone: str(pickKey(c, 'telefon', 'tel', 'phone')).trim(),
    email: str(pickKey(c, 'epost', 'e-post', 'email', 'mail')).trim()
  };
  if (!contact.name && !contact.role && !contact.phone && !contact.email) throw new Error('en kontakt saknar både namn, roll, telefon och e-post');
  return contact;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Bygger en plats av en importpost. Nya kategorier/flöden returneras separat och
// läggs bara till om hela posten gick att importera.
async function buildPlace(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('posten är inte ett objekt');
  const name = str(pickKey(item, 'namn', 'name')).trim();
  if (!name) throw new Error('"namn" saknas');
  const catName = str(pickKey(item, 'kategori', 'category')).trim();
  if (!catName) throw new Error('"kategori" saknas');

  const newCats = [];
  const newFlows = [];
  const newCarriers = [];
  const flowCarriers = []; // speditörer att sätta på befintliga flöden som saknar en
  const notes = [];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  let cat = placeData.categories.find(c => same(c.name, catName));
  if (!cat) {
    cat = { id: uid(), name: catName, color: PALETTE[placeData.categories.length % PALETTE.length], icon: guessIcon(catName) || 'fa:location-dot' };
    newCats.push(cat);
  }

  const existing = placeData.places.find(p => same(p.name, name));
  const p = existing
    ? clone(existing)
    : { id: uid(), name, address: '', lat: null, lon: null, categoryId: '', note: '', contacts: [], flows: [] };
  p.name = name;
  p.categoryId = cat.id;

  const note = pickKey(item, 'anteckning', 'note');
  if (note !== undefined) p.note = str(note);

  // Flöden med tider och flödeskontakter (ersätter platsens tidigare flöden om fältet finns)
  const flowsRaw = pickKey(item, 'floden', 'flöden', 'flows');
  if (flowsRaw !== undefined) {
    if (!Array.isArray(flowsRaw)) throw new Error('"floden" ska vara en lista [ ... ]');
    p.flows = [];
    p.contacts = p.contacts.filter(c => !c.flowId);
    flowsRaw.forEach((f, i) => {
      const fname = str(pickKey(f, 'flode', 'flöde', 'flow', 'namn', 'name')).trim();
      if (!fname) throw new Error(`flöde nr ${i + 1} saknar namn ("flode")`);
      let flow = placeData.flows.find(x => same(x.name, fname)) || newFlows.find(x => same(x.name, fname));
      if (!flow) {
        flow = { id: uid(), name: fname, color: PALETTE[(placeData.flows.length + newFlows.length + 2) % PALETTE.length], icon: guessIcon(fname) || 'fa:arrows-rotate', carrierId: null };
        newFlows.push(flow);
      }
      if (p.flows.some(x => x.flowId === flow.id)) throw new Error(`flödet ${fname} finns med två gånger`);

      const timesRaw = pickKey(f, 'tider', 'times') || [];
      if (!Array.isArray(timesRaw)) throw new Error(`${fname}: "tider" ska vara en lista [ ... ]`);
      const times = timesRaw.map((t, j) => {
        try {
          return {
            id: uid(),
            type: parseType(pickKey(t, 'typ', 'type')),
            from: parseTime(pickKey(t, 'fran', 'från', 'from', 'tid', 'time'), true),
            to: parseTime(pickKey(t, 'till', 'to'), false),
            days: parseDays(pickKey(t, 'dagar', 'days')),
            note: str(pickKey(t, 'notering', 'note', 'anteckning'))
          };
        } catch (e) { throw new Error(`${fname}, tid nr ${j + 1}: ${e.message}`); }
      });
      // Speditör för flödet (skapas om den inte finns; kontaktuppgifter läggs in under Speditörer).
      // Den sätts på flödet, så den gäller alla platser med flödet.
      const cname = str(pickKey(f, 'speditor', 'speditör', 'carrier')).trim();
      if (cname) {
        let s = placeData.carriers.find(x => same(x.name, cname)) || newCarriers.find(x => same(x.name, cname));
        const current = flow.carrierId || (flowCarriers.find(x => x.flowId === flow.id) || {}).carrierId;
        if (!s && !current) {
          // Skapas bara om den faktiskt kopplas till flödet
          s = { id: uid(), name: cname, color: PALETTE[(placeData.carriers.length + newCarriers.length) % PALETTE.length], icon: guessIcon(cname) || 'fa:truck', note: '', contacts: [] };
          newCarriers.push(s);
        }
        if (!current) {
          if (newFlows.includes(flow)) flow.carrierId = s.id;
          else flowCarriers.push({ flowId: flow.id, carrierId: s.id });
        } else if (!s || current !== s.id) {
          const other = placeData.carriers.find(x => x.id === current) || newCarriers.find(x => x.id === current) || {};
          notes.push(`${fname} körs redan av ${other.name || 'en annan speditör'}, så "${cname}" användes inte. Byt under Flöden om det ska vara ${cname}.`);
        }
      }
      p.flows.push({ flowId: flow.id, note: str(pickKey(f, 'anteckning', 'note')), times });

      const fc = pickKey(f, 'kontakter', 'contacts');
      if (fc !== undefined) {
        if (!Array.isArray(fc)) throw new Error(`${fname}: "kontakter" ska vara en lista [ ... ]`);
        fc.forEach(c => p.contacts.push(parseContact(c, flow.id)));
      }
    });
  }

  // Allmänna kontakter för platsen
  const contactsRaw = pickKey(item, 'kontakter', 'contacts');
  if (contactsRaw !== undefined) {
    if (!Array.isArray(contactsRaw)) throw new Error('"kontakter" ska vara en lista [ ... ]');
    p.contacts = [...contactsRaw.map(c => parseContact(c, null)), ...p.contacts.filter(c => c.flowId)];
  }

  // Position: koordinater om de finns, annars sök upp adressen
  const addr = str(pickKey(item, 'adress', 'address')).trim();
  const lat = parseCoord(pickKey(item, 'lat', 'latitud', 'latitude'), 'lat');
  const lon = parseCoord(pickKey(item, 'lon', 'lng', 'longitud', 'longitude'), 'lon');
  if ((lat == null) !== (lon == null)) throw new Error('både "lat" och "lon" behövs');

  if (lat != null) {
    if (!SWEDEN_BOUNDS.contains([lat, lon])) throw new Error(`koordinaterna ${lat}, ${lon} ligger inte i Sverige (kontrollera att lat och lon inte är omkastade)`);
    p.lat = lat;
    p.lon = lon;
    if (addr) p.address = addr;
    else if (!p.address) { p.address = await reverseGeocode(lat, lon); await sleep(150); }
  } else if (addr) {
    if (!existing || addr !== existing.address) {
      const hits = await searchAddress(addr, 1);
      await sleep(150);
      if (!hits.length) throw new Error(`hittade inte adressen "${addr}" – kontrollera stavningen eller ange "lat" och "lon"`);
      p.lat = hits[0].lat;
      p.lon = hits[0].lon;
      p.address = addr;
    }
  } else if (!existing) {
    throw new Error('"adress" eller "lat" + "lon" saknas');
  }

  return { place: normPlace(p), existing, newCats, newFlows, newCarriers, flowCarriers, notes };
}

// ---------- Import ----------
async function runImport() {
  const log = el('importLog');
  const btn = el('importRun');
  log.innerHTML = '';

  let raw;
  try {
    raw = JSON.parse(el('importText').value);
  } catch (e) {
    log.append(h('div', { class: 'err' }, 'Ogiltig JSON: ' + e.message));
    return;
  }

  // En hel datafil från appen (med id:n) slås ihop direkt
  if (raw && !Array.isArray(raw) && Array.isArray(raw.categories) && Array.isArray(raw.places)) {
    await importFullDataFile(raw, log);
    return;
  }

  const list = Array.isArray(raw) ? raw : pickKey(raw, 'platser', 'places');
  if (!Array.isArray(list)) {
    log.append(h('div', { class: 'err' }, 'Hittade ingen lista med platser. Använd { "platser": [ ... ] } eller en lista [ ... ] som i exemplet.'));
    return;
  }

  btn.disabled = true;
  const progress = h('div', { class: 'muted' });
  log.append(progress);
  const res = { added: [], updated: [], failed: [], cats: [], flows: [], carriers: [], linked: [], notes: [] };

  for (let i = 0; i < list.length; i++) {
    const label = str(pickKey(list[i], 'namn', 'name')) || `post nr ${i + 1}`;
    progress.textContent = `Importerar ${i + 1} av ${list.length}: ${label}…`;
    try {
      const r = await buildPlace(list[i]);
      r.newCats.forEach(c => { placeData.categories.push(c); res.cats.push(c.name); });
      r.newFlows.forEach(f => { placeData.flows.push(f); res.flows.push(f.name); });
      r.newCarriers.forEach(s => { placeData.carriers.push(s); res.carriers.push(s.name); });
      r.flowCarriers.forEach(({ flowId, carrierId }) => {
        const f = flowById(flowId);
        if (f && !f.carrierId) { f.carrierId = carrierId; res.linked.push(`${f.name} → ${carrierById(carrierId).name}`); }
      });
      r.newFlows.forEach(f => { if (f.carrierId) res.linked.push(`${f.name} → ${carrierById(f.carrierId).name}`); });
      res.notes.push(...r.notes.map(n => `${label}: ${n}`));
      if (r.existing) {
        const idx = placeData.places.findIndex(x => x.id === r.existing.id);
        placeData.places[idx] = r.place;
        res.updated.push(label);
      } else {
        placeData.places.push(r.place);
        res.added.push(label);
      }
      setCatVisible(r.place.categoryId, true);
    } catch (e) {
      res.failed.push(`${label}: ${e.message}`);
    }
  }

  refreshPlaces();
  btn.disabled = false;
  progress.remove();

  const section = (cls, title, items) => items.length
    ? h('div', { class: cls }, h('strong', {}, `${title} (${items.length})`), h('ul', {}, items.map(t => h('li', {}, t))))
    : null;
  log.append(...[
    h('div', { class: res.failed.length ? 'err' : 'ok' },
      `Klart: ${res.added.length} nya, ${res.updated.length} uppdaterade, ${res.failed.length} misslyckades.`),
    section('ok', 'Nya platser', res.added),
    section('ok', 'Uppdaterade platser', res.updated),
    section('ok', 'Nya kategorier', res.cats),
    section('ok', 'Nya flöden', res.flows),
    section('ok', 'Nya speditörer (lägg in kontaktuppgifter under Speditörer)', res.carriers),
    section('ok', 'Speditör kopplad till flöde', res.linked),
    section('err', 'Obs', res.notes),
    section('err', 'Misslyckades', res.failed),
    res.added.length || res.updated.length
      ? h('p', { class: 'hint' }, 'Importen syns nu som osparade ändringar uppe till höger. Där kan du granska, ångra enskilda platser och spara.')
      : null].filter(Boolean));
}

async function importFullDataFile(raw, log) {
  const d = normalizeData(raw);
  if (!await uiConfirm(`Det här ser ut som en hel datafil från appen (${countText(d)}).\n\nSlå ihop den med nuvarande data? Poster med samma id ersätts.\n\nVill du i stället ersätta allt med filen, använd "Öppna datafil" (klicka på statusrutan uppe till höger).`, 'Slå ihop')) return;
  const upsert = (list, items) => items.forEach(it => {
    const i = list.findIndex(x => x.id === it.id);
    if (i >= 0) list[i] = it; else list.push(it);
  });
  upsert(placeData.categories, d.categories);
  upsert(placeData.flows, d.flows);
  upsert(placeData.carriers, d.carriers);
  upsert(placeData.places, d.places);
  refreshPlaces();
  log.append(h('div', { class: 'ok' }, `Sammanslaget: ${countText(d)}.`));
}

// ---------- Modal ----------
function openImportDialog() {
  const exampleText = JSON.stringify(IMPORT_EXAMPLE, null, 2);
  const textarea = h('textarea', { id: 'importText', spellcheck: false, placeholder: 'Klistra in JSON här, eller välj en fil…' });
  const fileInput = h('input', {
    type: 'file', accept: '.json,application/json,text/plain', hidden: true,
    onchange: async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) textarea.value = await f.text();
    }
  });

  const copyBtn = h('button', { type: 'button', class: 'small secondary' }, 'Kopiera exempel');
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(exampleText); copyBtn.textContent = 'Kopierat ✓'; }
    catch { textarea.value = exampleText; copyBtn.textContent = 'Inklistrat i rutan'; }
    setTimeout(() => { copyBtn.textContent = 'Kopiera exempel'; }, 2000);
  };

  const view = el('importView');
  view.innerHTML = '';
  view.append(
    dlgHead([fa('file-import'), ' Importera platser från JSON'], () => importDlg.close()),
    h('div', { class: 'dlg-body' },
      h('div', { class: 'import-grid' },
        h('div', {},
          h('h3', { style: 'margin-top:0' }, 'Din JSON'),
          textarea,
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('label', { class: 'btn secondary' }, 'Välj fil…', fileInput),
            h('button', { type: 'button', class: 'secondary', onclick: () => { textarea.value = exampleText; } }, 'Använd exemplet'),
            h('span', { class: 'spacer' }),
            h('button', { type: 'button', id: 'importRun', onclick: runImport }, 'Importera')),
          h('div', { id: 'importLog', class: 'import-log' })),
        h('div', {},
          h('div', { class: 'row', style: 'margin-bottom:8px' },
            h('h3', { style: 'margin:0', class: 'spacer' }, 'Exempel på struktur'),
            copyBtn,
            h('button', { type: 'button', class: 'small secondary', onclick: () => downloadFile('transportlathund-importmall.json', exampleText) }, 'Ladda ner mall')),
          h('pre', { class: 'example' }, exampleText),
          h('h3', {}, 'Regler'),
          h('ul', { class: 'rules' },
            h('li', {}, h('b', {}, 'Krävs: '), '"namn", "kategori" och antingen "adress" eller "lat" + "lon".'),
            h('li', {}, 'Har platsen bara adress söks koordinaterna upp automatiskt (i Sverige). Har den bara koordinater söks adressen upp.'),
            h('li', {}, 'Kategorier, flöden och speditörer som inte finns skapas automatiskt (med ikon om namnet känns igen).'),
            h('li', {}, '"speditor" i ett flöde anger vem som kör flödet, t.ex. "PostNord". Den kopplas till flödet (gäller alla platser) om flödet inte redan har en speditör. Kontaktuppgifter läggs in under Speditörer.'),
            h('li', {}, 'Finns redan en plats med samma namn uppdateras den: fälten i filen ersätter de gamla, övriga behålls.'),
            h('li', {}, '"typ": "hämtning" eller "leverans". Tider skrivs "09:00"; "till" är valfri sluttid.'),
            h('li', {}, '"dagar": t.ex. "mån-fre", "vardagar", "helg", "alla", "mån,ons,fre" eller ["mån","ons"]. Utelämnat = mån–fre.'),
            h('li', {}, 'Alla fält utom namn och kategori är valfria. Engelska fältnamn (name, address, flows, times …) fungerar också.'),
            h('li', {}, 'Du kan också klistra in en lista [ {...}, {...} ] direkt, utan "platser".'))))));
  importDlg.showModal();
}
