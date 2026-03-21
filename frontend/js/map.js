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

  const kingInfo = ownership && ownership.username
    ? `${ownership.username} seit ${formatDate(ownership.claimed_at)}`
    : 'Kein König';

  return `
    <div class="peak-popup">
      <h3 style="font-family: 'Playfair Display', serif; margin: 0 0 6px 0;">
        ${peak.name}
      </h3>
      <p style="margin: 2px 0;"><strong>${peak.elevation} m</strong></p>
      <p style="margin: 2px 0;">👑 ${kingInfo}</p>
      <p style="margin: 2px 0;">⛰️ ${summitCount} Besteigung${summitCount !== 1 ? 'en' : ''} diese Saison</p>
      <p style="margin: 2px 0;">${safetyDot}</p>
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
      maxWidth: 260,
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
  const map = L.map('map').setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM);

  // OpenTopoMap-Kacheln laden
  L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution:
      'Kartendaten: &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>-Mitwirkende, ' +
      '<a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  }).addTo(map);

  // Marker-Schicht erstellen
  markerLayer = L.layerGroup().addTo(map);

  // Karte öffentlich verfügbar machen
  GK.map.leaflet = map;

  // Aktuellen Benutzer laden
  GK.map._currentUserId = await getCurrentUserId();

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
        // Karte bleibt auf Kleinwalsertal zentriert
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
