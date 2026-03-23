/**
 * Bergkönig — Alpine Sub-Regionen
 * ~95 Sub-Regionen über den gesamten Alpenraum
 * Jede Region hat: id, name, parent (OSM-Region-Code), latMin, latMax, lngMin, lngMax
 */

const ALPINE_SUB_REGIONS = [

  // ===== VORARLBERG (AT-08) =====
  { id: 'kleinwalsertal',   name: 'Kleinwalsertal',   parent: 'AT-08', latMin: 47.30, latMax: 47.40, lngMin: 10.05, lngMax: 10.22 },
  { id: 'bregenzerwald',    name: 'Bregenzerwald',    parent: 'AT-08', latMin: 47.30, latMax: 47.52, lngMin: 9.78, lngMax: 10.05 },
  { id: 'arlberg',          name: 'Arlberg',          parent: 'AT-08', latMin: 47.05, latMax: 47.20, lngMin: 10.10, lngMax: 10.35 },
  { id: 'montafon',         name: 'Montafon',         parent: 'AT-08', latMin: 46.90, latMax: 47.10, lngMin: 9.85, lngMax: 10.15 },
  { id: 'rheintal',         name: 'Rheintal',         parent: 'AT-08', latMin: 47.15, latMax: 47.50, lngMin: 9.52, lngMax: 9.78 },
  { id: 'raetikon',         name: 'Rätikon',          parent: 'AT-08', latMin: 46.95, latMax: 47.12, lngMin: 9.72, lngMax: 9.95 },
  { id: 'silvretta-at',     name: 'Silvretta',        parent: 'AT-08', latMin: 46.82, latMax: 47.00, lngMin: 10.05, lngMax: 10.35 },

  // ===== BAYERN (DE-BY) =====
  { id: 'oberallgaeu',      name: 'Oberallgäu',       parent: 'DE-BY', latMin: 47.30, latMax: 47.55, lngMin: 10.20, lngMax: 10.50 },
  { id: 'ostallgaeu',       name: 'Ostallgäu',        parent: 'DE-BY', latMin: 47.45, latMax: 47.70, lngMin: 10.50, lngMax: 10.90 },
  { id: 'ammergauer-alpen', name: 'Ammergauer Alpen', parent: 'DE-BY', latMin: 47.35, latMax: 47.55, lngMin: 10.80, lngMax: 11.15 },
  { id: 'werdenfelser-land', name: 'Werdenfelser Land', parent: 'DE-BY', latMin: 47.35, latMax: 47.55, lngMin: 11.05, lngMax: 11.40 },
  { id: 'karwendel-by',     name: 'Karwendel BY',     parent: 'DE-BY', latMin: 47.40, latMax: 47.55, lngMin: 11.30, lngMax: 11.65 },
  { id: 'mangfallgebirge',  name: 'Mangfallgebirge',  parent: 'DE-BY', latMin: 47.55, latMax: 47.75, lngMin: 11.65, lngMax: 12.10 },
  { id: 'chiemgauer-alpen', name: 'Chiemgauer Alpen', parent: 'DE-BY', latMin: 47.55, latMax: 47.80, lngMin: 12.20, lngMax: 12.80 },
  { id: 'berchtesgadener-alpen', name: 'Berchtesgadener Alpen', parent: 'DE-BY', latMin: 47.45, latMax: 47.70, lngMin: 12.80, lngMax: 13.10 },

  // ===== TIROL (AT-07) =====
  { id: 'lechtal',          name: 'Lechtal',          parent: 'AT-07', latMin: 47.10, latMax: 47.35, lngMin: 10.35, lngMax: 10.80 },
  { id: 'inntal-west',      name: 'Inntal West',      parent: 'AT-07', latMin: 47.15, latMax: 47.35, lngMin: 10.60, lngMax: 11.20 },
  { id: 'inntal-ost',       name: 'Inntal Ost',       parent: 'AT-07', latMin: 47.15, latMax: 47.35, lngMin: 11.20, lngMax: 11.80 },
  { id: 'wipptal',          name: 'Wipptal',          parent: 'AT-07', latMin: 46.98, latMax: 47.15, lngMin: 11.35, lngMax: 11.55 },
  { id: 'stubaier-alpen',   name: 'Stubaier Alpen',   parent: 'AT-07', latMin: 46.92, latMax: 47.15, lngMin: 11.05, lngMax: 11.40 },
  { id: 'oetztaler-alpen',  name: 'Ötztaler Alpen',   parent: 'AT-07', latMin: 46.72, latMax: 47.10, lngMin: 10.65, lngMax: 11.10 },
  { id: 'zillertal',        name: 'Zillertal',        parent: 'AT-07', latMin: 47.00, latMax: 47.20, lngMin: 11.70, lngMax: 12.10 },
  { id: 'tuxer-alpen',      name: 'Tuxer Alpen',      parent: 'AT-07', latMin: 46.95, latMax: 47.15, lngMin: 11.50, lngMax: 11.80 },
  { id: 'karwendel',        name: 'Karwendel',        parent: 'AT-07', latMin: 47.20, latMax: 47.45, lngMin: 11.20, lngMax: 11.65 },
  { id: 'rofan',            name: 'Rofan',            parent: 'AT-07', latMin: 47.35, latMax: 47.48, lngMin: 11.70, lngMax: 11.95 },
  { id: 'kitzbueheler-alpen', name: 'Kitzbüheler Alpen', parent: 'AT-07', latMin: 47.20, latMax: 47.45, lngMin: 12.10, lngMax: 12.50 },
  { id: 'kaiser',           name: 'Kaiser',           parent: 'AT-07', latMin: 47.45, latMax: 47.60, lngMin: 12.10, lngMax: 12.40 },
  { id: 'osttirol',         name: 'Osttirol',         parent: 'AT-07', latMin: 46.70, latMax: 47.00, lngMin: 12.20, lngMax: 12.80 },

  // ===== SALZBURG (AT-05) =====
  { id: 'pinzgau',          name: 'Pinzgau',          parent: 'AT-05', latMin: 47.10, latMax: 47.40, lngMin: 12.40, lngMax: 13.00 },
  { id: 'pongau',           name: 'Pongau',           parent: 'AT-05', latMin: 47.10, latMax: 47.40, lngMin: 13.00, lngMax: 13.50 },
  { id: 'lungau',           name: 'Lungau',           parent: 'AT-05', latMin: 47.00, latMax: 47.20, lngMin: 13.55, lngMax: 14.00 },
  { id: 'tennengau',        name: 'Tennengau',        parent: 'AT-05', latMin: 47.40, latMax: 47.60, lngMin: 13.05, lngMax: 13.40 },
  { id: 'hohe-tauern-sbg',  name: 'Hohe Tauern Sbg',  parent: 'AT-05', latMin: 46.95, latMax: 47.15, lngMin: 12.60, lngMax: 13.20 },

  // ===== KÄRNTEN (AT-02) =====
  { id: 'hohe-tauern-ktn',  name: 'Hohe Tauern Ktn',  parent: 'AT-02', latMin: 46.80, latMax: 47.05, lngMin: 12.80, lngMax: 13.40 },
  { id: 'gailtaler-alpen',  name: 'Gailtaler Alpen',  parent: 'AT-02', latMin: 46.55, latMax: 46.75, lngMin: 12.90, lngMax: 13.50 },
  { id: 'karawanken-at',    name: 'Karawanken',       parent: 'AT-02', latMin: 46.40, latMax: 46.55, lngMin: 13.50, lngMax: 14.60 },
  { id: 'nockberge',        name: 'Nockberge',        parent: 'AT-02', latMin: 46.80, latMax: 47.05, lngMin: 13.60, lngMax: 14.00 },
  { id: 'kreuzeckgruppe',   name: 'Kreuzeckgruppe',   parent: 'AT-02', latMin: 46.75, latMax: 46.95, lngMin: 13.10, lngMax: 13.55 },

  // ===== STEIERMARK (AT-06) =====
  { id: 'dachstein',        name: 'Dachstein',        parent: 'AT-06', latMin: 47.35, latMax: 47.55, lngMin: 13.55, lngMax: 13.90 },
  { id: 'schladminger-tauern', name: 'Schladminger Tauern', parent: 'AT-06', latMin: 47.15, latMax: 47.40, lngMin: 13.50, lngMax: 14.00 },
  { id: 'gesaeuse',         name: 'Gesäuse',          parent: 'AT-06', latMin: 47.50, latMax: 47.65, lngMin: 14.50, lngMax: 14.80 },
  { id: 'hochschwab',       name: 'Hochschwab',       parent: 'AT-06', latMin: 47.55, latMax: 47.70, lngMin: 14.95, lngMax: 15.25 },
  { id: 'eisenerzer-alpen', name: 'Eisenerzer Alpen', parent: 'AT-06', latMin: 47.45, latMax: 47.60, lngMin: 14.75, lngMax: 15.05 },

  // ===== SCHWEIZ — Graubünden (CH) =====
  { id: 'oberengadin',      name: 'Oberengadin',      parent: 'CH', latMin: 46.38, latMax: 46.60, lngMin: 9.70, lngMax: 10.10 },
  { id: 'unterengadin',     name: 'Unterengadin',     parent: 'CH', latMin: 46.70, latMax: 46.95, lngMin: 10.10, lngMax: 10.50 },
  { id: 'davos-klosters',   name: 'Davos/Klosters',   parent: 'CH', latMin: 46.72, latMax: 46.92, lngMin: 9.70, lngMax: 10.10 },
  { id: 'surselva',         name: 'Surselva',         parent: 'CH', latMin: 46.60, latMax: 46.85, lngMin: 8.65, lngMax: 9.20 },
  { id: 'chur-plessur',     name: 'Chur/Plessur',     parent: 'CH', latMin: 46.78, latMax: 46.95, lngMin: 9.45, lngMax: 9.70 },
  { id: 'praettigau',       name: 'Prättigau',        parent: 'CH', latMin: 46.88, latMax: 47.05, lngMin: 9.70, lngMax: 10.00 },
  { id: 'bernina',          name: 'Bernina',          parent: 'CH', latMin: 46.30, latMax: 46.48, lngMin: 9.85, lngMax: 10.10 },
  { id: 'silvretta-ch',     name: 'Silvretta CH',     parent: 'CH', latMin: 46.82, latMax: 46.98, lngMin: 10.00, lngMax: 10.25 },

  // ===== SCHWEIZ — Wallis (CH) =====
  { id: 'zermatt',          name: 'Zermatt',          parent: 'CH', latMin: 45.95, latMax: 46.10, lngMin: 7.55, lngMax: 7.85 },
  { id: 'saas-fee',         name: 'Saas-Fee',         parent: 'CH', latMin: 46.05, latMax: 46.20, lngMin: 7.85, lngMax: 8.05 },
  { id: 'loetschental',     name: 'Lötschental',      parent: 'CH', latMin: 46.38, latMax: 46.50, lngMin: 7.70, lngMax: 7.95 },
  { id: 'oberwallis',       name: 'Oberwallis',       parent: 'CH', latMin: 46.15, latMax: 46.45, lngMin: 7.95, lngMax: 8.35 },
  { id: 'unterwallis',      name: 'Unterwallis',      parent: 'CH', latMin: 46.00, latMax: 46.30, lngMin: 6.80, lngMax: 7.55 },

  // ===== SCHWEIZ — Berner Oberland (CH) =====
  { id: 'jungfrau-region',  name: 'Jungfrau-Region',  parent: 'CH', latMin: 46.48, latMax: 46.65, lngMin: 7.80, lngMax: 8.10 },
  { id: 'kandersteg',       name: 'Kandersteg',       parent: 'CH', latMin: 46.42, latMax: 46.55, lngMin: 7.58, lngMax: 7.78 },
  { id: 'simmental',        name: 'Simmental',        parent: 'CH', latMin: 46.55, latMax: 46.75, lngMin: 7.25, lngMax: 7.60 },
  { id: 'haslital',         name: 'Haslital',         parent: 'CH', latMin: 46.60, latMax: 46.78, lngMin: 8.10, lngMax: 8.40 },

  // ===== SCHWEIZ — Zentralschweiz (CH) =====
  { id: 'uri',              name: 'Uri',              parent: 'CH', latMin: 46.60, latMax: 46.90, lngMin: 8.40, lngMax: 8.75 },
  { id: 'glarus',           name: 'Glarus',           parent: 'CH', latMin: 46.80, latMax: 47.05, lngMin: 8.90, lngMax: 9.25 },
  { id: 'schwyz',           name: 'Schwyz',           parent: 'CH', latMin: 46.90, latMax: 47.10, lngMin: 8.60, lngMax: 8.90 },
  { id: 'titlis-engelberg', name: 'Titlis/Engelberg', parent: 'CH', latMin: 46.72, latMax: 46.90, lngMin: 8.30, lngMax: 8.55 },
  { id: 'pilatus-luzern',   name: 'Pilatus/Luzern',   parent: 'CH', latMin: 46.90, latMax: 47.05, lngMin: 8.20, lngMax: 8.45 },
  { id: 'appenzell-alpstein', name: 'Appenzell/Alpstein', parent: 'CH', latMin: 47.20, latMax: 47.40, lngMin: 9.30, lngMax: 9.55 },

  // ===== SCHWEIZ — Tessin (CH) =====
  { id: 'tessin-nord',      name: 'Tessin Nord',      parent: 'CH', latMin: 46.30, latMax: 46.60, lngMin: 8.55, lngMax: 9.00 },
  { id: 'tessin-sued',      name: 'Tessin Süd',       parent: 'CH', latMin: 45.85, latMax: 46.30, lngMin: 8.70, lngMax: 9.10 },

  // ===== ITALIEN — Südtirol (IT-32-BZ) =====
  { id: 'vinschgau',        name: 'Vinschgau',        parent: 'IT-32-BZ', latMin: 46.55, latMax: 46.80, lngMin: 10.45, lngMax: 10.95 },
  { id: 'meraner-land',     name: 'Meraner Land',     parent: 'IT-32-BZ', latMin: 46.60, latMax: 46.78, lngMin: 10.95, lngMax: 11.25 },
  { id: 'passeiertal',      name: 'Passeiertal',      parent: 'IT-32-BZ', latMin: 46.72, latMax: 46.95, lngMin: 11.08, lngMax: 11.32 },
  { id: 'eisacktal',        name: 'Eisacktal',        parent: 'IT-32-BZ', latMin: 46.55, latMax: 46.80, lngMin: 11.25, lngMax: 11.55 },
  { id: 'pustertal',        name: 'Pustertal',        parent: 'IT-32-BZ', latMin: 46.68, latMax: 46.85, lngMin: 11.55, lngMax: 12.20 },
  { id: 'groeden-seiser-alm', name: 'Gröden/Seiser Alm', parent: 'IT-32-BZ', latMin: 46.48, latMax: 46.62, lngMin: 11.55, lngMax: 11.85 },
  { id: 'dolomiten-west',   name: 'Dolomiten West',   parent: 'IT-32-BZ', latMin: 46.35, latMax: 46.55, lngMin: 11.40, lngMax: 11.80 },
  { id: 'dolomiten-ost',    name: 'Dolomiten Ost',    parent: 'IT-32-BZ', latMin: 46.35, latMax: 46.55, lngMin: 11.80, lngMax: 12.20 },
  { id: 'drei-zinnen',      name: 'Drei Zinnen',      parent: 'IT-32-BZ', latMin: 46.55, latMax: 46.72, lngMin: 12.10, lngMax: 12.40 },

  // ===== ITALIEN — Trentino (IT-32-TN) =====
  { id: 'brenta',           name: 'Brenta',           parent: 'IT-32-TN', latMin: 46.10, latMax: 46.30, lngMin: 10.80, lngMax: 11.05 },
  { id: 'adamello',         name: 'Adamello',         parent: 'IT-32-TN', latMin: 46.05, latMax: 46.25, lngMin: 10.45, lngMax: 10.80 },
  { id: 'ortler',           name: 'Ortler',           parent: 'IT-32-TN', latMin: 46.30, latMax: 46.55, lngMin: 10.50, lngMax: 10.80 },

  // ===== ITALIEN — Lombardei (IT-25) =====
  { id: 'veltlin',          name: 'Veltlin',          parent: 'IT-25', latMin: 46.10, latMax: 46.40, lngMin: 9.55, lngMax: 10.30 },
  { id: 'bergamasker-alpen', name: 'Bergamasker Alpen', parent: 'IT-25', latMin: 45.90, latMax: 46.10, lngMin: 9.65, lngMax: 10.10 },
  { id: 'comer-see',        name: 'Comer See',        parent: 'IT-25', latMin: 45.95, latMax: 46.25, lngMin: 9.15, lngMax: 9.55 },

  // ===== ITALIEN — Aostatal (IT-23) =====
  { id: 'mont-blanc-it',    name: 'Mont Blanc IT',    parent: 'IT-23', latMin: 45.75, latMax: 45.92, lngMin: 6.80, lngMax: 7.10 },
  { id: 'gran-paradiso',    name: 'Gran Paradiso',    parent: 'IT-23', latMin: 45.45, latMax: 45.65, lngMin: 7.15, lngMax: 7.50 },
  { id: 'monte-rosa-it',    name: 'Monte Rosa IT',    parent: 'IT-23', latMin: 45.80, latMax: 45.98, lngMin: 7.70, lngMax: 8.00 },

  // ===== FRANKREICH (FR) =====
  { id: 'mont-blanc-fr',    name: 'Mont Blanc FR',    parent: 'FR', latMin: 45.80, latMax: 45.98, lngMin: 6.75, lngMax: 7.00 },
  { id: 'vanoise',          name: 'Vanoise',          parent: 'FR', latMin: 45.25, latMax: 45.50, lngMin: 6.60, lngMax: 7.10 },
  { id: 'ecrins',           name: 'Écrins',           parent: 'FR', latMin: 44.75, latMax: 45.05, lngMin: 6.05, lngMax: 6.50 },
  { id: 'mercantour',       name: 'Mercantour',       parent: 'FR', latMin: 43.95, latMax: 44.25, lngMin: 6.80, lngMax: 7.45 },
  { id: 'chartreuse',       name: 'Chartreuse',       parent: 'FR', latMin: 45.25, latMax: 45.45, lngMin: 5.72, lngMax: 5.95 },
  { id: 'aravis',           name: 'Aravis',           parent: 'FR', latMin: 45.85, latMax: 46.02, lngMin: 6.30, lngMax: 6.55 },
  { id: 'chablais',         name: 'Chablais',         parent: 'FR', latMin: 46.15, latMax: 46.40, lngMin: 6.40, lngMax: 6.80 },

  // ===== SLOWENIEN (SI) =====
  { id: 'julische-alpen',   name: 'Julische Alpen',   parent: 'SI', latMin: 46.20, latMax: 46.48, lngMin: 13.55, lngMax: 14.00 },
  { id: 'karawanken-si',    name: 'Karawanken SI',    parent: 'SI', latMin: 46.35, latMax: 46.50, lngMin: 14.00, lngMax: 14.60 },
  { id: 'steiner-alpen',    name: 'Steiner Alpen',    parent: 'SI', latMin: 46.30, latMax: 46.45, lngMin: 14.50, lngMax: 14.90 },

  // ===== LIECHTENSTEIN (LI) =====
  { id: 'liechtenstein',    name: 'Liechtenstein',    parent: 'LI', latMin: 47.04, latMax: 47.27, lngMin: 9.47, lngMax: 9.64 },
];

// Global verfügbar machen
window.ALPINE_SUB_REGIONS = ALPINE_SUB_REGIONS;

/**
 * Sub-Region für gegebene Koordinaten ermitteln.
 * Gibt das erste passende Sub-Region-Objekt zurück oder null.
 */
function getSubRegion(lat, lng) {
  for (const sr of ALPINE_SUB_REGIONS) {
    if (lat >= sr.latMin && lat <= sr.latMax && lng >= sr.lngMin && lng <= sr.lngMax) {
      return sr;
    }
  }
  return null;
}

/**
 * Alle Sub-Regionen für einen gegebenen Parent-Code zurückgeben.
 * @param {string} parentCode - z.B. 'AT-08', 'CH', 'DE-BY'
 * @returns {Array} Array von Sub-Region-Objekten
 */
function getSubRegionsForParent(parentCode) {
  return ALPINE_SUB_REGIONS.filter(sr => sr.parent === parentCode);
}

// Global verfügbar machen
window.getSubRegion = getSubRegion;
window.getSubRegionsForParent = getSubRegionsForParent;
