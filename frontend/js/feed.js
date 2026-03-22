// =============================================================================
// Bergkönig — Activity Feed (feed.js)
// Zeigt die letzten Besteigungen aller User als chronologischen Stream.
// =============================================================================

window.GK = window.GK || {};

/**
 * Feed laden — letzte 50 Besteigungen aller User
 */
async function loadFeed() {
  const container = document.getElementById('feed-list');
  if (!container) return;

  container.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Lade Feed...</p>';

  try {
    // Letzte 10 Besteigungen laden (leichtgewichtig)
    const { data: summits, error } = await GK.supabase
      .from('summits')
      .select('user_id, peak_id, summited_at, points, season')
      .order('summited_at', { ascending: false })
      .limit(10);

    if (error || !summits || summits.length === 0) {
      container.innerHTML = '<p class="text-muted">Noch keine Aktivitäten.</p>';
      return;
    }

    // User-Namen und Peak-Namen laden
    const userIds = [...new Set(summits.map(s => s.user_id))];
    const peakIds = [...new Set(summits.map(s => s.peak_id))];

    const userNames = {};
    for (const uid of userIds) {
      const profil = await GK.api.getUserProfile(uid);
      userNames[uid] = profil ? (profil.username || 'Anonym') : 'Anonym';
    }

    const peakNames = {};
    for (const pid of peakIds) {
      const peak = await GK.api.getPeakById(pid);
      peakNames[pid] = peak ? { name: peak.name, elevation: peak.elevation } : { name: 'Unbekannt', elevation: 0 };
    }

    // Feed-HTML erstellen
    let html = '';
    let lastDate = '';

    for (const s of summits) {
      const datum = new Date(s.summited_at).toLocaleDateString('de-AT', {
        day: '2-digit', month: 'long', year: 'numeric'
      });
      const zeit = new Date(s.summited_at).toLocaleTimeString('de-AT', {
        hour: '2-digit', minute: '2-digit'
      });
      const userName = userNames[s.user_id];
      const peak = peakNames[s.peak_id];

      // Datums-Trenner
      if (datum !== lastDate) {
        html += '<div style="font-size: 0.75rem; color: var(--color-muted); text-transform: uppercase; letter-spacing: 1px; margin: 0.75rem 0 0.25rem; font-family: var(--font-mono);">' + datum + '</div>';
        lastDate = datum;
      }

      html += `
        <div style="display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0; border-bottom: 1px solid var(--color-border);">
          <div style="width: 32px; height: 32px; background: var(--color-bg-hover); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 600; color: var(--color-gold); flex-shrink: 0;">
            ${userName.charAt(0).toUpperCase()}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.85rem;">
              <strong>${userName}</strong> hat
              <strong style="color: var(--color-gold);">${peak.name}</strong> bestiegen
            </div>
            <div style="font-size: 0.75rem; color: var(--color-muted);">
              ${peak.elevation} m · ${zeit} Uhr · +${s.points} Pkt
            </div>
          </div>
          <div style="font-size: 1.1rem; flex-shrink: 0;">⛰️</div>
        </div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    console.error('Fehler beim Laden des Feeds:', err);
    container.innerHTML = '<p class="text-muted">Feed konnte nicht geladen werden.</p>';
  }
}

// Global verfügbar machen
window.loadFeed = loadFeed;
