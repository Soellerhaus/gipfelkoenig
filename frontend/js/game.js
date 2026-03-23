/**
 * Bergkönig — Spiel-Logik
 * Punkte-Berechnung, Besitz, Abzeichen, Rangliste
 */

window.GK = window.GK || {};

window.GK.game = (() => {
  'use strict';

  // --- Abzeichen-Definitionen ---

  const BADGE_TYPES = {
    king_end:   { emoji: '👑', label: 'Saisonkönig/in',      description: 'Meiste Besteigungen am Saisonende' },
    pioneer:    { emoji: '⭐', label: 'Pionier',           description: 'Erster Gipfelbesuch der Saison' },
    rare:       { emoji: '💎', label: 'Selten',            description: 'Gipfel mit weniger als 5 Besuchen insgesamt' },
    combo:      { emoji: '🔥', label: 'Combo',             description: '3+ Gipfel an einem Tag' },
    streak:     { emoji: '⚡', label: 'Streak',            description: '7 Tage am Stück aktiv' },
    early_bird: { emoji: '🌅', label: 'Frühaufsteher',     description: 'Gipfel vor 07:00 Uhr erreicht' },
    sunset:     { emoji: '🌄', label: 'Sonnenuntergang',   description: 'Gipfel nach 19:00 Uhr erreicht' },
    night_owl:  { emoji: '🦉', label: 'Nachtwanderer',     description: 'Gipfel nach 21:00 Uhr erreicht' },
  };

  // --- Hilfsfunktionen ---

  /**
   * Aktuelle Saison ermitteln (= aktuelles Jahr als String)
   */
  function getCurrentSeason() {
    return new Date().getFullYear().toString();
  }

  /**
   * Punkte-Berechnung (Client-seitige Spiegelung der Server-Logik)
   *
   * @param {Object}  peak            - Gipfel-Objekt mit elevation, osm_region etc.
   * @param {boolean} isPersonalFirst - Erster persönlicher Besuch dieses Gipfels
   * @param {boolean} isSeasonFirst   - Erster Besuch dieser Saison (überhaupt)
   * @param {boolean} combo           - Teil einer Mehrfach-Gipfel-Tour
   * @returns {number} Berechnete Punkte (gerundet)
   */
  // Punkte-Berechnung: Gipfel = HM/100, Pässe/Hütten/Scharten = 2 Punkte fix
  function calculatePoints(peak, isPersonalFirst, isSeasonFirst, combo) {
    const difficulty = peak.difficulty || 'T2';
    let points;

    // Feste Punkte für POIs, HM-basiert für Gipfel
    if (difficulty === 'pass' || difficulty === 'hut' || difficulty === 'saddle') {
      points = 2;
    } else {
      points = Math.round((peak.elevation || 1000) / 100);
    }

    // Multiplikator je nach Besuchstyp
    if (isSeasonFirst) {
      points *= 3;          // Erster diese Saison
    } else if (isPersonalFirst) {
      points *= 1.5;        // Persönlich erster Besuch
    } else {
      points *= 0.2;        // Wiederholung
    }

    // Bonus für Mehrfach-Gipfel-Tour
    if (combo) {
      points += 5;
    }

    // Heimat-Bonus Vorarlberg
    if (peak.osm_region === 'AT-08') {
      points += 1;
    }

    return Math.round(points);
  }

  // --- Regionen-Mapping ---

  const REGION_NAMES = {
    'AT-08': 'Vorarlberg',
    'AT-07': 'Tirol',
    'AT-05': 'Salzburg',
    'DE-BY': 'Bayern/Allgäu',
    'CH-GR': 'Graubünden',
    'CH-VS': 'Wallis',
    'IT-32': 'Südtirol',
    'IT-25': 'Lombardei'
  };

  // --- Rangliste ---

  /**
   * Regionale Rangliste laden und im DOM rendern.
   * Zeigt nur Regionen in denen der aktuelle User Gipfel hat.
   */
  async function loadLeaderboard() {
    const container = document.getElementById('section-leaderboard');
    if (!container) return;

    const season = getCurrentSeason();
    const listEl = document.getElementById('leaderboard-list');
    const tabsEl = document.getElementById('leaderboard-tabs');
    if (!listEl || !tabsEl) return;

    listEl.innerHTML = '<div class="loading">Lade Rangliste...</div>';

    // Aktuelle User-Regionen ermitteln
    let userRegions = new Set();
    try {
      const user = GK.auth?.user;
      if (user) {
        const { data: userSummits } = await GK.supabase
          .from('summits')
          .select('peak_id')
          .eq('user_id', user.id);

        if (userSummits && userSummits.length > 0) {
          const peakIds = [...new Set(userSummits.map(s => s.peak_id))];
          const { data: peaks } = await GK.supabase
            .from('peaks')
            .select('id, osm_region')
            .in('id', peakIds);

          if (peaks) {
            for (const p of peaks) {
              if (p.osm_region && REGION_NAMES[p.osm_region]) {
                userRegions.add(p.osm_region);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Regionen konnten nicht geladen werden:', err);
    }

    // Tab-Buttons dynamisch erstellen
    tabsEl.innerHTML = '';

    // "Alle Alpen" immer als erster Tab
    const allBtn = document.createElement('button');
    allBtn.className = 'tab active';
    allBtn.dataset.region = 'all';
    allBtn.textContent = 'Alle Alpen';
    allBtn.addEventListener('click', () => switchTab(null, allBtn));
    tabsEl.appendChild(allBtn);

    // Regions-Tabs nur fuer Regionen des Users
    for (const regionCode of userRegions) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.region = regionCode;
      btn.textContent = REGION_NAMES[regionCode];
      btn.addEventListener('click', () => switchTab(regionCode, btn));
      tabsEl.appendChild(btn);
    }

    // Erste Region laden (Alle Alpen)
    await fetchAndRenderLeaderboard(null, season, listEl);

    async function switchTab(region, activeBtn) {
      tabsEl.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');
      await fetchAndRenderLeaderboard(region, season, listEl);
    }
  }

  /**
   * Ranglisten-Daten abrufen und als Zeilen rendern
   */
  async function fetchAndRenderLeaderboard(region, season, listEl) {
    listEl.innerHTML = '<div class="loading">Lade Rangliste...</div>';

    try {
      const data = await GK.api.getLeaderboard(region, season, 20);
      listEl.innerHTML = '';

      if (!data || data.length === 0) {
        listEl.innerHTML = '<div class="empty" style="text-align:center;padding:2rem;color:var(--color-muted);">Noch keine Einträge für diese Saison.</div>';
        return;
      }

      data.forEach((entry, idx) => {
        const rank = idx + 1;
        let rankIcon = '';
        if (rank === 1) rankIcon = '👑 ';
        else if (rank === 2) rankIcon = '🥈 ';
        else if (rank === 3) rankIcon = '🥉 ';

        const avatar = entry.avatar_emoji || entry.username?.charAt(0).toUpperCase() || '?';
        const crowns = entry.crown_count || 0;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:0.6rem;padding:0.6rem 0;border-bottom:1px solid var(--color-border);';
        row.innerHTML = `
          <div style="min-width:28px;text-align:center;font-weight:700;font-family:var(--font-mono);font-size:0.85rem;color:${rank <= 3 ? 'var(--color-gold)' : 'var(--color-muted)'};">
            ${rankIcon}${rank}
          </div>
          <div style="width:32px;height:32px;background:var(--color-bg-hover);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.9rem;flex-shrink:0;">
            ${avatar}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(entry.username || entry.display_name || 'Anonym')}
            </div>
            <div style="font-size:0.7rem;color:var(--color-muted);">
              ${entry.summit_count || 0} Gipfel${crowns > 0 ? ' · ' + crowns + ' 👑' : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:1rem;font-weight:700;color:var(--color-gold);font-family:var(--font-mono);">${(entry.total_points || 0).toLocaleString('de')}</div>
            <div style="font-size:0.6rem;color:var(--color-muted);">Pkt</div>
          </div>
        `;
        listEl.appendChild(row);
      });
    } catch (err) {
      console.error('Fehler beim Laden der Rangliste:', err);
      listEl.innerHTML = '<div class="error">Rangliste konnte nicht geladen werden.</div>';
    }
  }

  // --- Profil ---

  /**
   * Profil-Bereich laden und im DOM rendern
   * Wird in #section-profile angezeigt
   */
  async function loadProfile() {
    const container = document.getElementById('section-profile');
    if (!container) return;

    const user = GK.auth?.user;
    if (!user) {
      container.innerHTML = '<div class="info">Bitte einloggen, um dein Profil zu sehen.</div>';
      return;
    }

    container.innerHTML = '<div class="loading">Lade Profil...</div>';

    try {
      // Benutzerdaten parallel laden
      const [profile, badges, crowns] = await Promise.all([
        fetchUserStats(user.id),
        fetchUserBadges(user.id),
        fetchCrownCount(user.id),
      ]);

      container.innerHTML = '';

      // Statistik-Bereich
      const statsEl = document.createElement('div');
      statsEl.className = 'profile-stats';
      statsEl.innerHTML = `
        <div class="stat">
          <span class="stat-value">${profile.total_points || 0}</span>
          <span class="stat-label">Punkte</span>
        </div>
        <div class="stat">
          <span class="stat-value">${profile.summit_count || 0}</span>
          <span class="stat-label">Gipfel</span>
        </div>
        <div class="stat">
          <span class="stat-value">${crowns}</span>
          <span class="stat-label">Kronen</span>
        </div>
      `;
      container.appendChild(statsEl);

      // Abzeichen-Bereich
      const badgesEl = document.createElement('div');
      badgesEl.className = 'profile-badges';

      if (badges.length === 0) {
        badgesEl.innerHTML = '<div class="empty">Noch keine Abzeichen verdient.</div>';
      } else {
        const heading = document.createElement('h3');
        heading.textContent = 'Abzeichen';
        badgesEl.appendChild(heading);

        badges.forEach(badge => {
          const info = BADGE_TYPES[badge.badge_type];
          if (!info) return;

          const el = document.createElement('div');
          el.className = 'badge';
          el.innerHTML = `
            <span class="badge-emoji">${info.emoji}</span>
            <span class="badge-label">${info.label}</span>
            <span class="badge-count">${badge.count > 1 ? 'x' + badge.count : ''}</span>
          `;
          el.title = info.description;
          badgesEl.appendChild(el);
        });
      }

      container.appendChild(badgesEl);
    } catch (err) {
      console.error('Fehler beim Laden des Profils:', err);
      container.innerHTML = '<div class="error">Profil konnte nicht geladen werden.</div>';
    }
  }

  /**
   * Benutzer-Statistiken aus der Datenbank laden
   */
  async function fetchUserStats(userId) {
    const { data, error } = await GK.supabase
      .from('user_season_stats')
      .select('total_points, summit_count')
      .eq('user_id', userId)
      .eq('season', getCurrentSeason())
      .single();

    if (error) {
      console.warn('Benutzerstatistik nicht gefunden:', error.message);
      return { total_points: 0, summit_count: 0 };
    }
    return data;
  }

  /**
   * Abzeichen des Benutzers laden
   */
  async function fetchUserBadges(userId) {
    const { data, error } = await GK.supabase
      .from('badges')
      .select('badge_type, count')
      .eq('user_id', userId);

    if (error) {
      console.warn('Abzeichen konnten nicht geladen werden:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Anzahl der Kronen (Besitz-Einträge) des Benutzers zählen
   */
  async function fetchCrownCount(userId) {
    const { count, error } = await GK.supabase
      .from('ownership')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.warn('Kronen konnten nicht gezählt werden:', error.message);
      return 0;
    }
    return count || 0;
  }

  // --- Hilfsfunktionen ---

  /**
   * HTML-Zeichen escapen (XSS-Schutz)
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Öffentliche API ---

  return {
    BADGE_TYPES,
    getCurrentSeason,
    calculatePoints,
    loadLeaderboard,
    loadProfile,
  };
})();
