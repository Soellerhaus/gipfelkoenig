// =============================================================================
// Bergkönig — Kartenintegration (map.js)
// Leaflet-Karte mit Gipfelmarkern, Popup-Infos und Echtzeit-Aktualisierung.
// =============================================================================

// Globaler Namespace
window.GK = window.GK || {};
GK.map = {};

// ---------------------------------------------------------------------------
// Gespeicherte Gipfel-Daten (id → Gipfel-Objekt)
// ---------------------------------------------------------------------------
GK.map.peaks = new Map();

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------
const MAP_DEFAULT_CENTER = [47.35, 10.15]; // Kleinwalsertal
const MAP_DEFAULT_ZOOM = 13;
const DEBOUNCE_DELAY = 500; // ms

// ---------------------------------------------------------------------------
// Marker-Icons als L.divIcon
// ---------------------------------------------------------------------------

/** König-Marker: Goldene Krone — Benutzer ist aktueller Besitzer */
function createKingIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="peak-marker king"><span>👑</span></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

/** Normal-Marker: Weißes Dreieck — Noch nie bestiegen */
function createNormalIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="peak-marker normal"><span>▲</span></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

/** Bestiegen-Marker: Graues Dreieck — Bestiegen, aber nicht König */
function createSummitedIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="peak-marker summited"><span>▲</span></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

/** Angegriffene-Krone-Marker: Goldenes Schwert — Krone wird angegriffen */
function createAttackedIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="peak-marker attacked"><span>⚔️</span></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

/** Gefahr-Marker: Rotes Kreuz — Heute gesperrt */
function createDangerIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="peak-marker danger"><span>✕</span></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Debounce-Funktion — verzögert Aufrufe um die angegebene Zeit */
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/** Aktuelle Saison ermitteln (Jahreszahl als String) */
function getCurrentSeason() {
  return new Date().getFullYear().toString();
}

/** Datum als lesbaren deutschen String formatieren */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Aktuellen Benutzer holen
// ---------------------------------------------------------------------------

/** Eingeloggten Benutzer aus Supabase Auth auslesen */
async function getCurrentUserId() {
  try {
    const { data: { user } } = await GK.supabase.auth.getUser();
    return user ? user.id : null;
  } catch (err) {
    console.error('Fehler beim Abrufen des Benutzers:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Marker-Schicht
// ---------------------------------------------------------------------------
let markerLayer = null;

/**
 * Richtiges Icon für einen Gipfel bestimmen.
 * Berücksichtigt Sicherheit, Besitz und persönliche Besteigung.
 */
function getMarkerIcon(peak, ownership, userSummited, isSafe, isAttacked) {
  // Unsicher → Gefahr-Marker
  if (!isSafe) {
    return createDangerIcon();
  }

  const userId = GK.map._currentUserId;

  // Benutzer ist aktueller König — Krone wird angegriffen?
  if (ownership && ownership.user_id === userId) {
    if (isAttacked) {
      return createAttackedIcon();
    }
    return createKingIcon();
  }

  // Benutzer hat den Gipfel schon bestiegen (aber ist nicht König) → GRÜN
  if (userSummited) {
    return createSummitedIcon();
  }

  // Noch nie bestiegen
  return createNormalIcon();
}

/**
 * Popup-HTML für einen Gipfel erzeugen.
 */
function buildPopupContent(peak, king, summitCount, isSafe) {
  let kingLine = '';
  if (king && king.user_id) {
    const kingName = GK.map._ownerNames && GK.map._ownerNames[king.user_id];
    if (kingName) {
      const label = king._fromLastYear ? ' (' + king.season + ')' : '';
      kingLine = `<div style="font-size: 0.82rem; margin-top: 3px; color: #d4a24c;">👑 ${kingName} ${king.count}×${label}</div>`;
    }
  }

  return `
    <div class="peak-popup" style="min-width: 160px; text-align: center;">
      <strong style="font-family: 'Playfair Display', serif; font-size: 1rem;">
        ${peak.name}
      </strong>
      <div style="font-size: 0.85rem; margin: 2px 0;">${peak.elevation} m</div>
      ${kingLine}
    </div>
  `;
}

/**
 * Gipfel-Info im fixierten Panel anzeigen — kompakte Badge-Pills pro Saison.
 */
async function openPeakPanel(peakId) {
  const content = document.getElementById('peak-info-content');
  if (!content) return;

  const peak = GK.map.peaks.get(peakId) || await GK.api.getPeakById(peakId);
  if (!peak) return;

  // Beschreibung nachladen falls nicht im Cache
  if (!peak.description) {
    try {
      const { data } = await GK.supabase.from('peaks').select('description').eq('id', peakId).single();
      if (data && data.description) peak.description = data.description;
    } catch (e) { /* ignorieren */ }
  }

  content.innerHTML = '<p class="text-muted" style="font-size:0.8rem;">Lade...</p>';

  try {
    const { data: summits, error } = await GK.supabase
      .from('summits')
      .select('user_id, season, summited_at, points, is_season_first')
      .eq('peak_id', peakId)
      .order('summited_at', { ascending: false });

    const safetyHtml = peak.is_active !== false
      ? '<span style="color: var(--color-safe);">● Sicher</span>'
      : '<span style="color: var(--color-danger);">● Gesperrt</span>';

    if (error || !summits || summits.length === 0) {
      // Leerer Gipfel — Trophy-Slots alle leer
      const desc = peak.description || '';
      content.innerHTML = `
        <div class="peak-top-meta">${safetyHtml}</div>
        <div class="trophy-grid">
          <div class="trophy-slot"><span class="trophy-emoji">👑</span><span class="trophy-label">König</span></div>
          <div class="trophy-slot"><span class="trophy-emoji">⭐</span><span class="trophy-label">Pionier</span></div>
          <div class="trophy-slot trophy-extra"><span class="trophy-emoji">🌅</span><span class="trophy-label">Früh</span></div>
          <div class="trophy-slot trophy-extra"><span class="trophy-emoji">💎</span><span class="trophy-label">Selten</span></div>
        </div>
        <div class="peak-history">Noch nie bestiegen — sei der Erste!</div>
        <div class="peak-bottom-name">${peak.name}${peak.elevation ? ' <span class="peak-elev">' + peak.elevation + ' m</span>' : ''}</div>
        ${desc ? '<div class="peak-description">' + desc + '</div>' : ''}`;
      return;
    }

    // User-Daten laden
    const userIds = [...new Set(summits.map(s => s.user_id))];
    const userProfiles = {};
    for (const uid of userIds) {
      const profil = await GK.api.getUserProfile(uid);
      userProfiles[uid] = profil || { username: 'Anonym', display_name: 'Anonym' };
    }
    const userName = (uid) => {
      const u = userProfiles[uid];
      const name = u ? (u.display_name || u.username) : 'Anonym';
      return name.split(' ')[0]; // Nur Vorname
    };

    // Nach Saison gruppieren
    const seasons = {};
    for (const s of summits) {
      if (!seasons[s.season]) seasons[s.season] = [];
      seasons[s.season].push(s);
    }
    const sortedSeasons = Object.keys(seasons).sort((a, b) => b - a);
    const focusSeason = sortedSeasons[0];
    const focusEntries = seasons[focusSeason];

    // Trophy-Daten für Fokus-Saison ermitteln
    const countByUser = {};
    for (const e of focusEntries) {
      countByUser[e.user_id] = (countByUser[e.user_id] || 0) + 1;
    }
    const kingEntry = Object.entries(countByUser).sort((a, b) => b[1] - a[1])[0];
    const pioneer = focusEntries.find(e => e.is_season_first);
    const earlyBird = focusEntries.find(e => new Date(e.summited_at).getHours() < 7);
    const nightOwl = focusEntries.find(e => new Date(e.summited_at).getHours() >= 20);
    const isRare = summits.length < 5;

    // 4. Slot: Nachtwanderer wenn vorhanden, sonst Selten
    const slot4 = nightOwl
      ? { emoji: '🦉', label: 'Nacht', earned: true, user: userName(nightOwl.user_id), detail: '' }
      : { emoji: '💎', label: 'Selten', earned: isRare, user: isRare ? '✓' : '—', detail: '' };

    const trophies = [
      { emoji: '👑', label: 'König ' + focusSeason, earned: !!kingEntry, user: kingEntry ? userName(kingEntry[0]) : '—', detail: kingEntry ? kingEntry[1] + '×' : '', extra: false },
      { emoji: '⭐', label: 'Pionier', earned: !!pioneer, user: pioneer ? userName(pioneer.user_id) : '—', detail: '', extra: false },
      { emoji: '🌅', label: 'Früh', earned: !!earlyBird, user: earlyBird ? userName(earlyBird.user_id) : '—', detail: '', extra: true },
      Object.assign(slot4, { extra: true }),
    ];

    const trophyHtml = trophies.map(t => `
      <div class="trophy-slot${t.earned ? ' earned' : ''}${t.extra ? ' trophy-extra' : ''}">
        <span class="trophy-emoji">${t.emoji}</span>
        <span class="trophy-label">${t.label}</span>
        ${t.earned && t.user !== '✓' && t.user !== '—' ? '<span class="trophy-user">' + t.user + (t.detail ? ' ' + t.detail : '') + '</span>' : ''}
      </div>`).join('');

    // Vergangene Jahre als kompakte Zeile
    const pastSeasons = sortedSeasons.slice(1, 4);
    let historyHtml = '';
    if (pastSeasons.length > 0) {
      const parts = pastSeasons.map(s => {
        const entries = seasons[s];
        const cbu = {};
        for (const e of entries) cbu[e.user_id] = (cbu[e.user_id] || 0) + 1;
        const top = Object.entries(cbu).sort((a, b) => b[1] - a[1])[0];
        return `${s}: 👑 ${userName(top[0])} ${top[1]}×`;
      });
      historyHtml = parts.join('  ·  ');
    }

    const desc = peak.description || '';
    const totalSummits = summits.length;
    const uniqueUsers = [...new Set(summits.map(s => s.user_id))].length;
    const lastSummit = summits[0];
    const lastDate = new Date(lastSummit.summited_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const lastUser = userName(lastSummit.user_id);

    content.innerHTML = `
      <div class="peak-top-meta">${safetyHtml} · ${totalSummits} Besteigungen · ${uniqueUsers} Bergfreunde</div>
      <div class="trophy-grid">${trophyHtml}</div>
      ${historyHtml ? '<div class="peak-history">' + historyHtml + '</div>' : ''}
      <div class="peak-bottom-name">${peak.name}${peak.elevation ? ' <span class="peak-elev">' + peak.elevation + ' m</span>' : ''}</div>
      ${desc ? '<div class="peak-description">' + desc + '</div>' : '<div class="peak-description">Letzte Besteigung: ' + lastDate + ' von ' + lastUser + '</div>'}
    `;

  } catch (err) {
    console.error('Fehler beim Laden der Gipfel-Details:', err);
    content.innerHTML = '<p class="text-muted">Fehler beim Laden.</p>';
  }
}

// openPeakPanel global verfügbar machen (für Gipfel des Tages Klick aus auth.js)
window.openPeakPanel = openPeakPanel;

/**
 * Nächsten Gipfel zur Kartenmitte finden und im Panel anzeigen.
 */
function showNearestPeakInPanel() {
  if (!GK.map.leaflet || GK.map.peaks.size === 0) return;
  const center = GK.map.leaflet.getCenter();
  let nearest = null;
  let minDist = Infinity;
  for (const [id, peak] of GK.map.peaks) {
    const dist = Math.pow(peak.lat - center.lat, 2) + Math.pow(peak.lng - center.lng, 2);
    if (dist < minDist) {
      minDist = dist;
      nearest = peak;
    }
  }
  if (nearest) {
    openPeakPanel(nearest.id);
  }
}

// ---------------------------------------------------------------------------
// Gipfel laden und Marker setzen
// ---------------------------------------------------------------------------

/**
 * Gipfel innerhalb der aktuellen Kartengrenzen laden,
 * Besitz und Sicherheit prüfen und Marker erzeugen.
 */
let _loadPeaksRunning = false;
async function loadPeaks() {
  if (!GK.map.leaflet) return;
  if (_loadPeaksRunning) return;
  _loadPeaksRunning = true;

  try {
    const bounds = GK.map.leaflet.getBounds();
    const boundsObj = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    };

    // Gipfel laden — max 100
    let peaks = await GK.api.getPeaks(boundsObj);
    if (!peaks || peaks.length === 0) return;
    if (peaks.length > 100) peaks = peaks.slice(0, 100);

    // Bestehende Marker entfernen
    if (markerLayer) markerLayer.clearLayers();

    // Cache + Marker SOFORT anzeigen — kein await mehr nach diesem Punkt
    for (const peak of peaks) {
      GK.map.peaks.set(peak.id, peak);
      const icon = getMarkerIcon(peak, null, false, true);
      const marker = L.marker([peak.lat, peak.lng], { icon });
      marker.bindPopup(buildPopupContent(peak, null, 0, true), {
        maxWidth: 220, closeButton: false,
      });
      marker.on('click', function () { openPeakPanel(peak.id); });
      marker.peakData = peak;
      markerLayer.addLayer(marker);
    }

    // Kronen KOMPLETT ASYNC nachladen — blockiert NICHTS
    loadCrownsAsync(peaks);
  } finally {
    _loadPeaksRunning = false;
  }
}

/** Kronen im Hintergrund laden — blockiert weder UI noch loadPeaks */
function loadCrownsAsync() {
  const userId = GK.map._currentUserId;
  if (!userId || !markerLayer) return;
  const season = getCurrentSeason();
  const lastSeason = (parseInt(season) - 1).toString();

  // Fire-and-forget — kein await, kein Freeze
  GK.supabase.from('summits').select('peak_id, season')
    .eq('user_id', userId).in('season', [season, lastSeason])
    .then(({ data }) => {
      if (!data || data.length === 0) return;
      const userSummitedPeaks = new Set(data.map(s => s.peak_id));
      const visiblePeakIds = [];
      markerLayer.eachLayer(m => { if (m.peakData) visiblePeakIds.push(m.peakData.id); });
      const userPeakIds = [...userSummitedPeaks].filter(id => visiblePeakIds.includes(id));
      if (userPeakIds.length === 0) {
        // User hat Gipfel bestiegen aber keine davon sichtbar — trotzdem Marker updaten
        markerLayer.eachLayer(m => {
          if (m.peakData && userSummitedPeaks.has(m.peakData.id)) {
            m.setIcon(getMarkerIcon(m.peakData, null, true, true));
          }
        });
        return;
      }

      return GK.supabase.from('summits').select('peak_id, user_id, season')
        .in('peak_id', userPeakIds).in('season', [season, lastSeason])
        .then(({ data: allSummits }) => {
          const userIsKing = new Set();
          if (allSummits) {
            const bySeason = {};
            for (const s of allSummits) {
              if (!bySeason[s.peak_id]) bySeason[s.peak_id] = {};
              if (!bySeason[s.peak_id][s.season]) bySeason[s.peak_id][s.season] = {};
              bySeason[s.peak_id][s.season][s.user_id] = (bySeason[s.peak_id][s.season][s.user_id] || 0) + 1;
            }
            for (const [pid, seasons] of Object.entries(bySeason)) {
              const d = seasons[season] || seasons[lastSeason];
              if (d) {
                const top = Object.entries(d).sort((a, b) => b[1] - a[1])[0];
                if (top && top[0] === userId) userIsKing.add(parseInt(pid));
              }
            }
          }
          // Marker updaten
          markerLayer.eachLayer(m => {
            if (!m.peakData) return;
            const pid = m.peakData.id;
            const summited = userSummitedPeaks.has(pid);
            const isKing = userIsKing.has(pid);
            if (summited || isKing) {
              const king = isKing ? { user_id: userId } : null;
              m.setIcon(getMarkerIcon(m.peakData, king, summited, true));
            }
          });
        });
    })
    .catch(() => { /* ignorieren */ });
}

// ---------------------------------------------------------------------------
// Gebiets-Polygone (Hexagonal Territory Grid)
// ---------------------------------------------------------------------------
let territoryLayer = null;

/**
 * Hex-Grid-Konfiguration (flat-top, perfekte Tessellation):
 * Circumradius s = 9km → Hex-Durchmesser 18km.
 * Bei 47°N: 1° lat ≈ 111.32km, 1° lng ≈ 75.9km.
 *
 * Flat-top Hex mit Circumradius s:
 *   Width  = 2 * s
 *   Height = sqrt(3) * s
 *   Col-Spacing = 1.5 * s   (horizontal center-to-center)
 *   Row-Spacing = sqrt(3) * s (vertical center-to-center)
 *   Odd columns offset by sqrt(3)/2 * s vertically
 */
const HEX_SIZE_KM = 9;                        // Circumradius in km (18km Durchmesser)
const LAT_KM = 111.32;                        // km pro Grad Latitude
const LNG_KM = 75.9;                          // km pro Grad Longitude bei 47°N
const S_LAT = HEX_SIZE_KM / LAT_KM;           // Circumradius in Grad Latitude  ≈ 0.0808
const S_LNG = HEX_SIZE_KM / LNG_KM;           // Circumradius in Grad Longitude ≈ 0.1186

/**
 * Spielerfarbe aus User-ID generieren (deterministisch).
 * Erzeugt eine helle, satte Farbe als HSL-Wert.
 */
function getTerritoryColor(userId) {
  if (!userId) return '#888888';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash = hash & hash; // 32-bit int
  }
  // Hue 0–360, Saturation 60–80%, Lightness 55–70%
  const hue = Math.abs(hash) % 360;
  const sat = 60 + (Math.abs(hash >> 8) % 20);
  const lit = 55 + (Math.abs(hash >> 16) % 15);
  return 'hsl(' + hue + ', ' + sat + '%, ' + lit + '%)';
}

/**
 * Hex-Zelle für eine gegebene Koordinate berechnen (flat-top Hex-Grid).
 * Gibt { col, row, centerLat, centerLng } zurück.
 *
 * Flat-top Spacing:
 *   colSpacing = 1.5 * s  (horizontal)
 *   rowSpacing = sqrt(3) * s (vertical)
 *   Ungerade Spalten um rowSpacing/2 nach oben versetzt.
 */
function getHexCell(lat, lng) {
  const colSpacing = 1.5 * S_LNG;
  const rowSpacing = Math.sqrt(3) * S_LAT;

  const col = Math.round(lng / colSpacing);
  const rowOffset = (col % 2 !== 0) ? rowSpacing / 2 : 0;
  const row = Math.round((lat - rowOffset) / rowSpacing);

  const centerLng = col * colSpacing;
  const centerLat = row * rowSpacing + rowOffset;
  return { col, row, centerLat, centerLng };
}

/**
 * Hex-Schlüssel für Gruppierung (eindeutig pro Hex-Zelle).
 */
function getHexKey(col, row) {
  return col + ',' + row;
}

/**
 * 6 Eckpunkte eines flat-top Hexagons als [lat, lng]-Array.
 * Winkel: 0°, 60°, 120°, 180°, 240°, 300° (flat-top Orientierung).
 * Verwendet den vollen Circumradius s für jede Achse,
 * sodass alle Hexagone identisch groß sind und lückenlos kacheln.
 */
function getHexPolygon(centerLat, centerLng) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i;
    const angleRad = angleDeg * Math.PI / 180;
    const vLng = centerLng + S_LNG * Math.cos(angleRad);
    const vLat = centerLat + S_LAT * Math.sin(angleRad);
    points.push([vLat, vLng]);
  }
  return points;
}

/**
 * Hex-Territorien laden und auf der Karte anzeigen.
 * Lädt alle Gipfel-Besteigungen der aktuellen (+ letzten) Saison,
 * gruppiert sie in Hex-Zellen und zeichnet für jede Zelle mit Gipfeln
 * ein farbiges Hexagon, eingefärbt nach dem Spieler mit den meisten
 * einzigartigen Gipfeln in dieser Zelle (= König der Hex-Zelle).
 */
async function loadTerritories() {
  if (!GK.map.leaflet) return;

  if (!territoryLayer) {
    territoryLayer = L.layerGroup();
    if (GK.map._hexVisible !== false) {
      territoryLayer.addTo(GK.map.leaflet);
    }
  }
  territoryLayer.clearLayers();

  const season = getCurrentSeason();
  const lastSeason = (parseInt(season) - 1).toString();

  try {
    // Sichtbare Kartengrenzen mit etwas Puffer
    const bounds = GK.map.leaflet.getBounds();
    const pad = 0.3; // ~30km Puffer
    const latMin = bounds.getSouth() - pad;
    const latMax = bounds.getNorth() + pad;
    const lngMin = bounds.getWest() - pad;
    const lngMax = bounds.getEast() + pad;

    // Alle Gipfel im sichtbaren Bereich laden
    const { data: peaks } = await GK.supabase
      .from('peaks')
      .select('id, lat, lng')
      .gte('lat', latMin)
      .lte('lat', latMax)
      .gte('lng', lngMin)
      .lte('lng', lngMax);

    if (!peaks || peaks.length === 0) return;

    const peakIds = peaks.map(p => p.id);

    // Gipfel → Hex-Zelle zuordnen
    const peakHexMap = {}; // peakId → hexKey
    const hexCenters = {}; // hexKey → { centerLat, centerLng, col, row }
    for (const p of peaks) {
      const hex = getHexCell(p.lat, p.lng);
      const key = getHexKey(hex.col, hex.row);
      peakHexMap[p.id] = key;
      if (!hexCenters[key]) {
        hexCenters[key] = { centerLat: hex.centerLat, centerLng: hex.centerLng, col: hex.col, row: hex.row };
      }
    }

    // Alle Besteigungen dieser Gipfel in aktueller + letzter Saison laden
    // Supabase .in() hat ein Limit, daher in Batches aufteilen
    let allSummits = [];
    const batchSize = 200;
    for (let i = 0; i < peakIds.length; i += batchSize) {
      const batch = peakIds.slice(i, i + batchSize);
      const { data: summits } = await GK.supabase
        .from('summits')
        .select('peak_id, user_id, season')
        .in('peak_id', batch)
        .in('season', [season, lastSeason]);
      if (summits) allSummits = allSummits.concat(summits);
    }

    if (allSummits.length === 0) return;

    // Pro Hex-Zelle: einzigartige Gipfel pro User zählen (aktuelle Saison bevorzugt)
    // hexKey → { userId → Set(peakId) }
    const hexUserPeaks = {};
    // Erst aktuelle Saison, dann letzte Saison als Fallback
    const currentSeasonSummits = allSummits.filter(s => s.season === season);
    const lastSeasonSummits = allSummits.filter(s => s.season === lastSeason);

    // Aktuelle Saison eintragen
    for (const s of currentSeasonSummits) {
      const hexKey = peakHexMap[s.peak_id];
      if (!hexKey) continue;
      if (!hexUserPeaks[hexKey]) hexUserPeaks[hexKey] = {};
      if (!hexUserPeaks[hexKey][s.user_id]) hexUserPeaks[hexKey][s.user_id] = new Set();
      hexUserPeaks[hexKey][s.user_id].add(s.peak_id);
    }

    // Letzte Saison nur für Hex-Zellen ohne aktuelle Daten (Fallback)
    for (const s of lastSeasonSummits) {
      const hexKey = peakHexMap[s.peak_id];
      if (!hexKey) continue;
      // Nur eintragen wenn diese Hex-Zelle noch keine Daten hat
      if (hexUserPeaks[hexKey] && Object.keys(hexUserPeaks[hexKey]).length > 0) continue;
      if (!hexUserPeaks[hexKey]) hexUserPeaks[hexKey] = {};
      if (!hexUserPeaks[hexKey][s.user_id]) hexUserPeaks[hexKey][s.user_id] = new Set();
      hexUserPeaks[hexKey][s.user_id].add(s.peak_id);
    }

    // Für jede Hex-Zelle den König ermitteln und User-IDs sammeln
    const hexKings = {}; // hexKey → { userId, count }
    const allUserIds = new Set();
    for (const [hexKey, userPeaks] of Object.entries(hexUserPeaks)) {
      let topUser = null;
      let topCount = 0;
      for (const [uid, peakSet] of Object.entries(userPeaks)) {
        allUserIds.add(uid);
        if (peakSet.size > topCount) {
          topCount = peakSet.size;
          topUser = uid;
        }
      }
      if (topUser && topCount > 0) {
        hexKings[hexKey] = { userId: topUser, count: topCount };
      }
    }

    if (Object.keys(hexKings).length === 0) return;

    // User-Profile für Tooltip-Namen laden
    const userNames = {};
    for (const uid of allUserIds) {
      try {
        const profil = await GK.api.getUserProfile(uid);
        if (profil) {
          const name = profil.display_name || profil.username || 'Anonym';
          userNames[uid] = name.split(' ')[0]; // Nur Vorname
        } else {
          userNames[uid] = 'Anonym';
        }
      } catch (e) {
        userNames[uid] = 'Anonym';
      }
    }

    // Hex-Polygone zeichnen
    for (const [hexKey, king] of Object.entries(hexKings)) {
      const center = hexCenters[hexKey];
      if (!center) continue;

      const color = getTerritoryColor(king.userId);
      const corners = getHexPolygon(center.centerLat, center.centerLng);
      const kingName = userNames[king.userId] || 'Anonym';

      const polygon = L.polygon(corners, {
        color: color,
        weight: 2,
        opacity: 0.4,
        fillColor: color,
        fillOpacity: 0.2,
        interactive: true,
        className: 'hex-territory',
      });

      // Tooltip beim Hover
      polygon.bindTooltip(
        '\ud83d\udc51 ' + kingName + ' \u00b7 ' + king.count + ' Gipfel',
        {
          sticky: true,
          direction: 'center',
          className: 'territory-tooltip',
        }
      );

      territoryLayer.addLayer(polygon);
    }

  } catch (err) {
    console.error('Fehler beim Laden der Territorien:', err);
  }
}

/** Debounced-Version von loadPeaks */
const loadPeaksDebounced = debounce(loadPeaks, DEBOUNCE_DELAY);

/** Debounced-Version von loadTerritories (länger, da schwerer) */
const loadTerritoriesDebounced = debounce(loadTerritories, 1500);

// ---------------------------------------------------------------------------
// Karte initialisieren
// ---------------------------------------------------------------------------

/**
 * Leaflet-Karte im #map-Element erstellen und konfigurieren.
 * Versucht den Standort des Benutzers zu ermitteln.
 */
async function initMap() {
  // Karte erstellen
  const map = L.map('map', { attributionControl: false }).setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM);

  // Attribution — klein und dezent unten rechts
  L.control.attribution({ position: 'bottomright', prefix: false })
    .addAttribution('© <a href="https://openstreetmap.org">OSM</a> · <a href="https://opentopomap.org">OpenTopoMap</a>')
    .addTo(map);

  // Karten-Layer definieren
  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
  });

  const satellitLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
  });

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  });

  // Standard-Layer setzen
  topoLayer.addTo(map);

  // Layer-Switcher oben rechts
  const layerControl = L.control.layers({
    'Topo': topoLayer,
    'Satellit': satellitLayer,
    'Straße': osmLayer,
  }, null, { position: 'topright', collapsed: true }).addTo(map);

  // Marker-Schicht erstellen
  markerLayer = L.layerGroup().addTo(map);

  // Karte öffentlich verfügbar machen
  GK.map.leaflet = map;

  // Aktuellen Benutzer laden
  GK.map._currentUserId = await getCurrentUserId();

  // Orts-Suche einrichten
  initSearchControl(map);

  // Benutzer-Standort ermitteln — Strava-Stadt bevorzugen, Browser-GPS als Fallback
  let homeLocation = null;

  // Versuche Strava-Standort aus Profil zu laden
  try {
    const userId = GK.map._currentUserId;
    if (userId) {
      const profil = await GK.api.getUserProfile(userId);
      if (profil && profil.home_region) {
        // Strava-Stadt geocodieren wenn vorhanden
        const city = profil.display_name ? null : null; // Platzhalter
      }
    }
  } catch (e) { /* ignorieren */ }

  // Kleinwalsertal als Fallback wenn kein Standort
  if (!homeLocation) {
    homeLocation = MAP_DEFAULT_CENTER;
  }

  // Home-Button auf der Karte
  const homeBtn = L.control({ position: 'topleft' });
  homeBtn.onAdd = function () {
    const div = L.DomUtil.create('div', 'leaflet-bar');
    div.innerHTML = '<a href="#" title="Zum Heimatort" style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:var(--color-bg-card,#2d2a26);color:#c9a84c;font-size:18px;text-decoration:none;border-radius:4px;">🏠</a>';
    div.querySelector('a').addEventListener('click', function (e) {
      e.preventDefault();
      map.setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM);
    });
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  homeBtn.addTo(map);

  // Hex-Territory-Toggle-Button
  const hexToggle = L.control({ position: 'topleft' });
  hexToggle.onAdd = function () {
    const div = L.DomUtil.create('div', 'leaflet-bar');
    const savedState = localStorage.getItem('gk_hex_visible');
    const hexVisible = savedState === null ? true : savedState === 'true';
    GK.map._hexVisible = hexVisible;
    div.innerHTML = '<a href="#" title="Gebiete ein/aus" id="hex-toggle-btn" style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:var(--color-bg-card,#2d2a26);color:' + (hexVisible ? '#c9a84c' : '#666') + ';font-size:18px;text-decoration:none;border-radius:4px;">⬡</a>';
    div.querySelector('a').addEventListener('click', function (e) {
      e.preventDefault();
      GK.map._hexVisible = !GK.map._hexVisible;
      localStorage.setItem('gk_hex_visible', GK.map._hexVisible);
      this.style.color = GK.map._hexVisible ? '#c9a84c' : '#666';
      if (territoryLayer) {
        if (GK.map._hexVisible) {
          if (!map.hasLayer(territoryLayer)) map.addLayer(territoryLayer);
        } else {
          if (map.hasLayer(territoryLayer)) map.removeLayer(territoryLayer);
        }
      }
    });
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  hexToggle.addTo(map);

  // Browser-GPS als Standort-Bestimmung (nur wenn nicht vom Server)
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        // Nur zentrieren wenn Standort plausibel alpin ist (lat 45-48, lng 5-16)
        if (latitude > 45 && latitude < 48.5 && longitude > 5 && longitude < 17) {
          map.setView([latitude, longitude], MAP_DEFAULT_ZOOM);
          console.log('Standort erkannt (alpin):', latitude, longitude);
        } else {
          console.log('Standort nicht alpin (' + latitude.toFixed(2) + ', ' + longitude.toFixed(2) + '), zeige Kleinwalsertal');
          map.setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM);
        }
      },
      (err) => {
        console.warn('Standort nicht ermittelt, zeige Kleinwalsertal');
        map.setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM);
      },
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }

  // Gipfel laden — nicht blockierend, Panel danach füllen
  loadPeaks().then(() => {
    showNearestPeakInPanel();
    if (typeof showPeakOfDay === 'function') showPeakOfDay();
    // Gebiets-Polygone laden (async, blockiert nichts)
    loadTerritories();
  });

  // Bei Kartenverschiebung und Zoom Gipfel + Territorien neu laden (mit Debounce)
  map.on('moveend', loadPeaksDebounced);
  map.on('zoomend', loadPeaksDebounced);
  map.on('moveend', loadTerritoriesDebounced);
  map.on('zoomend', loadTerritoriesDebounced);

  // Gipfel des Tages bei Kartenverschiebung aktualisieren (debounced 2s)
  let potdTimer;
  map.on('moveend', () => {
    clearTimeout(potdTimer);
    potdTimer = setTimeout(() => {
      if (typeof showPeakOfDay === 'function') showPeakOfDay();
    }, 2000);
  });

  console.log('Karte initialisiert.');
}

// ---------------------------------------------------------------------------
// Orts-Suche (Nominatim/OpenStreetMap Geocoding)
// ---------------------------------------------------------------------------

/** Suchfeld oben auf der Karte für Ort/Gipfel-Eingabe */
function initSearchControl(map) {
  const searchContainer = document.createElement('div');
  searchContainer.className = 'map-search-container';
  searchContainer.innerHTML = `
    <input type="text" id="map-search-input" class="map-search-input"
      placeholder="Ort oder Gipfel suchen..." autocomplete="off">
    <div id="map-search-results" class="map-search-results" style="display: none;"></div>
  `;
  document.getElementById('map').appendChild(searchContainer);

  const input = document.getElementById('map-search-input');
  const results = document.getElementById('map-search-results');
  let searchTimeout = null;

  input.addEventListener('input', function () {
    clearTimeout(searchTimeout);
    const query = input.value.trim();
    if (query.length < 3) {
      results.style.display = 'none';
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&q='
          + encodeURIComponent(query)
          + '&limit=5&viewbox=9.5,46.5,11.0,47.8&bounded=0';
        const res = await fetch(url, {
          headers: { 'Accept-Language': 'de' }
        });
        const data = await res.json();

        if (data.length === 0) {
          results.innerHTML = '<div class="map-search-item">Nichts gefunden</div>';
          results.style.display = 'block';
          return;
        }

        results.innerHTML = data.map(function (item) {
          return '<div class="map-search-item" data-lat="' + item.lat + '" data-lng="' + item.lon + '">'
            + item.display_name.split(',').slice(0, 2).join(', ')
            + '</div>';
        }).join('');
        results.style.display = 'block';

        // Klick auf Ergebnis
        results.querySelectorAll('.map-search-item').forEach(function (el) {
          el.addEventListener('click', function () {
            const lat = parseFloat(el.getAttribute('data-lat'));
            const lng = parseFloat(el.getAttribute('data-lng'));
            if (lat && lng) {
              map.setView([lat, lng], 14);
            }
            results.style.display = 'none';
            input.value = el.textContent;
          });
        });
      } catch (err) {
        console.error('Suchfehler:', err);
      }
    }, 400);
  });

  // Ergebnisse schließen bei Klick außerhalb
  document.addEventListener('click', function (e) {
    if (!searchContainer.contains(e.target)) {
      results.style.display = 'none';
    }
  });
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/** Karte initialisieren */
GK.map.init = initMap;

/** Gipfel manuell neu laden (z. B. nach Check-in) */
GK.map.refreshMarkers = loadPeaks;

/** Marker-Layer für externen Zugriff */
GK.map.getMarkerLayer = function () {
  return markerLayer;
};

// ---------------------------------------------------------------------------
// Automatisch starten wenn DOM bereit ist
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const mapEl = document.getElementById('map');
  if (mapEl) {
    initMap();
  }
});
