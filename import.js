// TransportLathund – importera från JSON (kompletterar det som finns, tar aldrig bort något)
// Excel är huvudsättet att läsa in och ersätta all data (excel.js). JSON-importen är till för
// att lägga till eller uppdatera enstaka saker: platser, kategorier, flöden och/eller speditörer,
// var för sig eller i samma fil.
// Formatet är gjort för att vara lätt att skriva för hand: namn på kategorier och flöden i stället
// för interna id:n, svenska fältnamn (engelska fungerar också), och adress räcker – koordinaterna
// söks upp automatiskt.

const importDlg = el('importDialog');

// ---------- Formatet: typer, fält och exempel ----------
// Används både för att tolka filen och för att visa hjälpen i importrutan.
const JSON_KINDS = [
  { key: 'places', label: 'Platser', json: 'platser', aliases: ['platser', 'places'], icon: 'location-dot' },
  { key: 'categories', label: 'Kategorier', json: 'kategorier', aliases: ['kategorier', 'categories'], icon: 'tags' },
  { key: 'flows', label: 'Flöden', json: 'floden', aliases: ['floden', 'flöden', 'flows'], icon: 'arrows-rotate' },
  { key: 'carriers', label: 'Speditörer', json: 'speditorer', aliases: ['speditorer', 'speditörer', 'carriers'], icon: 'truck' }
];
const KIND_SINGULAR = { places: 'Plats', categories: 'Kategori', flows: 'Flöde', carriers: 'Speditör' };
const DEFAULT_ICON = { categories: 'fa:location-dot', flows: 'fa:arrows-rotate', carriers: 'fa:truck' };

// Fält per typ. req: krävs alltid. full: visas bara i exemplet för "Komplett".
const JSON_FIELDS = {
  places: [
    { f: 'namn', req: true, d: 'Platsens namn. Finns redan en plats med samma namn (eller samma adress) räknas den som dubblett.' },
    { f: 'kategori', req: true, d: 'Namnet på kategorin. Finns den inte skapas den.' },
    { f: 'adress', d: 'Gatuadress med ort. Koordinaterna söks upp automatiskt. Krävs om lat/lon saknas.' },
    { f: 'lat, lon', d: 'Koordinater i stället för (eller utöver) adress, t.ex. 59.809 och 17.623.' },
    { f: 'anteckning', full: true, d: 'Fri text om platsen.' },
    { f: 'kontakter', full: true, d: 'Lista med kontakter för platsen: namn, roll, telefon, epost (minst ett av dem).' },
    { f: 'floden', full: true, d: 'Lista med flöden på platsen. Varje flöde: flode (namn, krävs), speditor, anteckning, tider, kontakter.' },
    { f: '  tider', full: true, d: 'Lista med tider: typ ("hämtning"/"leverans"), fran ("09:00"), till (valfri), dagar, notering.' },
    { f: '  dagar', full: true, d: '"mån-fre", "vardagar", "helg", "alla", "mån,ons,fre" eller ["mån","ons"]. Utelämnat = mån–fre.' }
  ],
  categories: [
    { f: 'namn', req: true, d: 'Kategorins namn, t.ex. "Sjukhus".' },
    { f: 'farg', full: true, d: 'Färgkod, t.ex. "#f28b82". Utelämnad = en färg väljs automatiskt.' },
    { f: 'ikon', full: true, d: 'Namn på en gratis "solid"-ikon från fontawesome.com, t.ex. "circle-h". Utelämnad = gissas från namnet.' }
  ],
  flows: [
    { f: 'namn', req: true, d: 'Flödets namn, t.ex. "Post".' },
    { f: 'farg', full: true, d: 'Färgkod, t.ex. "#8ea8f5".' },
    { f: 'ikon', full: true, d: 'Ikon från fontawesome.com, t.ex. "envelope".' },
    { f: 'speditor', full: true, d: 'Speditören som kör flödet. Finns den inte skapas den.' }
  ],
  carriers: [
    { f: 'namn', req: true, d: 'Speditörens namn, t.ex. "PostNord".' },
    { f: 'farg', full: true, d: 'Färgkod.' },
    { f: 'ikon', full: true, d: 'Ikon från fontawesome.com, t.ex. "truck".' },
    { f: 'anteckning', full: true, d: 'Fri text, t.ex. kundnummer.' },
    { f: 'kontakter', full: true, d: 'Lista med kontakter: namn, roll, telefon, epost.' }
  ]
};

// Exempel per typ och nivå. pos = 'adress' eller 'koordinater' (bara platser)
function jsonExample(kind, level, pos) {
  const full = level === 'full';
  if (kind === 'places') {
    const where = (addr, lat, lon) => (pos === 'koordinater' ? { lat, lon } : { adress: addr });
    if (!full) {
      return [
        { namn: 'Akademiska sjukhuset', kategori: 'Sjukhus', ...where('Sjukhusvägen 1, 751 85 Uppsala', 59.8498, 17.6386) },
        { namn: 'Gottsunda vårdcentral', kategori: 'Hälsocentral', ...where('Gottsunda centrum, Uppsala', 59.809, 17.623) }
      ];
    }
    return [{
      namn: 'Akademiska sjukhuset',
      kategori: 'Sjukhus',
      ...where('Sjukhusvägen 1, 751 85 Uppsala', 59.8498, 17.6386),
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
        { flode: 'Paket', tider: [{ typ: 'hämtning', fran: '15:00', dagar: 'alla' }] }
      ]
    }];
  }
  if (kind === 'categories') {
    return full
      ? [{ namn: 'Sjukhus', farg: '#f28b82', ikon: 'circle-h' }, { namn: 'Lager', farg: '#f6ae6b', ikon: 'warehouse' }]
      : [{ namn: 'Sjukhus' }, { namn: 'Lager' }];
  }
  if (kind === 'flows') {
    return full
      ? [{ namn: 'Post', farg: '#8ea8f5', ikon: 'envelope', speditor: 'PostNord' }, { namn: 'Blod och prover', farg: '#f28b82', ikon: 'droplet', speditor: 'Bud Express' }]
      : [{ namn: 'Post' }, { namn: 'Blod och prover' }];
  }
  return full
    ? [{ namn: 'PostNord', farg: '#7cc4f0', ikon: 'truck', anteckning: 'Kundnummer 123456', kontakter: [{ namn: 'Kundtjänst', telefon: '0771-33 33 10', epost: 'kundtjanst@example.se' }] }]
    : [{ namn: 'PostNord' }, { namn: 'Bud Express' }];
}

// Hela exempelfilen för de valda typerna. Bara platser kan också skrivas som en lista [ ... ] direkt.
function buildJsonExample(kinds, level, pos) {
  const order = ['carriers', 'flows', 'categories', 'places'];   // läsordning: det som andra hänvisar till först
  const out = {};
  order.filter(k => kinds.includes(k)).forEach(k => { out[JSON_KINDS.find(x => x.key === k).json] = jsonExample(k, level, pos); });
  return out;
}

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
// Antal adresser som söks upp samtidigt vid import. Lagom för den fria söktjänsten Photon.
const GEOCODE_WORKERS = 4;
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

// ---------- Kategorier, flöden och speditörer ----------
// Bygger en kategori/ett flöde/en speditör av en importpost utan att ändra något i datan.
// Finns den redan (samma namn) utgår den från den befintliga och bara fälten i filen ändras.
function buildRegistry(kind, item, ctx) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('posten är inte ett objekt');
  const name = str(pickKey(item, 'namn', 'name')).trim();
  if (!name) throw new Error('"namn" saknas');
  const existing = placeData[kind].find(x => sameName(x.name, name)) || null;
  const x = existing ? clone(existing) : {
    id: uid(), name,
    color: PALETTE[(placeData[kind].length + ctx[kind].length + (kind === 'flows' ? 2 : 0)) % PALETTE.length],
    icon: guessIcon(name) || DEFAULT_ICON[kind],
    ...(kind === 'flows' ? { carrierId: null } : {}),
    ...(kind === 'carriers' ? { note: '', contacts: [] } : {})
  };
  x.name = name;

  const color = pickKey(item, 'farg', 'färg', 'color', 'colour');
  if (color !== undefined) {
    const c = parseColorInput(color);
    if (!c) throw new Error(`ogiltig färg "${color}" (skriv t.ex. "#f28b82")`);
    x.color = c;
  }
  const icon = pickKey(item, 'ikon', 'icon');
  if (icon !== undefined) {
    const ic = parseIconInput(icon);
    if (!ic) throw new Error(`hittar ingen ikon "${icon}" – använd namnet från fontawesome.com, t.ex. "truck"`);
    x.icon = ic;
  }

  if (kind === 'flows') {
    const cname = str(pickKey(item, 'speditor', 'speditör', 'carrier')).trim();
    if (cname) {
      let s = findNamed(ctx, 'carriers', cname);
      if (!s) {
        s = { id: uid(), name: cname, color: PALETTE[(placeData.carriers.length + ctx.carriers.length) % PALETTE.length], icon: guessIcon(cname) || 'fa:truck', note: '', contacts: [] };
        ctx.carriers.push(s);
      }
      x.carrierId = s.id;
    }
  }
  if (kind === 'carriers') {
    const note = pickKey(item, 'anteckning', 'note');
    if (note !== undefined) x.note = str(note);
    const cs = pickKey(item, 'kontakter', 'contacts');
    if (cs !== undefined) {
      if (!Array.isArray(cs)) throw new Error('"kontakter" ska vara en lista [ ... ]');
      const list = cs.map(c => { const { flowId, ...rest } = parseContact(c, null); return rest; });
      x.contacts = existing ? reuseIds(list, existing.contacts, contactSig) : list;
    }
  }
  const norm = { categories: normCategory, flows: normFlow, carriers: normCarrier }[kind];
  return { item: norm(x), existing };
}

// Innehållet som läsbar text per fält, för jämförelse av dubbletter
function registryFacts(kind, x, ctx) {
  const facts = { Namn: x.name, Färg: x.color, Ikon: iconLabel(x.icon) };
  if (kind === 'flows') facts.Speditör = x.carrierId ? (findById(ctx, 'carriers', x.carrierId) || {}).name || '?' : '';
  if (kind === 'carriers') {
    facts.Anteckning = x.note;
    facts.Kontakter = x.contacts.map(c => [c.name, c.role, c.phone, c.email].filter(Boolean).join(', ')).sort().join('\n');
  }
  return facts;
}
function registryDiff(kind, before, after, ctx) {
  const a = registryFacts(kind, before, ctx);
  const b = registryFacts(kind, after, ctx);
  return Object.keys(a).map(field => ({ field, before: a[field], after: b[field], differs: a[field] !== b[field] }));
}

// ---------- Import ----------
let importText = '';   // det som står i rutan, så att det finns kvar om man går tillbaka

// Ser filen ut som en hel datafil från appen (med interna id:n)?
const isAppDataFile = raw => raw && !Array.isArray(raw) && Array.isArray(raw.categories) && Array.isArray(raw.places) &&
  (raw.app === 'TransportLathund' || raw.categories.some(c => c && c.id) || raw.places.some(p => p && p.id));

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
  if (isAppDataFile(raw)) {
    await importFullDataFile(raw, log);
    return;
  }

  // Listorna i filen. En lista [ ... ] direkt räknas som platser.
  const lists = {};
  if (Array.isArray(raw)) lists.places = raw;
  else if (raw && typeof raw === 'object') {
    for (const k of JSON_KINDS) {
      const v = pickKey(raw, ...k.aliases);
      if (v === undefined) continue;
      if (!Array.isArray(v)) { log.append(h('div', { class: 'err' }, `"${k.json}" ska vara en lista [ ... ].`)); return; }
      lists[k.key] = v;
    }
  }
  if (!Object.keys(lists).length) {
    log.append(h('div', { class: 'err' }, 'Hittade inget att importera. Filen ska innehålla minst en av listorna "platser", "kategorier", "floden" eller "speditorer" – se exemplet till vänster.'));
    return;
  }

  // Steg 1: läs alla poster och sök upp adresser. Inget ändras ännu.
  btn.disabled = true;
  const progress = h('div', { class: 'muted' });
  log.append(progress);
  const ctx = newImportCtx();
  ctx.explicit = new Set();   // id:n på nya poster som står i filen (läggs till även om ingen plats använder dem)
  const entries = [];
  const failed = [];

  // Speditörer först, sedan flöden (som kan hänvisa till speditörer), kategorier och sist platser
  for (const kind of ['carriers', 'flows', 'categories']) {
    const seenNames = new Set();
    arr(lists[kind]).forEach((item, i) => {
      const label = str(pickKey(item, 'namn', 'name')) || `post nr ${i + 1}`;
      const tag = `${KIND_SINGULAR[kind]} ${label}`;
      const key = label.trim().toLowerCase();
      if (seenNames.has(key)) { failed.push(`${tag}: finns två gånger i filen – den andra hoppades över.`); return; }
      seenNames.add(key);
      try {
        const r = buildRegistry(kind, item, ctx);
        if (!r.existing) { ctx[kind].push(r.item); ctx.explicit.add(r.item.id); }
        entries.push({ kind, label, tag, place: r.item, existing: r.existing, matchedBy: 'name', notes: [], action: r.existing ? null : 'new' });
      } catch (e) { failed.push(`${tag}: ${e.message}`); }
    });
  }

  const list = arr(lists.places);
  const seen = new Map();   // namn → postnummer, för dubbletter inom filen

  // Sök upp alla adresser som saknar koordinater, flera samtidigt (det är det som tar tid).
  // buildPlace nedan får sedan svaren direkt ur cachen i geocodeWithFallback.
  const toLookUp = [...new Set(list.map(item => {
    if (!item || typeof item !== 'object') return '';
    if (pickKey(item, 'lat', 'latitud', 'latitude') != null) return '';
    const addr = str(pickKey(item, 'adress', 'address')).trim();
    if (!addr) return '';
    const { existing } = findExisting(str(pickKey(item, 'namn', 'name')).trim(), addr);
    return existing && normAddr(addr) === normAddr(existing.address) ? '' : addr;   // behåller befintlig position
  }).filter(Boolean))];
  let looked = 0;
  const total = toLookUp.length;
  const lookUpNext = async () => {
    while (toLookUp.length) {
      const addr = toLookUp.shift();
      try { await geocodeWithFallback(addr); } catch { /* buildPlace försöker igen och rapporterar felet */ }
      progress.textContent = `Söker upp adresser: ${++looked} av ${total}…`;
    }
  };
  if (toLookUp.length) {
    progress.textContent = `Söker upp ${toLookUp.length} adresser…`;
    await Promise.all(Array.from({ length: GEOCODE_WORKERS }, lookUpNext));
  }

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
      entries.push({ kind: 'places', label, tag: label, ...r, action: r.existing ? null : 'new' });
    } catch (e) {
      failed.push(`${label}: ${e.message}`);
    }
  }
  btn.disabled = false;
  progress.remove();

  // Dubbletter: identiska hoppas över direkt, resten får man ta ställning till
  entries.filter(e => e.existing).forEach(e => {
    e.diff = e.kind === 'places' ? placeDiff(e.existing, e.place, ctx) : registryDiff(e.kind, e.existing, e.place, ctx);
    if (!e.diff.some(d => d.differs)) { e.action = 'skip'; e.identical = true; }
  });

  const state = { ctx, entries, failed };
  if (entries.some(e => !e.action)) renderDuplicateReview(state);
  else commitImport(state);
}

// Steg 2 (vid behov): granska dubbletter
const DUP_ACTIONS = [
  { value: 'update', label: 'Skriv över', title: 'Uppdatera den befintliga med uppgifterna från filen (fält som inte finns i filen behålls)' },
  { value: 'skip', label: 'Behåll befintlig', title: 'Ignorera posten i filen' },
  { value: 'copy', label: 'Lägg till som ny', title: 'Behåll den befintliga och lägg till filens plats som en egen plats', placesOnly: true }
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
    DUP_ACTIONS.filter(a => !a.placesOnly || e.kind === 'places').forEach(a => seg.append(h('button', {
      type: 'button', title: a.title, 'data-v': a.value,
      onclick: () => { e.action = a.value; paint(); updateFoot(); }
    }, a.label)));
    card._paint = paint;

    const changed = e.diff.filter(d => d.differs);
    const same = e.diff.filter(d => !d.differs).map(d => d.field);
    const reason = e.kind !== 'places'
      ? `${KIND_SINGULAR[e.kind]} med samma namn finns redan`
      : e.matchedBy === 'name' ? 'Samma namn' : `Samma adress som "${e.existing.name}"`;
    const icon = e.kind === 'places' ? findById(state.ctx, 'categories', e.place.categoryId) : e.existing;
    card.append(
      h('div', { class: 'dup-head' },
        badge(icon, 26),
        h('div', { class: 'spacer' }, h('strong', {}, e.tag), h('div', { class: 'muted small' }, reason)),
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

  const setAll = action => {
    dups.forEach(e => { e.action = action === 'copy' && e.kind !== 'places' ? 'skip' : action; });
    cards.forEach(c => c._paint());
    updateFoot();
  };

  view.innerHTML = '';
  view.append(
    dlgHead([fa('clone'), ` Dubbletter (${dups.length})`], () => importDlg.close()),
    h('div', { class: 'dlg-body' },
      h('p', { class: 'hint', style: 'margin-top:0' },
        `${dups.length} av posterna i filen finns redan (samma namn, eller för platser samma adress). Välj vad som ska hända med var och en. ` +
        (newCount ? `${newCount} nya poster läggs också till. ` : '') +
        (identical ? `${identical} poster är identiska med de befintliga och hoppas över. ` : '') +
        'Inget ändras förrän du klickar Importera, och inget tas bort.'),
      h('div', { class: 'row dup-bulk' },
        h('span', { class: 'muted small' }, 'Alla dubbletter:'),
        h('button', { type: 'button', class: 'small secondary', onclick: () => setAll('update') }, 'Skriv över alla'),
        h('button', { type: 'button', class: 'small secondary', onclick: () => setAll('skip') }, 'Ignorera alla'),
        dups.some(e => e.kind === 'places')
          ? h('button', { type: 'button', class: 'small secondary', title: 'Gäller platser. Andra dubbletter ignoreras.', onclick: () => setAll('copy') }, 'Lägg till alla platser som nya')
          : null),
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
  const res = {
    added: [], updated: [], copied: [], skipped: [], identical: [], approx: [], linked: [], notes: [],
    cats: [], flows: [], carriers: [], regUpdated: []
  };
  const newList = { categories: res.cats, flows: res.flows, carriers: res.carriers };
  const done = [];
  const touchedFlows = [];   // flöden som lagts till eller uppdaterats från filen

  // Kategorier, flöden och speditörer som står i filen
  entries.filter(e => e.kind !== 'places').forEach(e => {
    if (e.action === 'skip') { (e.identical ? res.identical : res.skipped).push(e.tag); return; }
    if (e.action === 'update') {
      const i = placeData[e.kind].findIndex(x => x.id === e.existing.id);
      placeData[e.kind][i] = e.place;
      res.regUpdated.push(e.tag);
    } else {
      placeData[e.kind].push(e.place);
      newList[e.kind].push(e.label);
    }
    if (e.kind === 'flows') touchedFlows.push(e.place);
  });

  // Platser
  entries.filter(e => e.kind === 'places').forEach(e => {
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

  // Kategorier/flöden/speditörer som skapades för att platserna (eller flödena) hänvisade till dem –
  // bara de som faktiskt används av något som importerades
  const has = (kind, id) => placeData[kind].some(x => x.id === id);
  const usedCats = new Set(done.map(p => p.categoryId));
  const usedFlows = new Set(done.flatMap(p => p.flows.map(pf => pf.flowId)));
  ctx.categories.filter(c => usedCats.has(c.id) && !has('categories', c.id)).forEach(c => { placeData.categories.push(c); res.cats.push(c.name); });
  const addedFlows = ctx.flows.filter(f => usedFlows.has(f.id) && !has('flows', f.id));
  addedFlows.forEach(f => { placeData.flows.push(f); res.flows.push(f.name); });
  touchedFlows.push(...addedFlows);
  ctx.flowCarriers.filter(fc => usedFlows.has(fc.flowId)).forEach(({ flowId, carrierId }) => {
    const f = flowById(flowId);
    if (f && !f.carrierId) { f.carrierId = carrierId; touchedFlows.push(f); }
  });
  const usedCarriers = new Set(touchedFlows.map(f => f.carrierId).filter(Boolean));
  ctx.carriers.filter(s => usedCarriers.has(s.id) && !has('carriers', s.id)).forEach(s => { placeData.carriers.push(s); res.carriers.push(s.name); });
  [...new Set(touchedFlows)].filter(f => f.carrierId && carrierById(f.carrierId))
    .forEach(f => res.linked.push(`${f.name} → ${carrierById(f.carrierId).name}`));
  usedCats.forEach(id => setCatVisible(id, true));
  res.cats.forEach(name => { const c = placeData.categories.find(x => x.name === name); if (c) setCatVisible(c.id, true); });

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
  const nNew = res.added.length + res.cats.length + res.flows.length + res.carriers.length;
  const nUpd = res.updated.length + res.regUpdated.length;
  const total = nNew + nUpd + res.copied.length;
  log.append(...[
    h('div', { class: failed.length ? 'err' : 'ok' },
      `Klart: ${nNew} nya, ${nUpd} uppdaterade` +
      (res.copied.length ? `, ${res.copied.length} tillagda som nya` : '') +
      (res.skipped.length + res.identical.length ? `, ${res.skipped.length + res.identical.length} hoppades över` : '') +
      `, ${failed.length} misslyckades.`),
    approxSection,
    section('ok', 'Nya platser', res.added),
    section('ok', 'Uppdaterade platser', res.updated),
    section('ok', 'Dubbletter tillagda som nya platser', res.copied),
    section('ok', 'Nya kategorier', res.cats),
    section('ok', 'Nya flöden', res.flows),
    section('ok', 'Nya speditörer', res.carriers),
    section('ok', 'Uppdaterade kategorier, flöden och speditörer', res.regUpdated),
    section('ok', 'Speditör kopplad till flöde', res.linked),
    section('muted', 'Dubbletter som ignorerades', res.skipped),
    section('muted', 'Identiska med befintliga (hoppades över)', res.identical),
    section('err', 'Obs', res.notes),
    section('err', 'Misslyckades', failed),
    total
      ? h('p', { class: 'hint' }, 'Importen syns nu som ändringar under Data. Där kan du granska och ångra enskilda poster. Glöm inte att exportera till Excel.')
      : null].filter(Boolean));
}

async function importFullDataFile(raw, log) {
  const d = normalizeData(raw);
  if (!await uiConfirm(`Det här ser ut som en hel datafil från appen (${countText(d)}).\n\nSlå ihop den med det som finns på sidan? Poster med samma interna id ersätts, övriga läggs till. Inget tas bort.\n\nVill du i stället ersätta allt, använd en Excel-fil (Data → Öppna fil).`, 'Slå ihop')) return;
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
// Inställningarna i formatguiden (vilka typer, minimal/komplett, adress/koordinater)
const jsonGuide = { kinds: ['places'], level: 'min', pos: 'adress' };

function openImportDialog() {
  const textarea = h('textarea', { id: 'importText', spellcheck: false, placeholder: 'Klistra in din JSON här, eller välj en fil…', value: importText });
  const fileInput = h('input', {
    type: 'file', accept: '.json,application/json,text/plain', hidden: true,
    onchange: async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) textarea.value = await f.text();
    }
  });

  // Guiden: knappar för inställningar, exempel och fältlista som uppdateras när man klickar
  const guide = h('div', { class: 'json-guide' });
  const exampleText = () => JSON.stringify(buildJsonExample(jsonGuide.kinds, jsonGuide.level, jsonGuide.pos), null, 2);
  const copyBtn = h('button', { type: 'button', class: 'small secondary' }, fa('copy'), ' Kopiera');
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(exampleText()); copyBtn.textContent = 'Kopierat'; }
    catch { textarea.value = exampleText(); copyBtn.textContent = 'Inklistrat i rutan'; }
    setTimeout(() => { copyBtn.replaceChildren(fa('copy'), ' Kopiera'); }, 2000);
  };

  const seg = (options, current, onPick) => h('div', { class: 'seg' }, options.map(([v, label]) =>
    h('button', { type: 'button', class: v === current ? 'on' : '', onclick: () => onPick(v) }, label)));

  const renderGuide = () => {
    const k = jsonGuide.kinds;
    const kindBtns = h('div', { class: 'json-kinds' }, JSON_KINDS.map(t => h('button', {
      type: 'button', class: 'json-kind' + (k.includes(t.key) ? ' on' : ''), 'aria-pressed': String(k.includes(t.key)),
      onclick: () => {
        jsonGuide.kinds = k.includes(t.key) ? k.filter(x => x !== t.key) : [...k, t.key];
        if (!jsonGuide.kinds.length) jsonGuide.kinds = [t.key];   // minst en
        renderGuide();
      }
    }, fa(t.icon), ' ', t.label)));

    const fieldRows = JSON_KINDS.filter(t => k.includes(t.key)).flatMap(t => [
      h('tr', { class: 'jf-kind' }, h('th', { colspan: 3 }, `${t.label} – listan "${t.json}"`)),
      ...JSON_FIELDS[t.key].map(f => h('tr', { class: f.full && jsonGuide.level === 'min' ? 'jf-extra' : '' },
        h('td', {}, h('code', {}, f.f.trim()), f.f.startsWith('  ') ? h('span', { class: 'muted small' }, ' (i flöde)') : null),
        h('td', {}, f.req ? h('span', { class: 'jf-req' }, 'Krävs') : h('span', { class: 'muted' }, 'Valfri')),
        h('td', {}, f.d)))
    ]);

    guide.replaceChildren(
      h('div', { class: 'json-opt' }, h('div', { class: 'json-opt-label' }, '1. Vad vill du importera?'), kindBtns),
      h('div', { class: 'json-opt' }, h('div', { class: 'json-opt-label' }, '2. Hur mycket?'),
        seg([['min', 'Minimal – bara det som krävs'], ['full', 'Komplett – alla fält']], jsonGuide.level, v => { jsonGuide.level = v; renderGuide(); })),
      k.includes('places')
        ? h('div', { class: 'json-opt' }, h('div', { class: 'json-opt-label' }, '3. Platsernas position'),
          seg([['adress', 'Adress'], ['koordinater', 'Koordinater (lat/lon)']], jsonGuide.pos, v => { jsonGuide.pos = v; renderGuide(); }))
        : null,
      h('div', { class: 'row', style: 'margin:14px 0 6px' },
        h('h3', { style: 'margin:0', class: 'spacer' }, 'Så här ska din JSON se ut'),
        copyBtn,
        h('button', { type: 'button', class: 'small secondary', onclick: () => { textarea.value = exampleText(); } }, 'Använd i rutan'),
        h('button', { type: 'button', class: 'small secondary', onclick: () => downloadFile('transportlathund-importmall.json', exampleText()) }, fa('download'), ' Mall')),
      h('pre', { class: 'example' }, exampleText()),
      h('h3', {}, 'Fälten'),
      h('table', { class: 'json-fields' }, h('tbody', {}, fieldRows)),
      h('ul', { class: 'rules' },
        h('li', {}, 'Ta med bara de listor du behöver. Vill du bara lägga till platser räcker "platser" (eller en lista [ ... ] direkt).'),
        h('li', {}, 'Kategorier, flöden och speditörer som platserna hänvisar till men som inte finns skapas automatiskt.'),
        h('li', {}, 'Saknas ett exakt husnummer i kartdatan används vägen eller orten. Sådana platser får en uppskattad position (streckad kant och "?" på kartan) som du kan justera.'),
        h('li', {}, 'Finns något redan (samma namn, eller samma adress för platser) får du se skillnaderna och välja per post. "Skriv över" ändrar bara fälten som står i filen.'),
        h('li', {}, 'Engelska fältnamn fungerar också (name, address, category, flows, times, color, icon …).')));
  };
  renderGuide();

  const view = el('importView');
  view.innerHTML = '';
  view.append(
    dlgHead([fa('code'), ' Importera från JSON'], () => importDlg.close()),
    h('div', { class: 'dlg-body' },
      h('div', { class: 'notice json-notice' },
        h('strong', {}, 'JSON-import kompletterar det som finns – inget tas bort. '),
        'Nya poster läggs till. Finns något redan får du välja om det ska skrivas över eller behållas. ',
        'Vill du i stället ersätta allt på sidan, använd en Excel-fil (Data → Öppna fil).'),
      h('div', { class: 'import-grid' },
        guide,
        h('div', {},
          h('h3', { style: 'margin-top:0' }, 'Din JSON'),
          textarea,
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('label', { class: 'btn secondary' }, fa('folder-open'), ' Välj fil…', fileInput),
            h('span', { class: 'spacer' }),
            h('button', { type: 'button', id: 'importRun', onclick: runImport }, fa('file-import'), ' Importera')),
          h('div', { id: 'importLog', class: 'import-log' })))),
    h('div', { class: 'dlg-foot' },
      h('span', { class: 'spacer muted small' }, 'Reservkopia av allt som JSON (kan läsas in här igen):'),
      h('button', { type: 'button', class: 'secondary small', onclick: saveToFile }, fa('download'), ' Ladda ner som JSON')));
  closeAllDialogs();
  importDlg.showModal();
}
