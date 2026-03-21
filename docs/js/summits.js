// =============================================================================
// Gipfelkönig — Besteigungen & Check-in (summits.js)
// Manueller GPS Check-in, "Meine Gipfel"-Ansicht und Toast-Benachrichtigungen.
// =============================================================================

// Globaler Namespace
window.GK = window.GK || {};
GK.summits = {};

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------
const TOAST_DURATION = 3000; // ms
const MODAL_AUTO_CLOSE = 2000; // ms nach Erfolg

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Aktuelle Saison ermitteln (Jahreszahl als String) */
function getSeason() {
  return new Date().getFullYear().toString();
}

/** Eingeloggten Benutzer aus Supabase Auth auslesen */
async function getLoggedInUserId() {
  try {
    const { data: { user } } = await GK.supabase.auth.getUser();
    return user ? user.id : null;
  } catch (err) {
    console.error('Fehler beim Abrufen des Benutzers:', err);
    return null;
  }
}

/** Uhrzeit als "HH:MM Uhr" formatieren */
function formatTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} Uhr`;
}

// ---------------------------------------------------------------------------
// Toast-Benachrichtigungen
// ---------------------------------------------------------------------------

/**
 * Toast-Nachricht anzeigen.
 * @param {string} message - Anzuzeigende Nachricht
 * @param {'success'|'error'} type - Art der Nachricht
 */
GK.showToast = function (message, type) {
  // Bestehende Toasts entfernen
  const existing = document.querySelector('.gk-toast');
  if (existing) {
    existing.remove();
  }

  // Toast-Element erstellen
  const toast = document.createElement('div');
  toast.className = `gk-toast gk-toast--${type || 'success'}`;
  toast.textContent = message;

  // Zum Body hinzufügen
  document.body.appendChild(toast);

  // Einblend-Animation auslösen (nächster Frame für CSS-Transition)
  requestAnimationFrame(() => {
    toast.classList.add('gk-toast--visible');
  });

  // Nach Ablauf der Dauer ausblenden und entfernen
  setTimeout(() => {
    toast.classList.remove('gk-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback: nach 500ms trotzdem entfernen falls Transition nicht feuert
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 500);
  }, TOAST_DURATION);
};

// ---------------------------------------------------------------------------
// Check-in Modal Steuerung
// ---------------------------------------------------------------------------

/** Modal anzeigen */
function showModal() {
  const modal = document.getElementById('checkin-modal');
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }
}

/** Modal ausblenden */
function hideModal() {
  const modal = document.getElementById('checkin-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

/** Modal-Inhalt setzen */
function setModalContent(html) {
  const body = document.querySelector('#checkin-modal .modal-body');
  if (body) {
    body.innerHTML = html;
  }
}

// ---------------------------------------------------------------------------
// Manueller Check-in Ablauf
// ---------------------------------------------------------------------------

/**
 * Manuellen GPS Check-in durchführen.
 * 1. Modal öffnen
 * 2. GPS-Position ermitteln (hohe Genauigkeit)
 * 3. Check-in an Backend senden
 * 4. Ergebnis anzeigen
 */
async function performCheckin() {
  // Modal anzeigen mit Lade-Anzeige
  showModal();
  setModalContent(`
    <div class="checkin-loading">
      <p>📡 GPS-Position wird ermittelt…</p>
    </div>
  `);

  // GPS-Position ermitteln
  let position;
  try {
    position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
  } catch (err) {
    console.error('GPS-Fehler:', err);
    setModalContent(`
      <div class="checkin-error">
        <p>❌ GPS-Position konnte nicht ermittelt werden.</p>
        <p>${err.message}</p>
        <button class="modal-close-btn" onclick="document.getElementById('checkin-modal').style.display='none'">
          Schließen
        </button>
      </div>
    `);
    return;
  }

  const { latitude, longitude } = position.coords;

  // Lade-Anzeige aktualisieren
  setModalContent(`
    <div class="checkin-loading">
      <p>⛰️ Check-in wird durchgeführt…</p>
    </div>
  `);

  // Check-in an Backend senden
  const result = await GK.api.checkin(latitude, longitude);

  // Ergebnis verarbeiten
  if (!result) {
    // Netzwerkfehler oder unbekannter Fehler
    setModalContent(`
      <div class="checkin-error">
        <p>❌ Fehler beim Check-in. Bitte versuche es erneut.</p>
        <button class="modal-close-btn" onclick="document.getElementById('checkin-modal').style.display='none'">
          Schließen
        </button>
      </div>
    `);
    return;
  }

  // Erfolgreicher Check-in
  if (result.success) {
    const peakName = result.peak_name || 'Gipfel';
    const points = result.points || 0;

    setModalContent(`
      <div class="checkin-success">
        <p class="checkin-success-text">
          ⛰️ ${peakName}!<br>+${points} Punkte
        </p>
      </div>
    `);

    GK.showToast(`${peakName} — +${points} Punkte!`, 'success');

    // Karte und Punkte aktualisieren
    if (GK.map && GK.map.refreshMarkers) {
      GK.map.refreshMarkers();
    }

    // "Meine Gipfel" Ansicht neu laden
    loadMySummits();

    // Modal nach kurzer Zeit automatisch schließen
    setTimeout(hideModal, MODAL_AUTO_CLOSE);
    return;
  }

  // Gipfel gefunden aber gesperrt (Lawinenstufe zu hoch)
  if (result.unsafe) {
    const level = result.danger_level || '?';
    setModalContent(`
      <div class="checkin-warning">
        <p>⚠️ Gipfel heute gesperrt (Lawinenstufe ${level})</p>
        <button class="modal-close-btn" onclick="document.getElementById('checkin-modal').style.display='none'">
          Schließen
        </button>
      </div>
    `);
    GK.showToast('Gipfel heute gesperrt!', 'error');
    return;
  }

  // Kein Gipfel in der Nähe
  if (result.no_peak) {
    setModalContent(`
      <div class="checkin-no-peak">
        <p>🔍 Kein bekannter Gipfel in deiner Nähe (80m Radius)</p>
        <button class="modal-close-btn" onclick="document.getElementById('checkin-modal').style.display='none'">
          Schließen
        </button>
      </div>
    `);
    return;
  }

  // Unbekannte Antwort
  setModalContent(`
    <div class="checkin-error">
      <p>❌ Unerwartete Antwort vom Server.</p>
      <button class="modal-close-btn" onclick="document.getElementById('checkin-modal').style.display='none'">
        Schließen
      </button>
    </div>
  `);
}

// ---------------------------------------------------------------------------
// "Meine Gipfel"-Ansicht
// ---------------------------------------------------------------------------

/**
 * Besteigungen des aktuellen Benutzers laden und als Karten anzeigen.
 * @param {string} [season] - Saison (Standard: aktuelle Saison)
 */
async function loadMySummits(season) {
  const userId = await getLoggedInUserId();
  if (!userId) {
    console.warn('Kein Benutzer eingeloggt — Meine Gipfel können nicht geladen werden.');
    return;
  }

  const targetSeason = season || null; // Alle Saisons wenn nicht angegeben

  // Besteigungen vom Backend laden (alle oder gefiltert)
  let summits;
  if (targetSeason) {
    summits = await GK.api.getSummits(userId, targetSeason);
  } else {
    // Alle Saisons laden
    const { data, error } = await GK.supabase
      .from('summits')
      .select('*')
      .eq('user_id', userId)
      .order('summited_at', { ascending: false });
    summits = error ? [] : data;
  }

  // Container im DOM finden
  const container = document.getElementById('my-peaks-grid');
  if (!container) return;

  // Leerer Zustand
  if (!summits || summits.length === 0) {
    container.innerHTML = `
      <p class="empty-state">Noch keine Besteigungen in der Saison ${targetSeason}.</p>
    `;
    return;
  }

  // Peaks-Daten laden für Namen und Höhe
  const peakIds = [...new Set(summits.map(s => s.peak_id))];
  const peakMap = new Map();
  for (const pid of peakIds) {
    const peak = await GK.api.getPeakById(pid);
    if (peak) peakMap.set(pid, peak);
  }

  // Karten-HTML erzeugen — gruppiert nach Gipfel (letztes Datum)
  const cardsHtml = summits.map((summit) => {
    const peak = peakMap.get(summit.peak_id);
    const peakName = peak ? peak.name : 'Unbekannter Gipfel';
    const elevation = peak ? peak.elevation : '—';
    const datum = new Date(summit.summited_at).toLocaleDateString('de-AT', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const zeit = new Date(summit.summited_at).toLocaleTimeString('de-AT', {
      hour: '2-digit', minute: '2-digit'
    });

    return `
      <div class="card" style="margin-bottom: 0.5rem; padding: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong style="font-family: var(--font-display);">${peakName}</strong>
            <div class="text-muted" style="font-size: 0.8rem;">${elevation} m · ${datum} · ${zeit} Uhr</div>
          </div>
          <div style="color: var(--color-gold); font-weight: 700; font-size: 0.9rem;">
            +${summit.points}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = cardsHtml || '<p class="text-muted">Keine Gipfel gefunden.</p>';
}

// ---------------------------------------------------------------------------
// Saison-Filter
// ---------------------------------------------------------------------------

/**
 * Saison-Filter-Buttons einrichten.
 * Erwartet Buttons mit data-season Attribut im #season-filter Container.
 */
function initSeasonFilter() {
  const filterContainer = document.getElementById('season-filter');
  if (!filterContainer) return;

  filterContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-season]');
    if (!btn) return;

    const season = btn.dataset.season;

    // Aktiven Button markieren
    filterContainer.querySelectorAll('[data-season]').forEach((b) => {
      b.classList.remove('active');
    });
    btn.classList.add('active');

    // Besteigungen für gewählte Saison laden
    loadMySummits(season);
  });
}

// ---------------------------------------------------------------------------
// Event-Listener einrichten
// ---------------------------------------------------------------------------

function initEventListeners() {
  // Check-in Button im Popup (Event-Delegation auf document weil Popup dynamisch)
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'checkin-btn') {
      e.preventDefault();
      performCheckin();
    }

    // Modal-Hintergrund zum Schließen
    if (e.target && e.target.id === 'checkin-modal') {
      hideModal();
    }

    // Schließen-Button im Modal
    if (e.target && e.target.classList.contains('modal-close-btn')) {
      hideModal();
    }
  });
}

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

/**
 * Summits-Modul initialisieren.
 * Lädt "Meine Gipfel" und richtet Event-Listener ein.
 */
async function initSummits() {
  initEventListeners();
  initSeasonFilter();
  await loadMySummits();
  console.log('Summits-Modul initialisiert.');
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/** Modul initialisieren */
GK.summits.init = initSummits;

/** Check-in manuell auslösen */
GK.summits.checkin = performCheckin;

/** "Meine Gipfel" neu laden */
GK.summits.loadMySummits = loadMySummits;

// ---------------------------------------------------------------------------
// Automatisch starten wenn DOM bereit ist
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initSummits();
});
