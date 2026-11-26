// TransportLathund – sökfältet i kartläget
// Söker bland platser (namn, adress, kategori, anteckning) och kontakter (platsernas och
// speditörernas: namn, roll, telefon, e-post). Alla ord man skriver måste finnas med.
// Klick (eller Enter) på en träff visar platsen på kartan; kontaktträffar visar telefon och
// e-post direkt i listan. Snabbtangent: / eller Ctrl+K.

const SEARCH_MAX = 8;   // högst så många träffar per grupp

const searchBox = el('searchBox');
const searchInput = h('input', {
  type: 'search', placeholder: 'Sök plats eller kontakt…', autocomplete: 'off', spellcheck: false,
  'aria-label': 'Sök plats eller kontakt'
});
const searchPanel = h('div', { class: 'search-panel', hidden: true });
searchBox.append(h('span', { class: 'search-ic' }, fa('magnifying-glass')), searchInput, searchPanel);

const normText = s => str(s).toLowerCase();
const digits = s => str(s).replace(/\D/g, '');

// Matchar alla ord? Siffror jämförs också utan mellanslag och bindestreck (telefonnummer).
function matchesAll(words, text, phones = '') {
  return words.every(w => text.includes(w) || (/^[\d\s-]+$/.test(w) && digits(w).length >= 3 && phones.includes(digits(w))));
}

// Text med sökorden markerade
function highlight(text, words) {
  text = str(text);
  const lower = text.toLowerCase();
  const marks = [];
  words.forEach(w => {
    if (!w) return;
    let i = lower.indexOf(w);
    while (i >= 0) { marks.push([i, i + w.length]); i = lower.indexOf(w, i + w.length); }
  });
  if (!marks.length) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = 0;
  marks.forEach(([s, e]) => {
    if (e <= at) return;
    s = Math.max(s, at);
    if (s > at) out.push(text.slice(at, s));
    out.push(h('mark', {}, text.slice(s, e)));
    at = e;
  });
  out.push(text.slice(at));
  return out;
}

function runSearch(q) {
  const words = normText(q).split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  const places = placeData.places.filter(p => {
    const cat = catById(p.categoryId);
    return matchesAll(words, normText([p.name, p.address, cat && cat.name, p.note].join(' ')));
  });

  const contacts = [];
  placeData.places.forEach(p => p.contacts.forEach(c => {
    const flow = c.flowId ? flowById(c.flowId) : null;
    const text = normText([c.name, c.role, c.phone, c.email, p.name, flow && flow.name].join(' '));
    if (matchesAll(words, text, digits(c.phone))) contacts.push({ c, place: p, flow });
  }));
  placeData.carriers.forEach(s => s.contacts.forEach(c => {
    const text = normText([c.name, c.role, c.phone, c.email, s.name].join(' '));
    if (matchesAll(words, text, digits(c.phone))) contacts.push({ c, carrier: s });
  }));
  return { words, places, contacts };
}

let searchHits = [];   // träffarna i den ordning de visas, för piltangenterna
let searchSel = -1;

function renderSearch() {
  const res = runSearch(searchInput.value);
  searchPanel.innerHTML = '';
  searchHits = [];
  searchSel = -1;
  if (!res) { searchPanel.hidden = true; return; }

  const { words } = res;
  const addHit = (node, action) => {
    const i = searchHits.length;
    node.classList.add('search-hit');
    node.onmousedown = e => e.preventDefault();   // behåll fokus i sökfältet
    node.onclick = e => { if (e.target.closest('a')) return; action(); };
    node.onmouseenter = () => selectHit(i);
    searchHits.push({ node, action });
    return node;
  };
  const group = (title, n, shown) => h('div', { class: 'search-group' },
    title, h('span', { class: 'muted' }, n > shown ? ` (${shown} av ${n} – skriv mer för att begränsa)` : ` (${n})`));

  if (res.places.length) {
    searchPanel.append(group('Platser', res.places.length, Math.min(res.places.length, SEARCH_MAX)));
    res.places.slice(0, SEARCH_MAX).forEach(p => {
      const cat = catById(p.categoryId);
      searchPanel.append(addHit(h('div', {},
        badge(cat, 26),
        h('div', { class: 'sh-main' },
          h('div', { class: 'sh-title' }, highlight(p.name, words)),
          h('div', { class: 'sh-sub' }, highlight([cat && cat.name, p.address].filter(Boolean).join(' · '), words)))),
      () => openSearchHit(p)));
    });
  }

  if (res.contacts.length) {
    searchPanel.append(group('Kontakter', res.contacts.length, Math.min(res.contacts.length, SEARCH_MAX)));
    res.contacts.slice(0, SEARCH_MAX).forEach(({ c, place, flow, carrier }) => {
      const where = place ? place.name + (flow ? ` (${flow.name})` : '') : `Speditör: ${carrier.name}`;
      const links = [
        c.phone ? h('a', { href: 'tel:' + c.phone.replace(/[^\d+]/g, '') }, fa('phone'), ' ', highlight(c.phone, words)) : null,
        c.email ? h('a', { href: 'mailto:' + c.email }, fa('envelope'), ' ', highlight(c.email, words)) : null
      ].filter(Boolean);
      searchPanel.append(addHit(h('div', {},
        h('span', { class: 'sh-person' }, fa(carrier ? 'truck' : 'user')),
        h('div', { class: 'sh-main' },
          h('div', { class: 'sh-title' }, highlight(c.name || c.role || 'Kontakt', words),
            c.name && c.role ? h('span', { class: 'muted' }, ' · ', highlight(c.role, words)) : null),
          h('div', { class: 'sh-sub' }, highlight(where, words)),
          links.length ? h('div', { class: 'sh-links' }, links) : null)),
      () => (place ? openSearchHit(place) : openCarrierFromSearch(carrier))));
    });
  }

  if (!searchHits.length) searchPanel.append(h('div', { class: 'search-empty' }, `Inget hittades för "${searchInput.value.trim()}".`));
  searchPanel.hidden = false;
  if (searchHits.length) selectHit(0);
}

function selectHit(i) {
  if (searchHits[searchSel]) searchHits[searchSel].node.classList.remove('sel');
  searchSel = i;
  const hit = searchHits[i];
  if (hit) { hit.node.classList.add('sel'); hit.node.scrollIntoView({ block: 'nearest' }); }
}

function closeSearch() { searchPanel.hidden = true; }
function openSearchHit(p) {
  closeSearch();
  searchInput.blur();
  showOnMap(p);   // places.js: visar platsen även om den är filtrerad bort, och öppnar dess ruta
}
function openCarrierFromSearch(s) {
  closeSearch();
  searchInput.blur();
  openRegistryDialog('carriers');
}

searchInput.addEventListener('input', renderSearch);
searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) renderSearch(); });
searchInput.addEventListener('blur', () => setTimeout(closeSearch, 150));
searchInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' && searchHits.length) { e.preventDefault(); selectHit((searchSel + 1) % searchHits.length); }
  else if (e.key === 'ArrowUp' && searchHits.length) { e.preventDefault(); selectHit((searchSel - 1 + searchHits.length) % searchHits.length); }
  else if (e.key === 'Enter' && searchHits[searchSel]) { e.preventDefault(); searchHits[searchSel].action(); }
  else if (e.key === 'Escape') {
    e.preventDefault();
    if (!searchPanel.hidden) closeSearch();
    else { searchInput.value = ''; searchInput.blur(); }
  }
});

// "/" eller Ctrl+K hoppar till sökfältet (inte medan man skriver någon annanstans eller har en ruta öppen)
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (document.querySelector('dialog[open]')) return;
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});
