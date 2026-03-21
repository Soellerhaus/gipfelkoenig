/**
 * Gipfelkönig — Spiel-Logik
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
  function calculatePoints(peak, isPersonalFirst, isSeasonFirst, combo) {
    let points = peak.elevation || 1000;

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
      points += 500;
    }

    // Heimat-Bonus Vorarlberg
    if (peak.osm_region === 'AT-08') {
      points += 100;
    }

    return Math.round(points);
  }

  // --- Rangliste ---

  /**
   * Rangliste laden und im DOM rendern
   * Wird in #section-leaderboard angezeigt
   */
  async function loadLeaderboard() {
    const container = document.getElementById('section-leaderboard');
    if (!container) return;

    const season = getCurrentSeason();

    // Tab-Konfiguration: Region-Filter
    const tabs = [
      { id: 'tab-kleinwalsertal', label: 'Kleinwalsertal', region: 'kleinwalsertal' },
      { id: 'tab-alle',           label: 'Alle Alpen',     region: null },
    ];

    // Tab-Leiste rendern
    let tabBar = container.querySelector('.leaderboard-tabs');
    if (!tabBar) {
      tabBar = document.createElement('div');
      tabBar.className = 'leaderboard-tabs';
      tabs.forEach((tab, idx) => {
        const btn = document.createElement('button');
        btn.id = tab.id;
        btn.className = 'leaderboard-tab' + (idx === 0 ? ' active' : '');
        btn.textContent = tab.label;
        btn.addEventListener('click', () => switchTab(tab.region, btn));
        tabBar.appendChild(btn);
      });
      container.prepend(tabBar);
    }

    // Inhaltsbereich
    let listEl = container.querySelector('.leaderboard-list');
    if (!listEl) {
      listEl = document.createElement('div');
      listEl.className = 'leaderboard-list';
      container.appendChild(listEl);
    }

    // Erste Region laden
    await fetchAndRenderLeaderboard(tabs[0].region, season, listEl);

    /**
     * Tab wechseln und Daten neu laden
     */
    async function switchTab(region, activeBtn) {
      // Aktiven Tab markieren
      tabBar.querySelectorAll('.leaderboard-tab').forEach(b => b.classList.remove('active'));
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
      const data = await GK.api.getLeaderboard(region, season, 10);
      listEl.innerHTML = '';

      if (!data || data.length === 0) {
        listEl.innerHTML = '<div class="empty">Noch keine Einträge für diese Saison.</div>';
        return;
      }

      data.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.className = 'leaderboard-row';
        row.innerHTML = `
          <span class="rank">${idx + 1}</span>
          <span class="name">${escapeHtml(entry.display_name || 'Anonym')}</span>
          <span class="points">${entry.total_points || 0} Pkt.</span>
          <span class="summits">${entry.summit_count || 0} Gipfel</span>
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
