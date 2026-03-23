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
  container.innerHTML = '<p style="color:#888;">Lade Feed...</p>';

  try {
    const { data: summits, error } = await GK.supabase
      .from('summits')
      .select('user_id, peak_id, summited_at, points, season, is_season_first, is_personal_first, elevation_gain')
      .order('summited_at', { ascending: false })
      .limit(30);

    if (error) { console.error('Feed error:', error); container.innerHTML = '<p style="color:#888;">Feed konnte nicht geladen werden.</p>'; return; }
    if (!summits || summits.length === 0) { container.innerHTML = '<p style="color:#888;">Noch keine Aktivitäten.</p>'; return; }

    // Batch: User-Profile laden
    const userIds = [...new Set(summits.map(s => s.user_id))];
    const { data: profiles } = await GK.supabase.from('user_profiles').select('id, username, avatar_type').in('id', userIds);
    const profileMap = {};
    (profiles || []).forEach(p => profileMap[p.id] = p);

    // Batch: Peak-Daten laden
    const peakIds = [...new Set(summits.map(s => s.peak_id))];
    const { data: peaks } = await GK.supabase.from('peaks').select('id, name, elevation').in('id', peakIds);
    const peakMap = {};
    (peaks || []).forEach(p => peakMap[p.id] = p);

    const AVATARS = { mountain:'🏔️', eagle:'🦅', ski:'⛷️', climber:'🧗', tree:'🌲', snow:'❄️', deer:'🦌', rock:'🪨' };
    let html = '';
    let lastDate = '';

    for (const s of summits) {
      const d = new Date(s.summited_at);
      const datum = d.toLocaleDateString('de-AT', { day:'2-digit', month:'long', year:'numeric' });
      const profile = profileMap[s.user_id] || {};
      const peak = peakMap[s.peak_id] || { name:'Unbekannt', elevation:0 };
      const avatar = AVATARS[profile.avatar_type] || '⛰️';
      const username = profile.username || 'Anonym';
      const hour = d.getHours();

      if (datum !== lastDate) {
        html += '<div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin:16px 0 6px;font-family:monospace;">' + datum + '</div>';
        lastDate = datum;
      }

      // Badges
      let badges = '';
      if (s.is_season_first) badges += '<span style="background:rgba(255,215,0,0.2);color:#ffd700;font-size:0.65rem;padding:2px 6px;border-radius:4px;margin-right:4px;">⭐ Pionier</span>';
      if (s.is_personal_first) badges += '<span style="background:rgba(100,149,237,0.2);color:cornflowerblue;font-size:0.65rem;padding:2px 6px;border-radius:4px;margin-right:4px;">🆕 Neu</span>';
      if (hour < 7) badges += '<span style="background:rgba(255,165,0,0.2);color:orange;font-size:0.65rem;padding:2px 6px;border-radius:4px;margin-right:4px;">🌅 Früh</span>';

      // Punkte-Breakdown
      const hm = s.elevation_gain || 0;
      const hmPts = Math.round(hm / 100);
      let breakdownText = hmPts + ' HM';
      if (s.is_season_first) breakdownText += ' ×3 Pionier';
      else if (s.is_personal_first) breakdownText += ' ×2 Erst';
      else breakdownText += ' Basis';

      html += '<div style="display:flex;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.08);">';
      html += '<span style="font-size:1.3rem;margin-right:10px;margin-top:2px;">' + avatar + '</span>';
      html += '<div style="flex:1;">';
      html += '<div><strong style="color:white;">' + username + '</strong> hat <strong style="color:#ffd700;">' + peak.name + '</strong> bestiegen ' + badges + '</div>';
      html += '<div style="font-size:0.75rem;color:#888;margin-top:2px;">' + (peak.elevation || '?') + ' m · ↗' + hm + ' HM</div>';
      html += '</div>';
      html += '<div style="text-align:right;min-width:50px;">';
      html += '<div style="font-size:1.2rem;font-weight:bold;color:#ffd700;">+' + (s.points || 0) + '</div>';
      html += '<div style="font-size:0.6rem;color:#888;">Pkt</div>';
      html += '</div></div>';
    }

    container.innerHTML = html;
  } catch (err) {
    console.error('Feed Fehler:', err);
    container.innerHTML = '<p style="color:#888;">Feed-Fehler: ' + err.message + '</p>';
  }
}

// Global verfuegbar machen
window.loadFeed = loadFeed;
