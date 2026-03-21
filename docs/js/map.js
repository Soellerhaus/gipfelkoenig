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

  // Kompaktes Popup — nur Name, Höhe, Sicherheit
  return `
    <div class="peak-popup" style="min-width: 140px; text-align: center;">
      <strong style="font-family: 'Playfair Display', serif; font-size: 1rem;">
        ${peak.name}
      </strong>
      <div style="font-size: 0.85rem; margin: 2px 0;">${peak.elevation} m · ${safetyDot}</div>
    </div>
  `;
}

/**
 * Historische Daten für ein Gipfel-Popup nachladen.
 * Zeigt Besteigungen pro Saison und wer am meisten war.
 */
/**
 * Detail-Infos zum angeklickten Gipfel im "In deiner Nähe" Bereich anzeigen.
 */
async function loadPeakDetails(peakId) {
  const container = document.getElementById('nearby-peaks');
  if (!container) return;

  // Peak-Daten holen
  const peak = GK.map.peaks.get(peakId) || await GK.api.getPeakById(peakId);
  if (!peak) return;

  container.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Lade Details...</p>';

  try {
    // Alle Besteigungen dieses Gipfels laden
    const { data: summits, error } = await GK.supabase
      .from('summits')
      .select('user_id, season, summited_at, points')
      .eq('peak_id', peakId)
      .order('summited_at', { ascending: false });

    // Header
    let html = `
      <div style="margin-bottom: 0.75rem;">
        <h2 style="font-family: var(--font-display); margin: 0; font-size: 1.4rem;">${peak.name}</h2>
        <div style="color: var(--color-muted); font-size: 0.85rem;">${peak.elevation} m · ${peak.osm_region || 'Alpen'}</div>
      </div>
    `;

    if (error || !summits || summits.length === 0) {
      html += '<p class="text-muted" style="font-size: 0.85rem;">Noch nie bestiegen. Sei der Erste!</p>';
      html += '<button class="popup-checkin-btn" onclick="GK.summits.checkin()" style="margin-top: 0.5rem;">⛰️ Jetzt einchecken</button>';
      container.innerHTML = html;
      return;
    }

    // Gesamt-Punkte auf diesem Gipfel
    const totalPoints = summits.reduce((sum, s) => sum + (s.points || 0), 0);

    // Letzte Besteigung
    const lastSummit = summits[0];
    const lastDate = new Date(lastSummit.summited_at).toLocaleDateString('de-AT', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const lastTime = new Date(lastSummit.summited_at).toLocaleTimeString('de-AT', {
      hour: '2-digit', minute: '2-digit'
    });

    // User-Namen laden
    const userIds = [...new Set(summits.map(s => s.user_id))];
    const userNames = {};
    for (const uid of userIds) {
      const profil = await GK.api.getUserProfile(uid);
      userNames[uid] = profil ? (profil.username || 'Anonym') : 'Anonym';
    }

    // Statistik-Zeile
    html += `
      <div style="display: flex; gap: 1rem; margin-bottom: 0.75rem; font-size: 0.85rem;">
        <div><strong style="color: var(--color-gold);">${summits.length}</strong> Besteigungen</div>
        <div><strong style="color: var(--color-gold);">${totalPoints.toLocaleString('de')}</strong> Punkte gesamt</div>
      </div>
      <div style="font-size: 0.85rem; margin-bottom: 0.75rem; color: var(--color-muted);">
        Letzte Besteigung: ${lastDate} um ${lastTime} Uhr von <strong style="color: var(--color-text);">${userNames[lastSummit.user_id]}</strong>
      </div>
    `;

    // Nach Saison gruppieren
    const seasons = {};
    for (const s of summits) {
      if (!seasons[s.season]) seasons[s.season] = [];
      seasons[s.season].push(s);
    }

    // Bergkönig pro Saison
    html += '<div style="margin-bottom: 0.5rem;"><strong style="font-size: 0.9rem;">Bergkönig pro Saison</strong></div>';
    const sortedSeasons = Object.keys(seasons).sort((a, b) => b - a);

    for (const season of sortedSeasons) {
      const entries = seasons[season];
      const countByUser = {};
      for (const e of entries) {
        countByUser[e.user_id] = (countByUser[e.user_id] || 0) + 1;
      }
      const topUserId = Object.entries(countByUser).sort((a, b) => b[1] - a[1])[0][0];
      const topCount = countByUser[topUserId];
      const topName = userNames[topUserId];
      const seasonPoints = entries.reduce((sum, e) => sum + (e.points || 0), 0);

      html += `
        <div class="card" style="padding: 0.5rem 0.75rem; margin-bottom: 0.4rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: var(--color-gold);">${season}</strong>
              <span style="font-size: 0.8rem; color: var(--color-muted);"> · ${entries.length}x bestiegen</span>
            </div>
            <span style="font-size: 0.8rem; color: var(--color-gold);">${seasonPoints.toLocaleString('de')} Pkt</span>
          </div>
          <div style="font-size: 0.85rem;">👑 ${topName} <span style="color: var(--color-muted);">(${topCount}x)</span></div>
        </div>
      `;
    }

    // Einchecken Button
    html += '<button class="popup-checkin-btn" onclick="GK.summits.checkin()" style="margin-top: 0.5rem;">⛰️ Jetzt einchecken</button>';

    container.innerHTML = html;
  } catch (err) {
    console.error('Fehler beim Laden der Gipfel-Details:', err);
    container.innerHTML = '<p class="text-muted">Fehler beim Laden der Details.</p>';
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
    marker.bindPopup(buildPopupContent(peak, ownership, summitCount, isSafe), {
      maxWidth: 280,
    });

    // Beim Klick auf Marker: Details unten im "In deiner Nähe" Bereich laden
    marker.on('popupopen', function () {
      loadPeakDetails(peak.id);
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

  // Benutzer-Standort ermitteln und Karte darauf zentrieren
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        map.setView([latitude, longitude], MAP_DEFAULT_ZOOM);
        console.log('Standort erkannt:', latitude, longitude);
      },
      (err) => {
        console.warn('Standort konnte nicht ermittelt werden:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Gipfel beim ersten Laden anzeigen
  await loadPeaks();

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
