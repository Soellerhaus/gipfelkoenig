/**
 * Bergkönig — Spiel-Logik
 * Punkte-Berechnung, Besitz, Abzeichen, Rangliste
 */

window.GK = window.GK || {};

window.GK.game = (() => {
  'use strict';

  // --- Ritter-Ränge ---

  const KNIGHT_RANKS = [
    { peaks: 200, crowns: 20, name: 'Bergkönig', icon: '👑' },
    { peaks: 100, crowns: 10, name: 'Herzog',     icon: '💎' },
    { peaks: 50,  crowns: 5,  name: 'Graf',       icon: '🦅' },
    { peaks: 30,  crowns: 3,  name: 'Baron',      icon: '🏰' },
    { peaks: 15,  crowns: 1,  name: 'Ritter',     icon: '⚔️' },
    { peaks: 5,   crowns: 0,  name: 'Bergsteiger', icon: '⛰️' },
    { peaks: 1,   crowns: 0,  name: 'Wanderer',   icon: '🥾' },
  ];

  /**
   * Rang basierend auf Gipfel-Anzahl und Kronen ermitteln.
   * @param {number} peakCount - Anzahl verschiedener bestiegener Gipfel
   * @param {number} crownCount - Anzahl gehaltener Kronen
   * @returns {{ name: string, icon: string, next: object|null, peaksNeeded: number, crownsNeeded: number }}
   */
  function getRank(peakCount, crownCount) {
    let currentRank = { name: 'Neuling', icon: '🏔️' };
    let currentIdx = -1;

    for (let i = 0; i < KNIGHT_RANKS.length; i++) {
      const r = KNIGHT_RANKS[i];
      if (peakCount >= r.peaks && crownCount >= r.crowns) {
        currentRank = r;
        currentIdx = i;
        break;
      }
    }

    // Nächster Rang
    let nextRank = null;
    let peaksNeeded = 0;
    let crownsNeeded = 0;

    if (currentIdx > 0) {
      nextRank = KNIGHT_RANKS[currentIdx - 1];
      peaksNeeded = Math.max(0, nextRank.peaks - peakCount);
      crownsNeeded = Math.max(0, nextRank.crowns - crownCount);
    } else if (currentIdx === -1) {
      // Noch kein Rang
      nextRank = KNIGHT_RANKS[KNIGHT_RANKS.length - 1]; // Wanderer
      peaksNeeded = Math.max(0, nextRank.peaks - peakCount);
      crownsNeeded = 0;
    }

    return {
      name: currentRank.name,
      icon: currentRank.icon,
      next: nextRank,
      peaksNeeded,
      crownsNeeded,
    };
  }

  // --- Abzeichen-Definitionen ---

  const BADGE_TYPES = {
    king_end:   { emoji: '👑', label: 'Saisonkönig/in',      description: 'Meiste Besteigungen am Saisonende' },
    pioneer:    { emoji: '⭐', label: 'Pionier',           description: 'Erster Gipfelbesuch der Saison' },
    rare:       { emoji: '💎', label: 'Selten',            description: 'Gipfel mit weniger als 5 Besuchen insgesamt' },
    combo:      { emoji: '🔥', label: 'Combo',             description: '3+ Gipfel an einem Tag' },
    streak:     { emoji: '⚡', label: 'Streak',            description: '7 Tage am Stück aktiv' },
    early_bird: { emoji: '🌅', label: 'Frühaufsteher',     description: 'Tour vor 07:00 Uhr gestartet' },
    sunset:     { emoji: '🌄', label: 'Sonnenuntergang',   description: 'Gipfel nach 19:00 Uhr erreicht' },
    night_owl:  { emoji: '🦉', label: 'Nachtwanderer',     description: 'Gipfel nach 20:00 Uhr erreicht' },
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
  /**
   * Einheitliche Punkte-Berechnung (muss überall gleich sein!)
   * Base = Math.round(elevation_gain / 100) + Math.round(distance_km) + 10
   * Pionier (Saison-Erster) = x3
   * Erstbesuch (Persönlich-Erster) = x2
   * Wiederholung = x0.5
   * Frühaufsteher (Tour vor 07:00) = +15
   * Combo (2+ Gipfel/Tag) = +50% pro Extra-Gipfel
   */
  function calculatePoints(peak, isPersonalFirst, isSeasonFirst, combo, options) {
    const opts = options || {};
    const elevGain = opts.elevation_gain || peak.elevation || 1000;
    const distKm = opts.distance_km || 0;

    // Basis-Punkte
    let basePts = Math.round(elevGain / 100) + Math.round(distKm) + 10;

    // Multiplikator je nach Besuchstyp
    let points;
    if (isSeasonFirst) {
      points = Math.round(basePts * 3);   // Pionier: Erster diese Saison
    } else if (isPersonalFirst) {
      points = Math.round(basePts * 2);   // Erstbesuch: Persönlich erster Besuch
    } else {
      points = Math.round(basePts * 0.5); // Wiederholung
    }

    // Frühaufsteher Bonus (Tour vor 07:00)
    if (opts.earlyBird) {
      points += 15;
    }

    // Combo Bonus (2+ Gipfel am selben Tag): +50% pro Extra-Gipfel
    if (combo && typeof combo === 'number' && combo > 1) {
      points = Math.round(points * (1 + 0.5 * (combo - 1)));
    }

    return Math.round(points);
  }

  // --- Regionen-Mapping ---

  const REGION_NAMES = {
    'AT-02': 'Kärnten',
    'AT-05': 'Salzburg',
    'AT-06': 'Steiermark',
    'AT-07': 'Tirol',
    'AT-08': 'Vorarlberg',
    'DE-BY': 'Bayern',
    'CH':    'Schweiz',
    'FR':    'Frankreich',
    'ALPEN': 'Alpenregion'
  };

  // Sub-Regionen werden aus regions.js geladen (ALPINE_SUB_REGIONS)
  // Abwärtskompatibilität: SUB_REGIONS als Alias
  const SUB_REGIONS = window.ALPINE_SUB_REGIONS || [];

  // --- Avatar-Emojis ---
  const AVATAR_EMOJIS = {
    'mountain': '🏔️', 'eagle': '🦅', 'ski': '⛷️', 'climber': '🧗',
    'tree': '🌲', 'snow': '❄️', 'deer': '🦌', 'rock': '🪨'
  };

  // --- Rangliste ---

  // Cache für User-Peaks mit Koordinaten (für Sub-Region-Filterung)
  let cachedUserPeaks = null;
  let activeRegion = null;
  let activeSubRegion = null;
  let activeSeason = getCurrentSeason();

  /**
   * Regionale Rangliste laden und im DOM rendern.
   * Zeigt nur Regionen in denen der aktuelle User Gipfel hat.
   * Zweite Reihe: Sub-Regionen basierend auf Lat/Lng-Bereichen.
   */
  async function loadLeaderboard() {
    const container = document.getElementById('section-leaderboard');
    if (!container) return;

    const season = activeSeason;
    const listEl = document.getElementById('leaderboard-list');
    const tabsEl = document.getElementById('leaderboard-tabs');
    const subTabsEl = document.getElementById('leaderboard-subtabs');
    if (!listEl || !tabsEl) return;

    // Saison-Wähler einrichten
    const seasonSelector = document.getElementById('season-selector');
    if (seasonSelector) {
      seasonSelector.querySelectorAll('.season-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          seasonSelector.querySelectorAll('.season-btn').forEach(b => {
            b.classList.remove('active');
            b.style.border = '1px solid rgba(201,168,76,0.3)';
            b.style.background = 'rgba(255,255,255,0.05)';
            b.style.color = 'var(--color-muted)';
            b.style.fontWeight = '400';
          });
          btn.classList.add('active');
          btn.style.border = '1px solid var(--color-gold)';
          btn.style.background = 'rgba(201,168,76,0.2)';
          btn.style.color = 'var(--color-gold)';
          btn.style.fontWeight = '700';
          activeSeason = btn.dataset.season;
          await loadLeaderboard();
        });
      });
    }

    listEl.innerHTML = '<div class="loading">Lade Rangliste...</div>';
    activeRegion = null;
    activeSubRegion = null;

    // Aktuelle User-Regionen und Peaks mit Koordinaten ermitteln
    let userRegions = new Set();
    let userSubRegions = new Set();
    cachedUserPeaks = [];

    try {
      // ALLE aktiven Regionen laden (nicht nur User-eigene) damit Tabs sichtbar sind
      const { data: allSummits } = await GK.supabase
        .from('summits')
        .select('peak_id')
        .eq('season', season)
        .limit(500);

      if (allSummits && allSummits.length > 0) {
        const peakIds = [...new Set(allSummits.map(s => s.peak_id))].filter(id => id != null);
        // PERFORMANCE: Batches PARALLEL holen statt sequenziell.
        // Vorher: 3-5 sequenzielle Queries (~500ms each = 2-3s).
        const batchSize = 100;
        const batches = [];
        for (let i = 0; i < peakIds.length; i += batchSize) {
          batches.push(peakIds.slice(i, i + batchSize));
        }
        const results = await Promise.all(batches.map(batch =>
          GK.supabase.from('peaks').select('id, osm_region, lat, lng').in('id', batch)
            .then(({ data }) => data || [])
            .catch(() => [])
        ));
        const allPeaks = results.flat();

        cachedUserPeaks = allPeaks;
        for (const p of allPeaks) {
          if (p.osm_region && p.osm_region !== 'ALPEN' && REGION_NAMES[p.osm_region]) {
            userRegions.add(p.osm_region);
          }
          if (p.lat && p.lng && typeof window.getSubRegion === 'function') {
            const sr = window.getSubRegion(p.lat, p.lng);
            if (sr) userSubRegions.add(sr.id);
          }
        }
      }
    } catch (err) {
      console.warn('Regionen konnten nicht geladen werden:', err);
    }

    // Tab-Buttons dynamisch erstellen (Reihe 1: Regionen)
    tabsEl.innerHTML = '';

    // "Alle Alpen" immer als erster Tab
    const allBtn = document.createElement('button');
    allBtn.className = 'tab active';
    allBtn.dataset.region = 'all';
    allBtn.textContent = 'Alle Alpen';
    allBtn.addEventListener('click', () => switchRegionTab(null, allBtn));
    tabsEl.appendChild(allBtn);

    // Regions-Tabs nur fuer Regionen des Users
    for (const regionCode of userRegions) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.region = regionCode;
      btn.textContent = REGION_NAMES[regionCode];
      btn.addEventListener('click', () => switchRegionTab(regionCode, btn));
      tabsEl.appendChild(btn);
    }

    // Sub-Region Tabs initial ausblenden
    if (subTabsEl) subTabsEl.innerHTML = '';

    // Erste Region laden (Alle Alpen)
    await fetchAndRenderLeaderboard(null, season, listEl);

    /**
     * Region-Tab wechseln (Reihe 1)
     */
    async function switchRegionTab(region, activeBtn) {
      tabsEl.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');
      activeRegion = region;
      activeSubRegion = null;

      // Sub-Region Tabs für diese Region anzeigen
      if (subTabsEl) {
        subTabsEl.innerHTML = '';
        if (region) {
          const relevantSubs = SUB_REGIONS.filter(sr => sr.parent === region && userSubRegions.has(sr.id));
          if (relevantSubs.length > 0) {
            // "Alle" Button für die Region
            const allSubBtn = document.createElement('button');
            allSubBtn.className = 'tab active';
            allSubBtn.style.cssText = 'font-size:0.7rem;padding:3px 8px;';
            allSubBtn.textContent = 'Alle ' + REGION_NAMES[region];
            allSubBtn.addEventListener('click', () => switchSubRegionTab(null, allSubBtn));
            subTabsEl.appendChild(allSubBtn);

            for (const sr of relevantSubs) {
              const subBtn = document.createElement('button');
              subBtn.className = 'tab';
              subBtn.style.cssText = 'font-size:0.7rem;padding:3px 8px;';
              subBtn.textContent = sr.name;
              subBtn.addEventListener('click', () => switchSubRegionTab(sr, subBtn));
              subTabsEl.appendChild(subBtn);
            }
          }
        }
      }

      await fetchAndRenderLeaderboard(region, season, listEl);
    }

    /**
     * Sub-Region-Tab wechseln (Reihe 2)
     */
    async function switchSubRegionTab(subRegion, activeBtn) {
      if (subTabsEl) {
        subTabsEl.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      }
      activeBtn.classList.add('active');
      activeSubRegion = subRegion;
      await fetchAndRenderLeaderboard(activeRegion, season, listEl, subRegion);
    }
  }

  /**
   * Ranglisten-Daten abrufen und als Zeilen rendern.
   * Optional: Sub-Region-Filter basierend auf Lat/Lng-Bereichen.
   */
  async function fetchAndRenderLeaderboard(region, season, listEl, subRegion) {
    listEl.innerHTML = '<div class="loading">Lade Rangliste...</div>';

    try {
      const data = await GK.api.getLeaderboard(region, season, 50);
      listEl.innerHTML = '';

      if (!data || data.length === 0) {
        listEl.innerHTML = '<div class="empty" style="text-align:center;padding:2rem;color:var(--color-muted);">Noch keine Einträge für diese Saison.</div>';
        return;
      }

      // Bei Sub-Region: Summits pro User laden und filtern
      let filteredData = data;
      if (subRegion) {
        // Für jeden User prüfen ob er Gipfel in dieser Sub-Region hat
        const usersWithSubRegionSummits = [];
        for (const entry of data) {
          const { data: userSummits } = await GK.supabase
            .from('summits')
            .select('peak_id')
            .eq('user_id', entry.id);

          if (userSummits && userSummits.length > 0) {
            const peakIds = [...new Set(userSummits.map(s => s.peak_id))];
            const { data: peaks } = await GK.supabase
              .from('peaks')
              .select('id, lat, lng')
              .in('id', peakIds);

            if (peaks) {
              const subRegionPeaks = peaks.filter(p =>
                p.lat && p.lng &&
                p.lat >= subRegion.latMin && p.lat <= subRegion.latMax &&
                p.lng >= subRegion.lngMin && p.lng <= subRegion.lngMax
              );
              if (subRegionPeaks.length > 0) {
                entry.sub_summit_count = subRegionPeaks.length;
                usersWithSubRegionSummits.push(entry);
              }
            }
          }
        }
        filteredData = usersWithSubRegionSummits;
      }

      if (filteredData.length === 0) {
        listEl.innerHTML = '<div class="empty" style="text-align:center;padding:2rem;color:var(--color-muted);">Noch keine Einträge in dieser Region.</div>';
        return;
      }

      filteredData.forEach((entry, idx) => {
        const rank = idx + 1;
        let rankIcon = '';
        if (rank === 1) rankIcon = '👑 ';
        else if (rank === 2) rankIcon = '🥈 ';
        else if (rank === 3) rankIcon = '🥉 ';

        const avatar = (entry.avatar_type ? AVATAR_EMOJIS[entry.avatar_type] : null) || entry.username?.charAt(0).toUpperCase() || '?';
        const crowns = entry.crown_count || 0;
        const summitCount = subRegion ? (entry.sub_summit_count || 0) : (entry.summit_count || 0);

        // Rang ermitteln
        const userRank = getRank(summitCount, crowns);
        const rankBadge = userRank.icon + ' ' + userRank.name;

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
              <span style="font-size:0.7rem;color:var(--color-gold);margin-left:4px;">${rankBadge}</span>
            </div>
            <div style="font-size:0.7rem;color:var(--color-muted);">
              ${summitCount} Gipfel${crowns > 0 ? ' · ' + crowns + ' 👑' : ''}
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
    // Direkt aus summits-Tabelle berechnen (user_season_stats existiert nicht)
    const { data: summits, error } = await GK.supabase
      .from('summits')
      .select('points, peak_id')
      .eq('user_id', userId)
      .eq('season', getCurrentSeason());

    if (error) {
      console.warn('Benutzerstatistik nicht gefunden:', error.message);
      return { total_points: 0, summit_count: 0 };
    }

    const total_points = (summits || []).reduce((sum, s) => sum + (s.points || 0), 0);
    const summit_count = new Set((summits || []).map(s => s.peak_id)).size;
    return { total_points, summit_count };
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
    KNIGHT_RANKS,
    SUB_REGIONS,
    ALPINE_SUB_REGIONS: SUB_REGIONS,
    getCurrentSeason,
    calculatePoints,
    getRank,
    getSubRegion: window.getSubRegion,
    getSubRegionsForParent: window.getSubRegionsForParent,
    loadLeaderboard,
    loadProfile,
  };
})();
