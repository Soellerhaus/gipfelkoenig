// =============================================================================
// Bergkönig — GPX Upload Modul (gpx-upload.js)
// Parst GPX-Dateien im Browser und erkennt Gipfel anhand GPS-Koordinaten.
// =============================================================================

window.GK = window.GK || {};
GK.gpx = {};

// ---------------------------------------------------------------------------
// Haversine-Distanz in Metern
// ---------------------------------------------------------------------------
function haversineDistanz(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Erdradius in Metern
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// GPX-Datei parsen (XML → Array von {lat, lng, time})
// ---------------------------------------------------------------------------
function parseGPX(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const punkte = [];

  // Track-Punkte (<trkpt>) auslesen
  const trkpts = doc.querySelectorAll('trkpt');
  trkpts.forEach(function (pt) {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lng = parseFloat(pt.getAttribute('lon'));
    const timeEl = pt.querySelector('time');
    const time = timeEl ? timeEl.textContent : null;
    if (!isNaN(lat) && !isNaN(lng)) {
      punkte.push({ lat, lng, time });
    }
  });

  // Alternativ: Waypoints (<wpt>) falls keine Tracks
  if (punkte.length === 0) {
    const wpts = doc.querySelectorAll('wpt');
    wpts.forEach(function (pt) {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lng = parseFloat(pt.getAttribute('lon'));
      if (!isNaN(lat) && !isNaN(lng)) {
        punkte.push({ lat, lng, time: null });
      }
    });
  }

  return punkte;
}

// ---------------------------------------------------------------------------
// GPS-Punkte gegen Gipfel-Datenbank prüfen (80m Radius)
// ---------------------------------------------------------------------------
async function findeGipfel(gpsPunkte) {
  // Alle Gipfel aus Supabase laden
  const { data: peaks, error } = await GK.supabase
    .from('peaks')
    .select('id, name, lat, lng, elevation, osm_region');

  if (error || !peaks) {
    console.error('Fehler beim Laden der Gipfel:', error);
    return [];
  }

  const gefunden = new Map(); // peak_id → { peak, distanz, zeit }

  // Jeden GPS-Punkt gegen alle Gipfel prüfen
  for (const punkt of gpsPunkte) {
    for (const peak of peaks) {
      const distanz = haversineDistanz(punkt.lat, punkt.lng, peak.lat, peak.lng);
      if (distanz <= 80) {
        // Nur den nächsten Treffer pro Gipfel speichern
        if (!gefunden.has(peak.id) || distanz < gefunden.get(peak.id).distanz) {
          gefunden.set(peak.id, {
            peak: peak,
            distanz: Math.round(distanz),
            zeit: punkt.time,
          });
        }
      }
    }
  }

  return Array.from(gefunden.values());
}

// ---------------------------------------------------------------------------
// Gefundene Gipfel in Supabase speichern
// ---------------------------------------------------------------------------
async function speichereGipfel(treffer) {
  const { data: { user } } = await GK.supabase.auth.getUser();
  if (!user) return [];

  const gespeichert = [];

  for (const t of treffer) {
    const saison = t.zeit
      ? new Date(t.zeit).getFullYear().toString()
      : new Date().getFullYear().toString();

    // Punkte berechnen (vereinfacht — erste Besteigung)
    let punkte = t.peak.elevation || 1000;
    if (t.peak.osm_region === 'AT-08') punkte += 100;

    const { error } = await GK.supabase
      .from('summits')
      .insert({
        user_id: user.id,
        peak_id: t.peak.id,
        summited_at: t.zeit || new Date().toISOString(),
        season: saison,
        checkin_method: 'strava', // GPX zählt als manueller Strava-Import
        points: punkte,
        is_personal_first: true,
        is_season_first: true,
        safety_ok: true,
      });

    if (error) {
      console.error('Fehler beim Speichern:', t.peak.name, error);
    } else {
      gespeichert.push(t);
    }
  }

  return gespeichert;
}

// ---------------------------------------------------------------------------
// Upload-Handler initialisieren
// ---------------------------------------------------------------------------
GK.gpx.init = function () {
  const uploadInput = document.getElementById('gpx-upload');
  const resultDiv = document.getElementById('gpx-result');

  if (!uploadInput || !resultDiv) return;

  uploadInput.addEventListener('change', async function (e) {
    const datei = e.target.files[0];
    if (!datei) return;

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<span style="color: var(--color-gold);">⏳ Analysiere ' + datei.name + '...</span>';

    try {
      // GPX lesen
      const text = await datei.text();
      const punkte = parseGPX(text);

      if (punkte.length === 0) {
        resultDiv.innerHTML = '<span style="color: var(--color-danger);">Keine GPS-Punkte in der Datei gefunden.</span>';
        return;
      }

      resultDiv.innerHTML = '<span style="color: var(--color-gold);">⏳ ' + punkte.length + ' GPS-Punkte geladen. Prüfe Gipfel...</span>';

      // Gipfel erkennen
      const treffer = await findeGipfel(punkte);

      if (treffer.length === 0) {
        resultDiv.innerHTML = '<span style="color: var(--color-muted);">' + punkte.length + ' GPS-Punkte geprüft — kein bekannter Gipfel in der Nähe (80m Radius).</span>';
        return;
      }

      // Gipfel speichern
      const gespeichert = await speichereGipfel(treffer);

      // Ergebnis anzeigen
      let html = '<div style="color: var(--color-safe); margin-bottom: 0.5rem;">⛰️ ' + gespeichert.length + ' Gipfel erkannt!</div>';
      gespeichert.forEach(function (t) {
        html += '<div style="margin-bottom: 0.25rem;">▲ <strong>' + t.peak.name + '</strong> (' + t.peak.elevation + 'm) — ' + t.distanz + 'm Distanz</div>';
      });
      resultDiv.innerHTML = html;

      // Karte aktualisieren wenn vorhanden
      if (GK.map && GK.map.refreshMarkers) {
        GK.map.refreshMarkers();
      }

    } catch (err) {
      console.error('GPX-Upload Fehler:', err);
      resultDiv.innerHTML = '<span style="color: var(--color-danger);">Fehler beim Verarbeiten: ' + err.message + '</span>';
    }

    // Input zurücksetzen für erneuten Upload
    uploadInput.value = '';
  });
};

// Initialisierung bei Seitenaufruf
document.addEventListener('DOMContentLoaded', function () {
  GK.gpx.init();
});
