// =============================================================================
// Bergkönig — Activity Feed (feed.js)
// Zeigt die letzten Besteigungen mit Punkte-Details pro Tour.
// =============================================================================

window.GK = window.GK || {};

/**
 * Feed laden — letzte Besteigungen mit Punkte-Aufschluesselung
 */
async function loadFeed() {
  const container = document.getElementById('feed-list');
  if (!container) return;

  container.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Lade Feed...</p>';

  try {
    const { data: summits, error } = await GK.supabase
      .from('summits')
      .select('user_id, peak_id, summited_at, points, season, is_season_first, is_personal_first, elevation_gain')
      .order('summited_at', { ascending: false })
      .limit(30);

    if (error || !summits || summits.length === 0) {
      container.innerHTML = '<p class="text-muted">Noch keine Aktivitaeten.</p>';
      return;
    }

    // User-Namen und Peak-Daten batch laden
    const userIds = [...new Set(summits.map(s => s.user_id))];
    const peakIds = [...new Set(summits.map(s => s.peak_id))];

    const userNames = {};
    for (const uid of userIds) {
      const profil = await GK.api.getUserProfile(uid);
      userNames[uid] = profil ? (profil.username || 'Anonym') : 'Anonym';
    }

    const peakData = {};
    for (const pid of peakIds) {
      const peak = await GK.api.getPeakById(pid);
      peakData[pid] = peak || { name: 'Unbekannt', elevation: 0 };
    }

    // Combo-Tage erkennen (2+ Gipfel am selben Tag vom selben User)
    const byUserDate = {};
    for (const s of summits) {
      const key = s.user_id + '_' + s.summited_at.slice(0, 10);
      if (!byUserDate[key]) byUserDate[key] = new Set();
      byUserDate[key].add(s.peak_id);
    }
    const comboDates = new Set();
    for (const [key, peaks] of Object.entries(byUserDate)) {
      if (peaks.size >= 2) comboDates.add(key);
    }

    // Feed-HTML erstellen
    let html = '';
    let lastDate = '';

    for (const s of summits) {
      const d = new Date(s.summited_at);
      const datum = d.toLocaleDateString('de-AT', {
        day: '2-digit', month: 'long', year: 'numeric'
      });
      const zeit = d.toLocaleTimeString('de-AT', {
        hour: '2-digit', minute: '2-digit'
      });
      const hour = d.getHours();
      const userName = userNames[s.user_id];
      const peak = peakData[s.peak_id];
      const comboKey = s.user_id + '_' + s.summited_at.slice(0, 10);
      const isCombo = comboDates.has(comboKey);
      const isEarly = hour < 7;

      // Datums-Trenner
      if (datum !== lastDate) {
        html += `<div style="font-size:0.75rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;margin:1rem 0 0.3rem;font-family:var(--font-mono);">${datum}</div>`;
        lastDate = datum;
      }

      // Punkte-Breakdown berechnen
      const pts = s.points || 0;
      let breakdownParts = [];
      if (s.is_season_first) breakdownParts.push('⭐ Saison-Erster ×3');
      else if (s.is_personal_first) breakdownParts.push('🆕 Erstbesteigung ×1.5');
      else if (pts > 0) breakdownParts.push('🔄 Wiederholung');
      if (isCombo) breakdownParts.push('🔥 Combo +500');
      if (isEarly) breakdownParts.push('🌅 vor 07:00');

      // Badges
      let badges = '';
      if (s.is_season_first) badges += '<span style="background:rgba(255,215,0,0.15);color:#ffd700;padding:1px 5px;border-radius:3px;font-size:0.65rem;margin-left:3px;">⭐ Pionier</span>';
      if (s.is_personal_first) badges += '<span style="background:rgba(201,168,76,0.1);color:var(--color-gold);padding:1px 5px;border-radius:3px;font-size:0.65rem;margin-left:3px;">🆕 Neu</span>';
      if (isCombo) badges += '<span style="background:rgba(255,100,0,0.15);color:#ff6400;padding:1px 5px;border-radius:3px;font-size:0.65rem;margin-left:3px;">🔥 Combo</span>';
      if (isEarly) badges += '<span style="background:rgba(100,200,255,0.15);color:#64c8ff;padding:1px 5px;border-radius:3px;font-size:0.65rem;margin-left:3px;">🌅 Früh</span>';

      // Punkte-Farbe
      let ptsColor = 'var(--color-gold)';
      if (pts >= 100) ptsColor = '#ffd700';
      else if (pts <= 0) ptsColor = 'var(--color-muted)';

      // Aktivitaets-Icon
      let icon = '⛰️';
      if (s.is_season_first) icon = '⭐';
      else if (isCombo) icon = '🔥';
      else if (isEarly) icon = '🌅';

      html += `
        <div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.6rem 0;border-bottom:1px solid var(--color-border);">
          <div style="width:36px;height:36px;background:var(--color-bg-hover);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;color:var(--color-gold);flex-shrink:0;">
            ${userName.charAt(0).toUpperCase()}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.9rem;">
              <strong>${userName}</strong> hat
              <strong style="color:var(--color-gold);">${peak.name}</strong> bestiegen
              ${badges}
            </div>
            <div style="font-size:0.75rem;color:var(--color-muted);margin-top:2px;">
              ${peak.elevation ? peak.elevation + ' m · ' : ''}${s.elevation_gain ? '↗ ' + s.elevation_gain + ' HM · ' : ''}${zeit} Uhr
            </div>
            ${breakdownParts.length > 0 ? `<div style="font-size:0.65rem;color:var(--color-muted);margin-top:2px;font-family:var(--font-mono);">${breakdownParts.join(' + ')}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;min-width:50px;">
            <div style="font-size:1.1rem;font-weight:700;color:${ptsColor};font-family:var(--font-mono);">+${pts}</div>
            <div style="font-size:0.6rem;color:var(--color-muted);">Pkt</div>
          </div>
        </div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    console.error('Fehler beim Laden des Feeds:', err);
    container.innerHTML = '<p class="text-muted">Feed konnte nicht geladen werden.</p>';
  }
}

// Global verfuegbar machen
window.loadFeed = loadFeed;
