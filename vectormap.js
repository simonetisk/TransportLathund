// ---------- Vektorkartor (OpenFreeMap) ----------
// Kartan ritas i webbläsaren med MapLibre i stället för färdiga bilder, så vi
// styr själva språk, typsnitt och färger. Gratis, ingen API-nyckel.
// MapLibre (~800 kB) laddas först när en vektorkarta väljs.
//
// Laddas före app.js, som lägger in VECTOR_LAYERS bland kartstilarna.

const VECTOR_LIBS = {
  css: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  js: [
    'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
    'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js'
  ]
};
const OFM = 'https://tiles.openfreemap.org/styles';

// Svenskt namn i första hand, annars det lokala namnet (i Sverige redan svenskt).
const NAME_SV = ['coalesce', ['get', 'name:sv'], ['get', 'name']];

// ---- Inställningar för etiketter: ändra här för att prova ----
const VECTOR_LABELS = {
  font: 'Noto Sans Regular',      // Finns: 'Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'
  boldFont: 'Noto Sans Bold',     // Används för städer, län och länder
  sizeScale: 1.0,                 // 1.2 = 20 % större text
  hidePOI: true                   // Dölj butiker, busshållplatser m.m.
};

// ---- Färger för "Vektor mörk" ----
// OpenFreeMaps mörka stil är nästan svart. Här ljusas den upp och får samma
// blågrå ton som appens mörka tema. Ändra fritt; ljusare = högre värden.
const DARK_PALETTE = {
  land:      '#232932',   // bakgrund/mark
  water:     '#151a21',   // sjöar, hav, älvar (mörkare än land så de syns)
  green:     '#25302c',   // skog och parker
  urban:     '#2a3039',   // bostadsområden
  building:  '#2f3640', buildingEdge: '#3b434f',
  roadMinor: '#353d48',   // småvägar
  roadMajor: '#4a5361', roadCasing: '#2c333d',
  motorway:  '#5c6676',
  rail:      '#434b57',
  border:    '#5a6372',   // läns- och landsgränser
  label:     '#c3cad4', labelHalo: '#1a1f26',   // ortnamn
  roadLabel: '#939cab',                          // gatunamn
  waterLabel:'#7f95b3'                           // vattennamn
};

function darkOverrides(P) {
  const placeText = { 'text-color': P.label, 'text-halo-color': P.labelHalo, 'text-halo-width': 1.2 };
  return {
    background: { 'background-color': P.land },
    water: { 'fill-color': P.water },
    waterway: { 'line-color': P.water },
    landcover_ice_shelf: { 'fill-color': P.land },
    landcover_glacier: { 'fill-color': P.land },
    landuse_residential: { 'fill-color': P.urban, 'fill-opacity': 0.7 },
    landcover_wood: { 'fill-color': P.green },
    landuse_park: { 'fill-color': P.green },
    building: { 'fill-color': P.building, 'fill-outline-color': P.buildingEdge },
    aeroway_area: { 'fill-color': P.urban },
    'aeroway-area': { 'fill-color': P.urban },
    'aeroway-runway': { 'line-color': P.roadMajor },
    'aeroway-taxiway': { 'line-color': P.roadMinor },
    road_area_pier: { 'fill-color': P.land },
    road_pier: { 'line-color': P.land },
    highway_path: { 'line-color': P.roadMinor },
    highway_minor: { 'line-color': P.roadMinor },
    highway_major_casing: { 'line-color': P.roadCasing },
    highway_major_inner: { 'line-color': P.roadMajor },
    highway_major_subtle: { 'line-color': P.roadMajor },
    highway_motorway_casing: { 'line-color': P.roadCasing },
    highway_motorway_inner: { 'line-color': P.motorway },
    highway_motorway_subtle: { 'line-color': P.motorway },
    railway_transit: { 'line-color': P.rail }, railway_minor: { 'line-color': P.rail }, railway: { 'line-color': P.rail },
    railway_transit_dashline: { 'line-color': P.land }, railway_minor_dashline: { 'line-color': P.land }, railway_dashline: { 'line-color': P.land },
    boundary_state: { 'line-color': P.border },
    'boundary_country_z0-4': { 'line-color': P.border },
    'boundary_country_z5-': { 'line-color': P.border },
    water_name: { 'text-color': P.waterLabel, 'text-halo-color': P.water, 'text-halo-width': 1 },
    highway_name_other: { 'text-color': P.roadLabel, 'text-halo-color': P.labelHalo },
    highway_name_motorway: { 'text-color': P.roadLabel, 'text-halo-color': P.labelHalo },
    place_other: placeText, place_suburb: placeText, place_village: placeText, place_town: placeText,
    place_city: placeText, place_city_large: placeText, place_state: placeText,
    place_country_other: placeText, place_country_minor: placeText, place_country_major: placeText
  };
}

let vectorLibsPromise = null;
function loadVectorLibs() {
  if (vectorLibsPromise) return vectorLibsPromise;
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = VECTOR_LIBS.css;
  document.head.append(css);
  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error('Kunde inte ladda ' + src));
    document.head.append(s);
  });
  // I tur och ordning: Leaflet-pluginet kräver att MapLibre redan finns
  vectorLibsPromise = VECTOR_LIBS.js.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
    .catch(e => { vectorLibsPromise = null; throw e; });
  return vectorLibsPromise;
}

const usesName = v => /"name/.test(JSON.stringify(v));

// Justera en OpenFreeMap-stil: svenska namn, valt typsnitt, ev. dölj POI.
function swedishStyle(style, styleName) {
  const BOLD = /place_(city|state|country)|label_(city|state|country)/;
  style.layers = style.layers.filter(l => !(VECTOR_LABELS.hidePOI && /^poi/.test(l.id)));
  const paint = styleName === 'dark' ? darkOverrides(DARK_PALETTE) : {};
  style.layers.forEach(l => {
    if (paint[l.id]) l.paint = { ...l.paint, ...paint[l.id] };
    const lay = l.layout;
    if (!lay || !lay['text-field']) return;
    if (usesName(lay['text-field'])) lay['text-field'] = NAME_SV;
    lay['text-font'] = [BOLD.test(l.id) ? VECTOR_LABELS.boldFont : VECTOR_LABELS.font];
    if (VECTOR_LABELS.sizeScale !== 1 && lay['text-size'] != null) {
      lay['text-size'] = ['*', VECTOR_LABELS.sizeScale, typeof lay['text-size'] === 'object' && !Array.isArray(lay['text-size'])
        ? ['interpolate', ['linear'], ['zoom'], ...lay['text-size'].stops.flat()] // gammal "stops"-syntax
        : lay['text-size']];
    }
  });
  return style;
}

// Leaflet-lager som laddar MapLibre + stilen när det läggs på kartan.
const VectorBaseLayer = L.Layer.extend({
  initialize(styleName) { this._styleName = styleName; },
  onAdd(map) {
    this._active = true;
    if (this._gl) { this._gl.addTo(map); return; }
    Promise.all([loadVectorLibs(), fetch(`${OFM}/${this._styleName}`).then(r => r.json())])
      .then(([, style]) => {
        if (this._gl) return;
        this._gl = L.maplibreGL({
          style: swedishStyle(style, this._styleName),
          attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; OpenMapTiles &copy; OpenStreetMap-bidragsgivare'
        });
        if (this._active) this._gl.addTo(map);
        // Vissa stilar pekar på ikoner som saknas; ersätt med en tom bild i stället för varningar
        this._gl.getMaplibreMap().on('styleimagemissing', e => {
          const gl = this._gl.getMaplibreMap();
          if (!gl.hasImage(e.id)) gl.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
        });
      })
      .catch(err => {
        console.error(err);
        if (typeof uiAlert === 'function') uiAlert('Vektorkartan kunde inte laddas (kräver internet).\n\n' + err.message);
      });
  },
  onRemove(map) {
    this._active = false;
    if (this._gl) map.removeLayer(this._gl);
  }
});

const VECTOR_LAYERS = {
  'Vektor mörk (svenska)': new VectorBaseLayer('dark'),
  'Vektor ljus (svenska)': new VectorBaseLayer('positron'),
  'Vektor detaljerad (svenska)': new VectorBaseLayer('liberty')
};
