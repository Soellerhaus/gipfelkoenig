// =============================================================================
// Bergkönig — Besteigungen & Check-in (summits.js)
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
 * Besteigungen des aktuellen Benutzers laden und als spielerische Kacheln anzeigen.
 * Klick auf Kachel expandiert Punkte-Breakdown pro Besteigung.
 * @param {string} [season] - Saison (Standard: alle)
 */
async function loadMySummits(season) {
  const userId = await getLoggedInUserId();
  if (!userId) {
    console.warn('Kein Benutzer eingeloggt — Meine Gipfel können nicht geladen werden.');
    return;
  }

  const targetSeason = season || null;

  // Besteigungen vom Backend laden
  let summits;
  if (targetSeason) {
    summits = await GK.api.getSummits(userId, targetSeason);
  } else {
    const { data, error } = await GK.supabase
      .from('summits')
      .select('*')
      .eq('user_id', userId)
      .order('summited_at', { ascending: false });
    summits = error ? [] : data;
  }

  const container = document.getElementById('my-peaks-grid');
  if (!container) return;

  // Einträge ohne Gipfel (peak_id=null) rausfiltern — die sind nur für HM/km Tracking
  summits = (summits || []).filter(s => s.peak_id !== null);

  if (summits.length === 0) {
    container.innerHTML = `<p class="empty-state">Noch keine Besteigungen${targetSeason ? ' in der Saison ' + targetSeason : ''}.</p>`;
    return;
  }

  // Peak-Daten laden
  const peakIds = [...new Set(summits.map(s => s.peak_id))];
  const peakMap = new Map();
  for (const pid of peakIds) {
    const peak = await GK.api.getPeakById(pid);
    if (peak) peakMap.set(pid, peak);
  }

  // Nach Gipfel gruppieren
  const grouped = new Map();
  for (const s of summits) {
    if (!grouped.has(s.peak_id)) grouped.set(s.peak_id, []);
    grouped.get(s.peak_id).push(s);
  }

  // Combo-Tage erkennen
  const byDate = {};
  for (const s of summits) {
    const date = s.summited_at.slice(0, 10);
    if (!byDate[date]) byDate[date] = new Set();
    byDate[date].add(s.peak_id);
  }
  const comboDates = new Set();
  for (const [date, peaks] of Object.entries(byDate)) {
    if (peaks.size >= 2) comboDates.add(date);
  }

  // Sortieren: neuestes zuerst
  const sortedGroups = [...grouped.entries()].sort((a, b) => {
    return new Date(b[1][0].summited_at).getTime() - new Date(a[1][0].summited_at).getTime();
  });

  // Statistiken
  const totalPeaks = sortedGroups.length;
  const totalSummits = summits.length;
  const totalPoints = summits.reduce((s, e) => s + (e.points || 0), 0);

  // Header Stats
  const statsHtml = `
    <div style="display:flex;gap:12px;margin-bottom:1rem;flex-wrap:wrap;">
      <div style="flex:1;min-width:80px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:12px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:700;color:var(--color-gold);font-family:var(--font-display);">${totalPeaks}</div>
        <div style="font-size:0.7rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;">Gipfel</div>
      </div>
      <div style="flex:1;min-width:80px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:12px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:700;color:var(--color-gold);font-family:var(--font-display);">${totalSummits}</div>
        <div style="font-size:0.7rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;">Touren</div>
      </div>
      <div style="flex:1;min-width:80px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:12px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:700;color:var(--color-gold);font-family:var(--font-display);">${totalPoints.toLocaleString('de')}</div>
        <div style="font-size:0.7rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;">Punkte</div>
      </div>
    </div>
  `;

  // --- Region-Fortschrittsbalken ---
  let regionProgressHtml = '';
  const SUB_REGIONS = window.ALPINE_SUB_REGIONS || [];
  if (SUB_REGIONS.length > 0 && peakMap.size > 0) {
    // User-Peaks nach Sub-Region gruppieren
    const regionCounts = {};
    for (const [pid, peak] of peakMap) {
      if (!peak.lat || !peak.lng) continue;
      for (const sr of SUB_REGIONS) {
        if (peak.lat >= sr.latMin && peak.lat <= sr.latMax &&
            peak.lng >= sr.lngMin && peak.lng <= sr.lngMax) {
          if (!regionCounts[sr.id]) regionCounts[sr.id] = { name: sr.name, count: 0 };
          regionCounts[sr.id].count++;
          break;
        }
      }
    }

    // Gesamt-Peaks pro Sub-Region laden (aus allen bekannten Peaks)
    const regionsWithPeaks = Object.entries(regionCounts)
      .filter(([id, data]) => data.count > 0)
      .sort((a, b) => b[1].count - a[1].count);

    if (regionsWithPeaks.length > 0) {
      // Für jede Region die Gesamt-Anzahl der Peaks laden
      const regionBars = [];
      for (const [srId, data] of regionsWithPeaks) {
        const sr = SUB_REGIONS.find(r => r.id === srId);
        if (!sr) continue;
        // Anzahl aller Peaks in dieser Sub-Region ermitteln
        const { count: totalInRegion } = await GK.supabase
          .from('peaks')
          .select('*', { count: 'exact', head: true })
          .gte('lat', sr.latMin).lte('lat', sr.latMax)
          .gte('lng', sr.lngMin).lte('lng', sr.lngMax);

        const total = totalInRegion || data.count;
        const pct = Math.round((data.count / total) * 100);
        const isComplete = data.count >= total;
        regionBars.push(`
          <div class="region-progress">
            <div class="region-progress-header">
              <span class="region-progress-name">${data.name}</span>
              <span class="region-progress-count">${data.count}/${total} ${pct}%</span>
            </div>
            <div class="region-progress-bar${isComplete ? ' complete' : ''}">
              <div class="region-progress-fill" style="width:${pct}%;"></div>
            </div>
          </div>
        `);
      }
      regionProgressHtml = `
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.85rem;font-weight:600;color:var(--color-gold);margin-bottom:6px;">Regionen-Fortschritt</div>
          ${regionBars.join('')}
        </div>
      `;
    }
  }

  // Spielerische Kacheln pro Gipfel
  const cardsHtml = sortedGroups.map(([peakId, entries]) => {
    const peak = peakMap.get(peakId);
    const peakName = peak ? peak.name : 'Unbekannter Gipfel';
    const elevation = peak ? peak.elevation : null;
    const count = entries.length;
    const totalPts = entries.reduce((s, e) => s + (e.points || 0), 0);

    // Fruehaufsteher pruefen
    const hasEarly = entries.some(e => new Date(e.summited_at).getHours() < 7);
    const hasPionier = entries.some(e => e.is_season_first);
    const hasCombo = entries.some(e => comboDates.has(e.summited_at.slice(0, 10)));

    // Rang-Icon und CSS-Klasse
    let rankIcon = '▲';
    let rankClass = '';
    if (count >= 10) { rankIcon = '👑'; rankClass = 'diamond'; }
    else if (count >= 5) { rankIcon = '🏔️'; rankClass = 'gold'; }
    else if (count >= 2) { rankIcon = '⛰️'; rankClass = 'silver'; }

    // Badge-Pills
    let badgeHtml = '';
    if (count >= 10) badgeHtml += '<span class="badge-pill" style="background:rgba(255,215,0,0.2);color:#ffd700;">👑 König</span>';
    if (hasPionier) badgeHtml += '<span class="badge-pill" style="background:rgba(201,168,76,0.15);color:var(--color-gold);">⭐ Pionier</span>';
    if (hasEarly) badgeHtml += '<span class="badge-pill" style="background:rgba(100,200,255,0.15);color:#64c8ff;">🌅 Früh</span>';
    if (hasCombo) badgeHtml += '<span class="badge-pill" style="background:rgba(255,100,0,0.15);color:#ff6400;">🔥 Combo</span>';
    if (count === 1) badgeHtml += '<span class="badge-pill" style="background:rgba(147,112,219,0.15);color:#9370db;">💎 Selten</span>';

    // Fortschrittsbalken (count/10)
    const progressWidth = Math.round(Math.min(count / 10, 1) * 100);

    // Breakdown pro Besteigung (versteckt, per Klick sichtbar)
    const breakdownHtml = entries.map(e => {
      const d = new Date(e.summited_at);
      const datum = d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const hm = e.elevation_gain || 0;
      const km = e.distance_km || 0;
      const pts = e.points || 0;

      // Basis-Punkte berechnen
      const hmPts = Math.round(hm / 100);
      const kmPts = Math.round(km * 1);
      const basePts = hmPts + kmPts;

      // Multiplikator bestimmen
      let multiLabel = '';
      let multiValue = 1;
      if (e.is_season_first) { multiLabel = '×3 Pionier'; multiValue = 3; }
      else if (e.is_personal_first) { multiLabel = '×2 Erstbesuch'; multiValue = 2; }
      else { multiLabel = '×0.2 Whg.'; multiValue = 0.2; }

      const hmStr = hm ? `↗${hm} HM` : '';

      return `<div style="font-size:0.72rem;color:var(--color-muted);padding:4px 0;border-bottom:1px solid rgba(201,168,76,0.08);font-family:var(--font-mono);">
        <div>${datum}${hmStr ? ' · ' + hmStr : ''}</div>
        <div>${hmPts} HM + ${kmPts} km = ${basePts} Basis <span style="opacity:0.6;">${multiLabel}</span> = <span style="color:var(--color-gold);">${pts} Pkt</span></div>
      </div>`;
    }).join('');

    const cardId = 'peak-card-' + peakId;

    return `
      <div class="peak-card ${rankClass}" id="${cardId}" onclick="document.getElementById('${cardId}').classList.toggle('expanded')">
        <div class="progress-bar" style="width:${progressWidth}%;"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;">
            <div class="peak-name">${rankIcon} ${peakName}</div>
            <div class="peak-meta">
              ${elevation ? elevation + ' m · ' : ''}${count}× bestiegen
            </div>
            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">
              ${badgeHtml}
            </div>
          </div>
          <div style="text-align:right;min-width:55px;">
            <div class="peak-points">${totalPts.toLocaleString('de')}</div>
            <div style="font-size:0.6rem;color:var(--color-muted);text-transform:uppercase;">Punkte</div>
          </div>
        </div>
        <div class="breakdown">
          <div style="font-size:0.7rem;color:var(--color-gold);margin-bottom:6px;font-weight:600;">Alle Besteigungen</div>
          ${breakdownHtml}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = statsHtml + regionProgressHtml + cardsHtml || '<p class="text-muted">Keine Gipfel gefunden.</p>';
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
