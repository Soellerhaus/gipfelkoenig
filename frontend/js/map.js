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
    ? '<span style="color: #27ae60;">●</span> Sicher'
    : '<span style="color: #e74c3c;">●</span> Gesperrt';

  // Popup mit Lade-Platzhalter für historische Daten
  return `
    <div class="peak-popup" style="min-width: 220px;">
      <h3 style="font-family: 'Playfair Display', serif; margin: 0 0 4px 0; font-size: 1.1rem;">
        ${peak.name}
      </h3>
      <p style="margin: 2px 0; font-size: 0.9rem;"><strong>${peak.elevation} m</strong> · ${safetyDot}</p>
      <div id="popup-history-${peak.id}" style="margin: 8px 0; font-size: 0.8rem; color: var(--color-muted);">
        Lade Historie...
      </div>
      <button
        class="popup-checkin-btn"
        data-peak-id="${peak.id}"
        data-peak-name="${peak.name}"
      >
        ⛰️ Einchecken
      </button>
    </div>
  `;
}

/**
 * Historische Daten für ein Gipfel-Popup nachladen.
 * Zeigt Besteigungen pro Saison und wer am meisten war.
 */
async function loadPopupHistory(peakId) {
  const container = document.getElementById('popup-history-' + peakId);
  if (!container) return;

  try {
    // Alle Besteigungen dieses Gipfels laden
    const { data: summits, error } = await GK.supabase
      .from('summits')
      .select('user_id, season, summited_at, points')
      .eq('peak_id', peakId)
      .order('summited_at', { ascending: false });

    if (error || !summits || summits.length === 0) {
      container.innerHTML = '<p style="margin: 0;">Noch nie bestiegen.</p>';
      return;
    }

    // Nach Saison gruppieren
    const seasons = {};
    for (const s of summits) {
      if (!seasons[s.season]) seasons[s.season] = [];
      seasons[s.season].push(s);
    }

    // User-Namen laden
    const userIds = [...new Set(summits.map(s => s.user_id))];
    const userNames = {};
    for (const uid of userIds) {
      const profil = await GK.api.getUserProfile(uid);
      userNames[uid] = profil ? (profil.username || 'Anonym') : 'Anonym';
    }

    // HTML für jede Saison
    let html = '';
    const sortedSeasons = Object.keys(seasons).sort((a, b) => b - a);

    for (const season of sortedSeasons) {
      const entries = seasons[season];
      // Wer war am meisten oben?
      const countByUser = {};
      for (const e of entries) {
        countByUser[e.user_id] = (countByUser[e.user_id] || 0) + 1;
      }
      const topUserId = Object.entries(countByUser).sort((a, b) => b[1] - a[1])[0][0];
      const topCount = countByUser[topUserId];
      const topName = userNames[topUserId];

      html += `
        <div style="margin-bottom: 4px; padding: 3px 0; border-bottom: 1px solid var(--color-border);">
          <div style="display: flex; justify-content: space-between;">
            <strong style="color: var(--color-gold);">${season}</strong>
            <span>${entries.length}x bestiegen</span>
          </div>
          <div>👑 ${topName} (${topCount}x)</div>
        </div>
      `;
    }

    container.innerHTML = html;
  } catch (err) {
    console.error('Fehler beim Laden der Popup-Historie:', err);
    container.innerHTML = '<p>Fehler beim Laden.</p>';
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

    // Beim Öffnen des Popups historische Daten nachladen
    marker.on('popupopen', function () {
      loadPopupHistory(peak.id);
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
