// =============================================================================
// Gipfelkönig — Kartenintegration (map.js)
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
function getMarkerIcon(peak, ownership, userSummited, isSafe) {
  // Unsicher → Gefahr-Marker
  if (!isSafe) {
    return createDangerIcon();
  }

  const userId = GK.map._currentUserId;

  // Benutzer ist aktueller König
  if (ownership && ownership.user_id === userId) {
    return createKingIcon();
  }

  // Benutzer hat den Gipfel schon bestiegen (aber ist nicht König)
  if (userSummited) {
    return createSummitedIcon();
  }

  // Noch nie bestiegen
  return createNormalIcon();
}

/**
 * Popup-HTML für einen Gipfel erzeugen.
 */
function buildPopupContent(peak, ownership, summitCount, isSafe) {
  const safetyDot = isSafe
    ? '<span style="color: #27ae60;">● Sicher</span>'
    : '<span style="color: #e74c3c;">● Gesperrt</span>';

  // König-Info: aktuelles Jahr oder Vorjahr
  let kingLine = '';
  if (ownership && ownership.username) {
    kingLine = `<div style="font-size: 0.75rem; margin-top: 2px;">👑 ${ownership.username}</div>`;
  }

  return `
    <div class="peak-popup" style="min-width: 140px; text-align: center;">
      <strong style="font-family: 'Playfair Display', serif; font-size: 1rem;">
        ${peak.name}
      </strong>
      <div style="font-size: 0.85rem; margin: 2px 0;">${peak.elevation} m · ${safetyDot}</div>
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
      content.innerHTML = `
        <div class="peak-header">
          <h3>${peak.name}</h3>
          <span class="peak-meta">${peak.elevation ? peak.elevation + ' m · ' : ''}${safetyHtml}</span>
        </div>
        <div class="trophy-grid">
          <div class="trophy-slot"><div class="trophy-emoji">👑</div><div class="trophy-label">König</div></div>
          <div class="trophy-slot"><div class="trophy-emoji">⭐</div><div class="trophy-label">Pionier</div></div>
          <div class="trophy-slot"><div class="trophy-emoji">🌅</div><div class="trophy-label">Früh</div></div>
          <div class="trophy-slot"><div class="trophy-emoji">💎</div><div class="trophy-label">Selten</div></div>
        </div>
        <div class="peak-history">Noch nie bestiegen — sei der Erste!</div>`;
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
    const nightOwl = focusEntries.find(e => new Date(e.summited_at).getHours() >= 21);
    const isRare = summits.length < 5;

    // 4. Slot: Nachtwanderer wenn vorhanden, sonst Selten
    const slot4 = nightOwl
      ? { emoji: '🦉', label: 'Nacht', earned: true, user: userName(nightOwl.user_id), detail: '' }
      : { emoji: '💎', label: 'Selten', earned: isRare, user: isRare ? '✓' : '—', detail: '' };

    const trophies = [
      { emoji: '👑', label: 'König', earned: !!kingEntry, user: kingEntry ? userName(kingEntry[0]) : '—', detail: kingEntry ? kingEntry[1] + '×' : '' },
      { emoji: '⭐', label: 'Pionier', earned: !!pioneer, user: pioneer ? userName(pioneer.user_id) : '—', detail: '' },
      { emoji: '🌅', label: 'Früh', earned: !!earlyBird, user: earlyBird ? userName(earlyBird.user_id) : '—', detail: '' },
      slot4,
    ];

    const trophyHtml = trophies.map(t => `
      <div class="trophy-slot${t.earned ? ' earned' : ''}">
        <div class="trophy-emoji">${t.emoji}</div>
        <div class="trophy-label">${t.label}</div>
        ${t.earned && t.user !== '✓' && t.user !== '—' ? '<div class="trophy-user">' + t.user + '</div>' : ''}
        ${t.detail ? '<div class="trophy-detail">' + t.detail + '</div>' : ''}
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

    content.innerHTML = `
      <div class="peak-header">
        <h3>${peak.name}</h3>
        <span class="peak-meta">${peak.elevation ? peak.elevation + ' m · ' : ''}${safetyHtml} · ${focusSeason}</span>
      </div>
      <div class="trophy-grid">${trophyHtml}</div>
      ${historyHtml ? '<div class="peak-history">' + historyHtml + '</div>' : ''}
    `;

  } catch (err) {
    console.error('Fehler beim Laden der Gipfel-Details:', err);
    content.innerHTML = '<p class="text-muted">Fehler beim Laden.</p>';
  }
}

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
async function loadPeaks() {
  if (!GK.map.leaflet) return;

  const bounds = GK.map.leaflet.getBounds();
  const boundsObj = {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };

  // Gipfel vom Backend laden
  const peaks = await GK.api.getPeaks(boundsObj);
  if (!peaks || peaks.length === 0) return;

  const season = getCurrentSeason();
  const today = new Date().toISOString().slice(0, 10);
  const userId = GK.map._currentUserId;

  // Bestehende Marker entfernen
  if (markerLayer) {
    markerLayer.clearLayers();
  }

  // Jeden Gipfel verarbeiten
  for (const peak of peaks) {
    // Gipfel im Cache speichern
    GK.map.peaks.set(peak.id, peak);

    // Besitzrechte laden
    const ownership = await GK.api.getOwnership(peak.id, season);

    // Sicherheitsstatus laden
    const safety = peak.osm_region
      ? await GK.api.getSafetyStatus(peak.osm_region, today)
      : null;
    const isSafe = safety ? safety.danger_level < 3 : true;

    // Prüfen ob der Benutzer diesen Gipfel schon bestiegen hat
    let userSummited = false;
    if (userId) {
      const summits = await GK.api.getSummits(userId, season);
      userSummited = summits.some((s) => s.peak_id === peak.id);
    }

    // Besteigungen dieser Saison zählen
    let summitCount = 0;
    try {
      const { data, error } = await GK.supabase
        .from('summits')
        .select('id', { count: 'exact', head: true })
        .eq('peak_id', peak.id)
        .eq('season', season);

      if (!error && data) {
        summitCount = data.length;
      }
    } catch (err) {
      console.error('Fehler beim Zählen der Besteigungen:', err);
    }

    // Icon bestimmen
    const icon = getMarkerIcon(peak, ownership, userSummited, isSafe);

    // Marker erstellen und zur Schicht hinzufügen
    const marker = L.marker([peak.lat, peak.lng], { icon });
    // Kompaktes Popup auf der Karte
    marker.bindPopup(buildPopupContent(peak, ownership, summitCount, isSafe), {
      maxWidth: 220,
      closeButton: false,
    });

    // Beim Klick: Slide-Up Panel mit Details öffnen
    marker.on('click', function () {
      openPeakPanel(peak.id);
    });

    // Gipfel-Daten am Marker speichern für späteren Zugriff
    marker.peakData = peak;

    markerLayer.addLayer(marker);
  }
}

/** Debounced-Version von loadPeaks */
const loadPeaksDebounced = debounce(loadPeaks, DEBOUNCE_DELAY);

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

  // Gipfel beim ersten Laden anzeigen + nächsten Gipfel im Panel zeigen
  await loadPeaks();
  showNearestPeakInPanel();

  // Bei Kartenverschiebung und Zoom Gipfel neu laden (mit Debounce)
  map.on('moveend', loadPeaksDebounced);
  map.on('zoomend', loadPeaksDebounced);

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
