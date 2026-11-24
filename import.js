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
const sameName = (a, b) => str(a).trim().toLowerCase() === str(b).trim().toLowerCase();
// Adresser jämförs utan skillnad på stora/små bokstäver, mellanslag och kommatecken
const normAddr = a => str(a).toLowerCase().replace(/[\s,.]+/g, '');

// Behåll id:n på kontakter/tider som är oförändrade, så att ändringslistan bara visar det som verkligen ändrats
function reuseIds(list, old, sig) {
  const pool = [...old];
  return list.map(x => {
    const i = pool.findIndex(o => sig(o) === sig(x));
    if (i < 0) return x;
    const id = pool[i].id;
    pool.splice(i, 1);
    return { ...x, id };
  });
}
const contactSig = c => [c.name, c.role, c.phone, c.email, c.flowId || ''].join('|');
const timeSig = t => [t.type, t.from, t.to, t.days.join(','), t.note].join('|');

// Ny importomgång. Kategorier/flöden/speditörer som behöver skapas samlas här och
// läggs bara till om någon plats som använder dem faktiskt importeras.
const newImportCtx = () => ({ categories: [], flows: [], carriers: [], flowCarriers: [] });
const findNamed = (ctx, kind, name) => placeData[kind].find(x => sameName(x.name, name)) || ctx[kind].find(x => sameName(x.name, name));
const findById = (ctx, kind, id) => placeData[kind].find(x => x.id === id) || ctx[kind].find(x => x.id === id);

// Finns platsen redan? Samma namn i första hand, annars samma adress.
function findExisting(name, addr) {
  const byName = placeData.places.find(p => sameName(p.name, name));
  if (byName) return { existing: byName, matchedBy: 'name' };
  const byAddr = addr && placeData.places.find(p => p.address && normAddr(p.address) === normAddr(addr));
  if (byAddr) return { existing: byAddr, matchedBy: 'address' };
  return { existing: null, matchedBy: null };
}

// Bygger en plats av en importpost utan att ändra något i datan.
async function buildPlace(item, ctx) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('posten är inte ett objekt');
  const name = str(pickKey(item, 'namn', 'name')).trim();
  if (!name) throw new Error('"namn" saknas');
  const catName = str(pickKey(item, 'kategori', 'category')).trim();
  if (!catName) throw new Error('"kategori" saknas');
  const addr = str(pickKey(item, 'adress', 'address')).trim();
  const notes = [];

  let cat = findNamed(ctx, 'categories', catName);
  if (!cat) {
    cat = { id: uid(), name: catName, color: PALETTE[(placeData.categories.length + ctx.categories.length) % PALETTE.length], icon: guessIcon(catName) || 'fa:location-dot' };
    ctx.categories.push(cat);
  }

  const { existing, matchedBy } = findExisting(name, addr);
  const p = existing
    ? clone(existing)
    : { id: uid(), name, address: '', lat: null, lon: null, categoryId: '', note: '', contacts: [], flows: [], approx: '' };
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
      let flow = findNamed(ctx, 'flows', fname);
      if (!flow) {
        flow = { id: uid(), name: fname, color: PALETTE[(placeData.flows.length + ctx.flows.length + 2) % PALETTE.length], icon: guessIcon(fname) || 'fa:arrows-rotate', carrierId: null };
        ctx.flows.push(flow);
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
        let s = findNamed(ctx, 'carriers', cname);
        const current = flow.carrierId || (ctx.flowCarriers.find(x => x.flowId === flow.id) || {}).carrierId;
        if (!s && !current) {
          s = { id: uid(), name: cname, color: PALETTE[(placeData.carriers.length + ctx.carriers.length) % PALETTE.length], icon: guessIcon(cname) || 'fa:truck', note: '', contacts: [] };
          ctx.carriers.push(s);
        }
        if (!current) {
          if (ctx.flows.includes(flow)) flow.carrierId = s.id;
          else ctx.flowCarriers.push({ flowId: flow.id, carrierId: s.id });
        } else if (!s || current !== s.id) {
          const other = findById(ctx, 'carriers', current) || {};
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
  const lat = parseCoord(pickKey(item, 'lat', 'latitud', 'latitude'), 'lat');
  const lon = parseCoord(pickKey(item, 'lon', 'lng', 'longitud', 'longitude'), 'lon');
  if ((lat == null) !== (lon == null)) throw new Error('både "lat" och "lon" behövs');

  if (lat != null) {
    if (!SWEDEN_BOUNDS.contains([lat, lon])) throw new Error(`koordinaterna ${lat}, ${lon} ligger inte i Sverige (kontrollera att lat och lon inte är omkastade)`);
    p.lat = lat;
    p.lon = lon;
    p.approx = '';
    if (addr) p.address = addr;
    else if (!p.address) { p.address = await reverseGeocode(lat, lon); await sleep(150); }
  } else if (addr) {
    // Samma adress som den befintliga platsen: behåll dess position (den kan vara justerad för hand)
    if (!existing || normAddr(addr) !== normAddr(existing.address)) {
      let pos;
      try { pos = await geocodeWithFallback(addr); } catch { throw new Error('adressökningen svarade inte – försök igen om en stund'); }
      if (!pos) throw new Error(`hittade varken adressen "${addr}" eller orten – kontrollera stavningen eller ange "lat" och "lon"`);
      p.lat = pos.lat;
      p.lon = pos.lon;
      p.approx = pos.approx;
    }
    p.address = addr;
  } else if (!existing) {
    throw new Error('"adress" eller "lat" + "lon" saknas');
  }

  if (existing) {
    p.contacts = reuseIds(p.contacts, existing.contacts, contactSig);
    p.flows.forEach(pf => {
      const old = existing.flows.find(x => x.flowId === pf.flowId);
      if (old) pf.times = reuseIds(pf.times, old.times, timeSig);
    });
  }
  return { place: normPlace(p), existing, matchedBy, notes };
}

// ---------- Jämförelse av dubbletter ----------
// Platsens innehåll som läsbar text per fält (id:n spelar ingen roll)
function placeFacts(p, ctx) {
  const flowN = id => (findById(ctx, 'flows', id) || {}).name || '?';
  const contact = c => [c.name, c.role, c.phone, c.email].filter(Boolean).join(', ') + (c.flowId ? ` (${flowN(c.flowId)})` : '');
  return {
    Namn: p.name,
    Kategori: (findById(ctx, 'categories', p.categoryId) || {}).name || '?',
    Adress: p.address,
    Position: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${p.approx ? ' (uppskattad)' : ''}`,
    Anteckning: p.note,
    Kontakter: p.contacts.map(contact).sort().join('\n'),
    'Flöden och tider': p.flows.map(pf => flowN(pf.flowId) + (pf.note ? ` – ${pf.note}` : '') +
      sortTimes(pf.times).map(t => '\n   ' + timeText(t)).join('')).join('\n')
  };
}

// Fält som skiljer sig. Positioner närmare än 25 m räknas som samma.
function placeDiff(before, after, ctx) {
  const a = placeFacts(before, ctx);
  const b = placeFacts(after, ctx);
  const dist = map.distance([before.lat, before.lon], [after.lat, after.lon]);
  return Object.keys(a).map(field => {
    let differs = a[field] !== b[field];
    let extra = '';
    if (field === 'Position') {
      differs = dist > 25 || before.approx !== after.approx;
      if (dist > 25) extra = `\n(${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'} ifrån)`;
    }
    return { field, before: a[field], after: b[field] + extra, differs };
  });
}

// ---------- Import ----------
let importText = '';   // det som står i rutan, så att det finns kvar om man går tillbaka

async function runImport() {
  const log = el('importLog');
  const btn = el('importRun');
  log.innerHTML = '';
  importText = el('importText').value;

  let raw;
  try {
    raw = JSON.parse(importText);
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

  // Steg 1: läs alla poster och sök upp adresser. Inget ändras ännu.
  btn.disabled = true;
  const progress = h('div', { class: 'muted' });
  log.append(progress);
  const ctx = newImportCtx();
  const entries = [];
  const failed = [];
  const seen = new Map();   // namn → postnummer, för dubbletter inom filen

  for (let i = 0; i < list.length; i++) {
    const label = str(pickKey(list[i], 'namn', 'name')) || `post nr ${i + 1}`;
    progress.textContent = `Läser in ${i + 1} av ${list.length}: ${label}…`;
    const key = label.trim().toLowerCase();
    if (seen.has(key)) {
      failed.push(`${label}: samma namn som post nr ${seen.get(key)} i filen – hoppades över. Ge platserna olika namn om båda ska finnas.`);
      continue;
    }
    seen.set(key, i + 1);
    try {
      const r = await buildPlace(list[i], ctx);
      entries.push({ label, ...r, action: r.existing ? null : 'new' });
    } catch (e) {
      failed.push(`${label}: ${e.message}`);
    }
  }
  btn.disabled = false;
  progress.remove();

  // Dubbletter: identiska hoppas över direkt, resten får man ta ställning till
  entries.filter(e => e.existing).forEach(e => {
    e.diff = placeDiff(e.existing, e.place, ctx);
    if (!e.diff.some(d => d.differs)) { e.action = 'skip'; e.identical = true; }
  });

  const state = { ctx, entries, failed };
  if (entries.some(e => !e.action)) renderDuplicateReview(state);
  else commitImport(state);
}

// Steg 2 (vid behov): granska dubbletter
const DUP_ACTIONS = [
  { value: 'update', label: 'Skriv över', title: 'Ersätt den befintliga platsen med uppgifterna från filen' },
  { value: 'skip', label: 'Behåll befintlig', title: 'Ignorera platsen i filen' },
  { value: 'copy', label: 'Lägg till som ny', title: 'Behåll den befintliga och lägg till filens plats som en egen plats' }
];

function renderDuplicateReview(state) {
  const dups = state.entries.filter(e => e.existing && !e.identical);
  const identical = state.entries.filter(e => e.identical).length;
  const newCount = state.entries.filter(e => !e.existing).length;
  const view = el('importView');
  const status = h('span', { class: 'spacer muted small' });
  const goBtn = h('button', { type: 'button', onclick: () => commitImport(state) }, 'Importera');

  const updateFoot = () => {
    const left = dups.filter(e => !e.action).length;
    const count = a => state.entries.filter(e => e.action === a).length;
    goBtn.disabled = left > 0;
    status.textContent = left
      ? `${left} dubbletter kvar att välja för`
      : `${count('new')} nya, ${count('update')} skrivs över, ${count('copy')} läggs till som nya, ${count('skip')} hoppas över`;
  };

  const cards = dups.map(e => {
    const card = h('div', { class: 'dup-card' });
    const seg = h('div', { class: 'seg' });
    const paint = () => {
      card.classList.toggle('undecided', !e.action);
      [...seg.children].forEach(b => b.classList.toggle('on', b.dataset.v === e.action));
    };
    DUP_ACTIONS.forEach(a => seg.append(h('button', {
      type: 'button', title: a.title, 'data-v': a.value,
      onclick: () => { e.action = a.value; paint(); updateFoot(); }
    }, a.label)));
    card._paint = paint;

    const changed = e.diff.filter(d => d.differs);
    const same = e.diff.filter(d => !d.differs).map(d => d.field);
    const reason = e.matchedBy === 'name' ? 'Samma namn' : `Samma adress som "${e.existing.name}"`;
    card.append(
      h('div', { class: 'dup-head' },
        badge(findById(state.ctx, 'categories', e.place.categoryId), 26),
        h('div', { class: 'spacer' }, h('strong', {}, e.label), h('div', { class: 'muted small' }, reason)),
        seg),
      h('table', { class: 'dup-diff' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Befintlig'), h('th', {}, 'Från filen'))),
        h('tbody', {}, changed.map(d => h('tr', {},
          h('th', {}, d.field),
          h('td', {}, d.before || '–'),
          h('td', { class: 'new' }, d.after || '–'))))),
      ...[same.length ? h('div', { class: 'muted small' }, 'Lika: ' + same.join(', ')) : null,
        e.notes.length ? h('div', { class: 'muted small' }, e.notes.join(' ')) : null].filter(Boolean));
    paint();
    return card;
  });

  const setAll = action => { dups.forEach(e => { e.action = action; }); cards.forEach(c => c._paint()); updateFoot(); };

  view.innerHTML = '';
  view.append(
    dlgHead([fa('clone'), ` Dubbletter (${dups.length})`], () => importDlg.close()),
    h('div', { class: 'dlg-body' },
      h('p', { class: 'hint', style: 'margin-top:0' },
        `${dups.length} av platserna i filen finns redan (samma namn eller samma adress). Välj vad som ska hända med var och en. ` +
        (newCount ? `${newCount} nya platser importeras också. ` : '') +
        (identical ? `${identical} platser är identiska med de befintliga och hoppas över. ` : '') +
        'Inget sparas förrän du klickar Importera.'),
      h('div', { class: 'row dup-bulk' },
        h('span', { class: 'muted small' }, 'Alla dubbletter:'),
        h('button', { type: 'button', class: 'small secondary', onclick: () => setAll('update') }, 'Skriv över alla'),
        h('button', { type: 'button', class: 'small secondary', onclick: () => setAll('skip') }, 'Ignorera alla'),
        h('button', { type: 'button', class: 'small secondary', onclick: () => setAll('copy') }, 'Lägg till alla som nya')),
      cards),
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', class: 'secondary', onclick: () => openImportDialog() }, 'Avbryt import'),
      status,
      goBtn));
  updateFoot();
}

// Steg 3: lägg in det som valts
function commitImport(state) {
  const { ctx, entries, failed } = state;
  const res = { added: [], updated: [], copied: [], skipped: [], identical: [], approx: [], cats: [], flows: [], carriers: [], linked: [], notes: [] };
  const done = [];

  entries.forEach(e => {
    if (e.action === 'skip') { (e.identical ? res.identical : res.skipped).push(e.label); return; }
    let p = e.place;
    if (e.action === 'copy') {
      // Egen plats: nya id:n överallt
      p = normPlace({
        ...clone(p), id: uid(),
        contacts: p.contacts.map(c => ({ ...c, id: uid() })),
        flows: p.flows.map(pf => ({ ...pf, times: pf.times.map(t => ({ ...t, id: uid() })) }))
      });
    }
    done.push(p);
    res.notes.push(...e.notes.map(n => `${e.label}: ${n}`));
    if (e.action === 'update') {
      const idx = placeData.places.findIndex(x => x.id === e.existing.id);
      placeData.places[idx] = p;
      res.updated.push(e.label);
    } else {
      placeData.places.push(p);
      (e.action === 'copy' ? res.copied : res.added).push(e.label);
    }
    if (p.approx) res.approx.push(p);
  });

  // Nya kategorier/flöden/speditörer – bara de som används av något som importerades
  const usedCats = new Set(done.map(p => p.categoryId));
  const usedFlows = new Set(done.flatMap(p => p.flows.map(pf => pf.flowId)));
  ctx.categories.filter(c => usedCats.has(c.id)).forEach(c => { placeData.categories.push(c); res.cats.push(c.name); });
  const addedFlows = ctx.flows.filter(f => usedFlows.has(f.id));
  const usedCarriers = new Set(addedFlows.map(f => f.carrierId).filter(Boolean));
  ctx.flowCarriers.filter(fc => usedFlows.has(fc.flowId)).forEach(({ flowId, carrierId }) => {
    const f = flowById(flowId);
    if (f && !f.carrierId) { f.carrierId = carrierId; usedCarriers.add(carrierId); }
  });
  ctx.carriers.filter(s => usedCarriers.has(s.id)).forEach(s => { placeData.carriers.push(s); res.carriers.push(s.name); });
  addedFlows.forEach(f => { placeData.flows.push(f); res.flows.push(f.name); });
  placeData.flows.filter(f => usedFlows.has(f.id) && f.carrierId && usedCarriers.has(f.carrierId))
    .forEach(f => res.linked.push(`${f.name} → ${(carrierById(f.carrierId) || {}).name}`));
  usedCats.forEach(id => setCatVisible(id, true));

  refreshPlaces();
  openImportDialog();
  showImportResult(res, failed);
}

function showImportResult(res, failed) {
  const log = el('importLog');
  log.innerHTML = '';
  const section = (cls, title, items) => items.length
    ? h('div', { class: cls }, h('strong', {}, `${title} (${items.length})`), h('ul', {}, items.map(t => h('li', {}, t))))
    : null;
  const approxSection = res.approx.length
    ? h('div', { class: 'warn' },
      h('strong', {}, `Uppskattad position (${res.approx.length})`),
      h('div', { class: 'small' }, 'Exakt adress hittades inte i kartdatan. Nålen står på vägen eller i orten. Justera dem i kartan.'),
      h('ul', {}, res.approx.map(p => h('li', {}, `${p.name} – ${p.address} `,
        h('button', { type: 'button', class: 'small link', onclick: () => showOnMap(p) }, 'Visa')))),
      h('button', {
        type: 'button', class: 'small',
        onclick: () => { listFilter.pos = 'approx'; importDlg.close(); openPlacesDialog(); }
      }, 'Visa alla uppskattade i platslistan'))
    : null;
  const total = res.added.length + res.updated.length + res.copied.length;
  log.append(...[
    h('div', { class: failed.length ? 'err' : 'ok' },
      `Klart: ${res.added.length} nya, ${res.updated.length} uppdaterade` +
      (res.copied.length ? `, ${res.copied.length} tillagda som nya` : '') +
      (res.skipped.length + res.identical.length ? `, ${res.skipped.length + res.identical.length} hoppades över` : '') +
      `, ${failed.length} misslyckades.`),
    approxSection,
    section('ok', 'Nya platser', res.added),
    section('ok', 'Uppdaterade platser', res.updated),
    section('ok', 'Dubbletter tillagda som nya platser', res.copied),
    section('muted', 'Dubbletter som ignorerades', res.skipped),
    section('muted', 'Identiska med befintliga (hoppades över)', res.identical),
    section('ok', 'Nya kategorier', res.cats),
    section('ok', 'Nya flöden', res.flows),
    section('ok', 'Nya speditörer (lägg in kontaktuppgifter under Speditörer)', res.carriers),
    section('ok', 'Speditör kopplad till flöde', res.linked),
    section('err', 'Obs', res.notes),
    section('err', 'Misslyckades', failed),
    total
      ? h('p', { class: 'hint' }, 'Importen syns nu som ändringar uppe till höger. Där kan du granska, ångra enskilda platser och spara till fil.')
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
  const textarea = h('textarea', { id: 'importText', spellcheck: false, placeholder: 'Klistra in JSON här, eller välj en fil…', value: importText });
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
            h('li', {}, 'Har platsen bara adress söks koordinaterna upp automatiskt (i Sverige). Hittas inte husnumret används vägen, och annars orten. Sådana platser får en uppskattad position som visas med streckad kant och ? på kartan, så att du kan justera dem. Har platsen bara koordinater söks adressen upp.'),
            h('li', {}, 'Kategorier, flöden och speditörer som inte finns skapas automatiskt (med ikon om namnet känns igen).'),
            h('li', {}, '"speditor" i ett flöde anger vem som kör flödet, t.ex. "PostNord". Den kopplas till flödet (gäller alla platser) om flödet inte redan har en speditör. Kontaktuppgifter läggs in under Speditörer.'),
            h('li', {}, 'Finns redan en plats med samma namn eller samma adress får du se skillnaderna och välja per plats: skriv över, behåll befintlig eller lägg till som ny. Skriv över ersätter fälten som finns i filen, övriga behålls.'),
            h('li', {}, '"typ": "hämtning" eller "leverans". Tider skrivs "09:00"; "till" är valfri sluttid.'),
            h('li', {}, '"dagar": t.ex. "mån-fre", "vardagar", "helg", "alla", "mån,ons,fre" eller ["mån","ons"]. Utelämnat = mån–fre.'),
            h('li', {}, 'Alla fält utom namn och kategori är valfria. Engelska fältnamn (name, address, flows, times …) fungerar också.'),
            h('li', {}, 'Du kan också klistra in en lista [ {...}, {...} ] direkt, utan "platser".'))))));
  if (!importDlg.open) importDlg.showModal();
}
