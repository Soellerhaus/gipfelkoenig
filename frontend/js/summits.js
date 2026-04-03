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

  // Alle Aktivitäten behalten (auch peak_id=null für HM/km Zusammenfassung)
  const allActivities = (summits || []);
  // Nur echte Gipfel-Einträge für Peak-Karten
  const peakSummits = allActivities.filter(s => s.peak_id !== null);

  if (allActivities.length === 0) {
    container.innerHTML = `<p class="empty-state">Noch keine Aktivitäten${targetSeason ? ' in der Saison ' + targetSeason : ''}.</p>`;
    return;
  }

  // Peak-Daten laden (nur für echte Gipfel)
  const peakIds = [...new Set(peakSummits.map(s => s.peak_id))];
  const peakMap = new Map();
  for (const pid of peakIds) {
    const peak = await GK.api.getPeakById(pid);
    if (peak) peakMap.set(pid, peak);
  }

  // Nach Gipfel gruppieren (nur echte)
  const grouped = new Map();
  for (const s of peakSummits) {
    if (!grouped.has(s.peak_id)) grouped.set(s.peak_id, []);
    grouped.get(s.peak_id).push(s);
  }

  // Combo-Tage erkennen
  const byDate = {};
  for (const s of peakSummits) {
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

  // Gesamt-Statistiken (ALLE Aktivitäten, dedupliziert nach strava_activity_id)
  const totalPeaks = sortedGroups.length;
  const totalPoints = allActivities.reduce((s, e) => s + (e.points || 0), 0);
  const seenAct = new Set();
  let totalHM = 0, totalKM = 0, totalActivitiesCount = 0;
  for (const a of allActivities) {
    const key = a.strava_activity_id || a.id;
    if (seenAct.has(key)) continue;
    seenAct.add(key);
    totalActivitiesCount++;
    if (a.elevation_gain > 0) totalHM += a.elevation_gain;
    if (a.distance > 0) totalKM += a.distance;
  }

  // Header Stats — 4 Kacheln
  const statsHtml = `
    <div style="display:flex;gap:8px;margin-bottom:1rem;flex-wrap:wrap;">
      <div style="flex:1;min-width:70px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:10px 6px;text-align:center;">
        <div style="font-size:1.4rem;font-weight:700;color:var(--color-gold);font-family:var(--font-display);">${totalPeaks}</div>
        <div style="font-size:0.65rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;">Gipfel</div>
      </div>
      <div style="flex:1;min-width:70px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:10px 6px;text-align:center;">
        <div style="font-size:1.4rem;font-weight:700;color:var(--color-gold);font-family:var(--font-display);">${totalActivitiesCount}</div>
        <div style="font-size:0.65rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;">Touren</div>
      </div>
      <div style="flex:1;min-width:70px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:10px 6px;text-align:center;">
        <div style="font-size:1.4rem;font-weight:700;color:var(--color-gold);font-family:var(--font-display);">${totalHM.toLocaleString('de')}</div>
        <div style="font-size:0.65rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;">H\u00f6henmeter</div>
      </div>
      <div style="flex:1;min-width:70px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:10px 6px;text-align:center;">
        <div style="font-size:1.4rem;font-weight:700;color:var(--color-gold);font-family:var(--font-display);">${totalKM.toLocaleString('de')}</div>
        <div style="font-size:0.65rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;">Kilometer</div>
      </div>
    </div>
    <div style="text-align:center;margin-bottom:1rem;">
      <div style="font-size:1.8rem;font-weight:700;color:var(--color-gold);font-family:var(--font-display);">${totalPoints.toLocaleString('de')} Punkte</div>
    </div>
  `;

  // "Nächstes Los" Motivation
  let nextLosHtml = '';
  const stats = window._seasonStats;
  if (stats) {
    const hints = [];
    if (stats.hmBisLos <= 5000) hints.push('\u2191 ' + stats.hmBisLos.toLocaleString('de') + ' HM \u2192 n\u00e4chstes HM-Los');
    if (stats.kmBisLos <= 50) hints.push('\ud83e\udeb7 ' + stats.kmBisLos + ' km \u2192 n\u00e4chstes km-Los');
    if (stats.pktBisLos <= 500) hints.push('\u2b50 ' + stats.pktBisLos.toLocaleString('de') + ' Pkt \u2192 n\u00e4chstes Punkte-Los');
    if (hints.length === 0) {
      // Immer mindestens einen Hinweis zeigen
      const hmPct = (stats.seasonHM % 10000) / 10000;
      const kmPct = (stats.seasonKM % 100) / 100;
      const pktPct = (stats.seasonPts % 1000) / 1000;
      if (hmPct >= kmPct && hmPct >= pktPct) hints.push('\u2191 Noch ' + stats.hmBisLos.toLocaleString('de') + ' HM bis zum n\u00e4chsten Los');
      else if (kmPct >= hmPct && kmPct >= pktPct) hints.push('\ud83e\udeb7 Noch ' + stats.kmBisLos + ' km bis zum n\u00e4chsten Los');
      else hints.push('\u2b50 Noch ' + stats.pktBisLos.toLocaleString('de') + ' Pkt bis zum n\u00e4chsten Los');
    }
    nextLosHtml = '<div style="background:linear-gradient(135deg,rgba(255,215,0,0.12),rgba(255,165,0,0.08));border:1px solid rgba(255,215,0,0.3);border-radius:12px;padding:12px 16px;margin-bottom:1rem;text-align:center;">';
    nextLosHtml += '<div style="font-size:0.75rem;color:var(--color-muted);margin-bottom:4px;">\ud83c\udfab N\u00e4chstes Los</div>';
    nextLosHtml += '<div style="font-size:0.9rem;color:var(--color-gold);font-weight:600;">' + hints.join(' &middot; ') + '</div>';
    nextLosHtml += '</div>';
  }

  // Letzte 3 Aktivitäten (dedupliziert nach strava_activity_id, neueste zuerst)
  const seenRecent = new Set();
  const recentActivities = [];
  for (const a of allActivities) {
    const key = a.strava_activity_id || a.id;
    if (seenRecent.has(key)) continue;
    seenRecent.add(key);
    recentActivities.push(a);
    if (recentActivities.length >= 3) break;
  }

  let recentHtml = '<div style="margin-bottom:1rem;">';
  recentHtml += '<div style="font-size:0.85rem;font-weight:600;color:var(--color-gold);margin-bottom:8px;">Letzte Aktivit\u00e4ten</div>';
  for (const a of recentActivities) {
    const d = new Date(a.summited_at);
    const datum = d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const hm = a.elevation_gain || 0;
    const km = a.distance || 0;
    const pts = a.points || 0;
    const peak = a.peak_id ? peakMap.get(a.peak_id) : null;
    const peakLabel = peak ? peak.name : 'Tour ohne Gipfel';
    const peakElev = peak ? ' (' + peak.elevation + ' m)' : '';

    // Punkte-Breakdown
    const hmPts = Math.round(hm / 100);
    const kmPts = Math.round(km);
    const hasPeak = !!a.peak_id;
    const gipfelBonus = hasPeak ? 10 : 0;
    const basePts = hmPts + kmPts + gipfelBonus;

    let multiLabel = '';
    if (!hasPeak) { multiLabel = 'Basis'; }
    else if (a.is_season_first) { multiLabel = '\u00d73 Pionier'; }
    else if (a.is_personal_first) { multiLabel = '\u00d72 Erstbesuch'; }
    else { multiLabel = '\u00d70.5 Whg.'; }

    recentHtml += '<div style="background:rgba(201,168,76,0.05);border:1px solid rgba(201,168,76,0.15);border-radius:10px;padding:10px 12px;margin-bottom:6px;">';
    recentHtml += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    recentHtml += '<div>';
    recentHtml += '<div style="font-size:0.82rem;font-weight:600;color:var(--color-text);">' + peakLabel + peakElev + '</div>';
    recentHtml += '<div style="font-size:0.72rem;color:var(--color-muted);">' + datum + '</div>';
    recentHtml += '</div>';
    recentHtml += '<div style="text-align:right;">';
    recentHtml += '<div style="font-size:1.1rem;font-weight:700;color:var(--color-gold);">+' + pts + '</div>';
    recentHtml += '<div style="font-size:0.6rem;color:var(--color-muted);">Pkt</div>';
    recentHtml += '</div></div>';
    recentHtml += '<div style="font-size:0.7rem;color:var(--color-muted);margin-top:4px;font-family:var(--font-mono);">';
    recentHtml += '\u2191' + hm.toLocaleString('de') + ' HM + ' + km + ' km';
    if (hasPeak) recentHtml += ' + 10 Gipfel';
    recentHtml += ' = ' + basePts + ' Basis';
    if (hasPeak) recentHtml += ' <span style="opacity:0.7;">' + multiLabel + '</span>';
    recentHtml += ' = <span style="color:var(--color-gold);">' + pts + ' Pkt</span>';
    recentHtml += '</div></div>';
  }
  recentHtml += '</div>';

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
      // Top 3 immer sichtbar, Rest per Dropdown
      const top3 = regionBars.slice(0, 3).join('');
      const rest = regionBars.slice(3).join('');
      const hasMore = regionBars.length > 3;
      regionProgressHtml = `
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.85rem;font-weight:600;color:var(--color-gold);margin-bottom:6px;">Regionen-Fortschritt</div>
          ${top3}
          ${hasMore ? '<div id="regions-more" style="display:none;">' + rest + '</div><div style="text-align:center;margin-top:4px;"><button onclick="var el=document.getElementById(\'regions-more\');el.style.display=el.style.display===\'none\'?\'block\':\'none\';this.textContent=el.style.display===\'none\'?\'\u25BC Alle ' + regionBars.length + ' Regionen zeigen\':\'\u25B2 Weniger zeigen\';" style="background:none;border:1px solid rgba(201,168,76,0.2);color:var(--color-gold);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.72rem;">\u25BC Alle ' + regionBars.length + ' Regionen zeigen</button></div>' : ''}
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

    // Breakdown pro Besteigung — NUR Gipfel-Punkte (HM/km werden im Profil-Total gezählt)
    const breakdownHtml = entries.map(e => {
      const d = new Date(e.summited_at);
      const datum = d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const pts = e.points || 0;

      // Multiplikator bestimmen
      let multiLabel = '';
      if (e.is_season_first) { multiLabel = '×3 Pionier'; }
      else if (e.is_personal_first) { multiLabel = '×2 Erstbesuch'; }
      else { multiLabel = '×0.5 Whg.'; }

      return `<div style="font-size:0.72rem;color:var(--color-muted);padding:4px 0;border-bottom:1px solid rgba(201,168,76,0.08);font-family:var(--font-mono);">
        <div>${datum} <span style="opacity:0.6;">${multiLabel}</span> = <span style="color:var(--color-gold);">${pts} Pkt</span></div>
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

  container.innerHTML = statsHtml + nextLosHtml + recentHtml + regionProgressHtml + (sortedGroups.length > 0 ? '<div style="font-size:0.85rem;font-weight:600;color:var(--color-gold);margin-bottom:8px;">Deine Gipfel</div>' + cardsHtml : '');
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
