// =============================================================================
// Bergkönig — Authentifizierungs-Modul (auth.js)
// Login, Registrierung, Strava-OAuth und Sitzungsverwaltung.
// =============================================================================

window.GK = window.GK || {};

// ---------------------------------------------------------------------------
// Strava OAuth — Platzhalter-Konfiguration
// ---------------------------------------------------------------------------
const STRAVA_CLIENT_ID = '211591';
const STRAVA_CLIENT_SECRET = '7a7f59b117e1ec641cd49803eb2ea7ee40ff40f0';
const STRAVA_REDIRECT_URI = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'app.html';
const STRAVA_AUTH_URL =
  'https://www.strava.com/oauth/authorize' +
  '?client_id=' + STRAVA_CLIENT_ID +
  '&redirect_uri=' + encodeURIComponent(STRAVA_REDIRECT_URI) +
  '&response_type=code' +
  '&scope=read,activity:read_all';

// ---------------------------------------------------------------------------
// Hilfsfunktionen für UI-Meldungen
// ---------------------------------------------------------------------------

/** Fehlermeldung anzeigen */
function zeigeAuthFehler(nachricht) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = nachricht;
  el.style.display = 'block';
  // Erfolgsmeldung ausblenden
  const ok = document.getElementById('auth-success');
  if (ok) ok.style.display = 'none';
}

/** Erfolgsmeldung anzeigen */
function zeigeAuthErfolg(nachricht) {
  const el = document.getElementById('auth-success');
  if (!el) return;
  el.textContent = nachricht;
  el.style.display = 'block';
  // Fehlermeldung ausblenden
  const err = document.getElementById('auth-error');
  if (err) err.style.display = 'none';
}

/** Beide Meldungen ausblenden */
function versteckeMeldungen() {
  const err = document.getElementById('auth-error');
  const ok = document.getElementById('auth-success');
  if (err) err.style.display = 'none';
  if (ok) ok.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Landing-Page-Logik (index.html)
// ---------------------------------------------------------------------------

function initLandingPage() {
  const formular = document.getElementById('auth-form');
  const toggleBtns = document.querySelectorAll('.auth-toggle-btn');
  const submitBtn = document.getElementById('auth-submit');
  const stravaBtn = document.getElementById('strava-connect');
  const usernameGroup = document.getElementById('username-group');

  // Aktueller Modus: 'login' oder 'register'
  let modus = 'login';

  // Zwischen Anmelden und Registrieren umschalten
  toggleBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      versteckeMeldungen();
      modus = btn.getAttribute('data-mode');

      // Aktive Klasse umschalten
      toggleBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      if (modus === 'register') {
        if (submitBtn) submitBtn.textContent = 'Registrieren';
        if (usernameGroup) usernameGroup.style.display = 'block';
      } else {
        if (submitBtn) submitBtn.textContent = 'Anmelden';
        if (usernameGroup) usernameGroup.style.display = 'none';
      }
    });
  });

  // Formular absenden — Anmelden oder Registrieren
  if (formular) {
    formular.addEventListener('submit', async function (e) {
      e.preventDefault();
      versteckeMeldungen();

      const email = document.getElementById('email').value.trim();
      const passwort = document.getElementById('password').value;

      if (!email || !passwort) {
        zeigeAuthFehler('Bitte E-Mail und Passwort eingeben.');
        return;
      }

      if (modus === 'login') {
        // --- Anmelden ---
        try {
          const { data, error } = await GK.supabase.auth.signInWithPassword({
            email: email,
            password: passwort,
          });

          if (error) throw error;

          // Erfolgreich angemeldet — weiterleiten
          window.location.href = 'app.html';
        } catch (err) {
          console.error('Anmeldefehler:', err);
          zeigeAuthFehler(err.message || 'Anmeldung fehlgeschlagen.');
        }
      } else {
        // --- Registrieren ---
        const benutzername = document.getElementById('username')
          ? document.getElementById('username').value.trim()
          : '';

        if (!benutzername) {
          zeigeAuthFehler('Bitte einen Benutzernamen eingeben.');
          return;
        }

        try {
          const { data, error } = await GK.supabase.auth.signUp({
            email: email,
            password: passwort,
          });

          if (error) throw error;

          // Benutzerprofil in der Datenbank anlegen
          if (data.user) {
            const { error: profilFehler } = await GK.supabase
              .from('user_profiles')
              .insert({
                id: data.user.id,
                username: benutzername,
              });

            if (profilFehler) {
              console.error('Fehler beim Erstellen des Profils:', profilFehler);
            }
          }

          // Direkt weiterleiten (E-Mail-Bestätigung ist deaktiviert)
          if (data.session) {
            window.location.href = 'app.html';
          } else {
            zeigeAuthErfolg('Registrierung erfolgreich! Bitte melde dich an.');
          }
        } catch (err) {
          console.error('Registrierungsfehler:', err);
          zeigeAuthFehler(err.message || 'Registrierung fehlgeschlagen.');
        }
      }
    });
  }

  // Strava-Verbindung — Erst prüfen ob eingeloggt, dann weiterleiten
  if (stravaBtn) {
    stravaBtn.addEventListener('click', async function () {
      // Prüfen ob bereits eingeloggt
      const { data: session } = await GK.supabase.auth.getSession();
      if (session.session) {
        // Bereits eingeloggt — direkt zu Strava
        window.location.href = STRAVA_AUTH_URL;
        return;
      }
      // Nicht eingeloggt — Hinweis zeigen
      zeigeAuthFehler('Bitte zuerst registrieren oder anmelden, dann Strava verbinden.');
    });
  }
}

// ---------------------------------------------------------------------------
// App-Seiten-Logik (app.html)
// ---------------------------------------------------------------------------

async function initAppPage() {
  // Sitzung prüfen — nicht angemeldet? Zurück zur Startseite.
  const { data: sitzung } = await GK.supabase.auth.getSession();

  if (!sitzung.session) {
    window.location.href = 'index.html';
    return;
  }

  const benutzer = sitzung.session.user;

  // Benutzerprofil laden und in der Kopfzeile anzeigen
  const profil = await GK.api.getUserProfile(benutzer.id);
  if (profil) {
    const nameEl = document.getElementById('user-avatar');
    const punkteEl = document.getElementById('user-points');
    if (nameEl) nameEl.textContent = (profil.username || 'B').charAt(0).toUpperCase();
    if (punkteEl) punkteEl.textContent = (profil.total_points || 0).toLocaleString('de') + ' Pkt';

    // Laufenden Import erkennen (bei Seiten-Reload während Import)
    if (profil.import_status === 'importing' && profil.strava_token) {
      startPagedImport(benutzer.id, profil.strava_token);
    }
  }

  // Strava-OAuth-Callback verarbeiten (Code in URL-Parametern)
  const urlParams = new URLSearchParams(window.location.search);
  const stravaCode = urlParams.get('code');

  if (stravaCode) {
    try {
      console.log('Strava-Code erhalten, tausche gegen Token...');

      // Token-Austausch direkt über Strava API
      const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          code: stravaCode,
          grant_type: 'authorization_code'
        })
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        console.log('Strava-Token erhalten! Athlete:', tokenData.athlete?.firstname);

        // Strava-Daten im Profil speichern
        await GK.supabase
          .from('user_profiles')
          .update({
            strava_id: tokenData.athlete?.id?.toString(),
            strava_token: tokenData.access_token,
            strava_refresh_token: tokenData.refresh_token,
            display_name: tokenData.athlete?.firstname + ' ' + tokenData.athlete?.lastname,
            avatar_url: tokenData.athlete?.profile
          })
          .eq('id', benutzer.id);

        // Avatar aktualisieren
        const avatarEl = document.getElementById('user-avatar');
        if (avatarEl && tokenData.athlete?.profile) {
          avatarEl.innerHTML = '<img src="' + tokenData.athlete.profile + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        }

        // Erfolgs-Toast anzeigen
        if (typeof GK.showToast === 'function') {
          GK.showToast('Strava verbunden! Deine Gipfel werden im Hintergrund importiert...', 'success');
        }

        // Import-Status setzen und starten
        await GK.supabase.from('user_profiles').update({ import_status: 'importing' }).eq('id', benutzer.id);
        console.log('Starte seitenweisen Aktivitäten-Import...');
        startPagedImport(benutzer.id, tokenData.access_token);

        // Nicht warten — User kann sofort die App nutzen
      } else {
        console.error('Strava Token-Fehler:', tokenData);
      }

      // URL bereinigen
      window.history.replaceState({}, document.title, 'app.html');
    } catch (err) {
      console.error('Fehler beim Strava-Callback:', err);
    }
  }

  // Dashboard-Daten laden
  if (profil) {
    const { data: summits } = await GK.supabase
      .from('summits')
      .select('peak_id, points, summited_at, season')
      .eq('user_id', benutzer.id)
      .order('summited_at', { ascending: false });

    if (summits) {
      const totalPoints = summits.reduce((sum, s) => sum + (s.points || 0), 0);
      const uniquePeaks = new Set(summits.map(s => s.peak_id)).size;

      const statPoints = document.getElementById('stat-points');
      const statSummits = document.getElementById('stat-summits');
      const statCrowns = document.getElementById('stat-crowns');

      if (statPoints) statPoints.textContent = totalPoints.toLocaleString('de');
      if (statSummits) statSummits.textContent = uniquePeaks;
      if (statCrowns) statCrowns.textContent = '0';

      // Saison-Statistik
      const currentSeason = new Date().getFullYear().toString();
      const seasonSummits = summits.filter(s => s.season === currentSeason);
      const seasonPts = seasonSummits.reduce((sum, s) => sum + (s.points || 0), 0);
      const seasonUnique = new Set(seasonSummits.map(s => s.peak_id)).size;
      const el = (id) => document.getElementById(id);
      if (el('season-summits')) el('season-summits').textContent = seasonUnique;
      if (el('season-points')) el('season-points').textContent = seasonPts.toLocaleString('de');
      if (el('profile-season-year')) el('profile-season-year').textContent = currentSeason;

      // Letzte 5 Besteigungen
      const recentContainer = document.getElementById('profile-recent-summits');
      if (recentContainer && summits.length > 0) {
        const recent = summits.slice(0, 5);
        const peakIds = [...new Set(recent.map(s => s.peak_id))];
        const peakMap = new Map();
        for (const pid of peakIds) {
          const p = await GK.api.getPeakById(pid);
          if (p) peakMap.set(pid, p);
        }
        recentContainer.innerHTML = recent.map(s => {
          const p = peakMap.get(s.peak_id);
          const name = p ? p.name : '?';
          const elev = p ? p.elevation : '';
          const d = new Date(s.summited_at);
          const dat = d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
          return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--color-border);font-size:0.82rem;">' +
            '<span>' + name + (elev ? ' <span class="text-muted" style="font-size:0.75rem;">' + elev + 'm</span>' : '') + '</span>' +
            '<span class="text-muted">' + dat + '</span></div>';
        }).join('');
      }

      // Rang berechnen
      const { data: allProfiles } = await GK.supabase
        .from('user_profiles')
        .select('id, total_points, username')
        .order('total_points', { ascending: false });
      if (allProfiles) {
        const myRank = allProfiles.findIndex(p => p.id === benutzer.id) + 1;
        const rankEl = document.getElementById('profile-rank');
        const rankDetail = document.getElementById('profile-rank-detail');
        if (rankEl) rankEl.textContent = myRank > 0 ? 'Platz ' + myRank : '—';
        if (rankDetail) rankDetail.textContent = 'von ' + allProfiles.length + ' Bergfreunden';
      }

      // HM berechnen (Summe aller Gipfelhöhen)
      const peakIdsAll = [...new Set(summits.map(s => s.peak_id))];
      let totalHM = 0;
      const seasonPeakIds = new Set(seasonSummits.map(s => s.peak_id));
      let seasonHM = 0;
      for (const pid of peakIdsAll) {
        const p = await GK.api.getPeakById(pid);
        if (p && p.elevation) {
          const count = summits.filter(s => s.peak_id === pid).length;
          totalHM += p.elevation * count;
          const sCount = seasonSummits.filter(s => s.peak_id === pid).length;
          if (sCount > 0) seasonHM += p.elevation * sCount;
        }
      }
      if (el('season-hm')) el('season-hm').textContent = seasonHM.toLocaleString('de');
    }

    // Trophäen aus Summits-Daten berechnen (pro Jahr, 3 Jahre zurück)
    const badgesGrid = document.getElementById('badges-grid');
    if (badgesGrid && summits && summits.length > 0) {
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear - 1, currentYear - 2];

      // Alle Peak-Daten laden für Trophäen-Berechnung
      const allPeakIds = [...new Set(summits.map(s => s.peak_id))];
      const peakCache = new Map();
      for (const pid of allPeakIds) {
        const p = await GK.api.getPeakById(pid);
        if (p) peakCache.set(pid, p);
      }

      let trophyHtml = '';

      for (const year of years) {
        const yearStr = year.toString();
        const yearSummits = summits.filter(s => s.season === yearStr);
        if (yearSummits.length === 0) continue;

        // Pionier: Erst-Besteigungen der Saison
        const pioneerCount = yearSummits.filter(s => s.is_season_first).length;

        // Combo: Tage mit 2+ Gipfeln
        const byDate = {};
        for (const s of yearSummits) {
          const date = s.summited_at.slice(0, 10);
          if (!byDate[date]) byDate[date] = new Set();
          byDate[date].add(s.peak_id);
        }
        const comboCount = Object.values(byDate).filter(peaks => peaks.size >= 2).length;

        // Frühaufsteher: Tour vor 07:00 gestartet (Proxy: summited_at < 07:00)
        const earlyCount = yearSummits.filter(s => {
          const h = new Date(s.summited_at).getHours();
          return h < 7;
        }).length;

        // Sammler: Unique Gipfel
        const uniquePeaks = new Set(yearSummits.map(s => s.peak_id)).size;

        // Gesamt-Besteigungen + HM
        const yearPts = yearSummits.reduce((sum, s) => sum + (s.points || 0), 0);
        let yearHM = 0;
        for (const s of yearSummits) {
          const p = peakCache.get(s.peak_id);
          if (p && p.elevation) yearHM += p.elevation;
        }

        trophyHtml += `
          <div style="margin-bottom: 1rem;">
            <div style="font-family: var(--font-display); font-size: 1rem; color: var(--color-gold); margin-bottom: 6px;">${year}</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px;">
              <div class="card" style="padding: 8px; text-align: center;">
                <div style="font-size: 1.2rem;">⛰️</div>
                <div style="font-size: 1rem; font-weight: 700; color: var(--color-gold);">${uniquePeaks}</div>
                <div class="text-muted" style="font-size: 0.65rem;">Gipfel</div>
              </div>
              ${pioneerCount > 0 ? `<div class="card" style="padding: 8px; text-align: center;">
                <div style="font-size: 1.2rem;">🌟</div>
                <div style="font-size: 1rem; font-weight: 700; color: var(--color-gold);">${pioneerCount}</div>
                <div class="text-muted" style="font-size: 0.65rem;">Pionier</div>
              </div>` : ''}
              ${comboCount > 0 ? `<div class="card" style="padding: 8px; text-align: center;">
                <div style="font-size: 1.2rem;">⚔️</div>
                <div style="font-size: 1rem; font-weight: 700; color: var(--color-gold);">${comboCount}</div>
                <div class="text-muted" style="font-size: 0.65rem;">Combo</div>
              </div>` : ''}
              ${earlyCount > 0 ? `<div class="card" style="padding: 8px; text-align: center;">
                <div style="font-size: 1.2rem;">🌅</div>
                <div style="font-size: 1rem; font-weight: 700; color: var(--color-gold);">${earlyCount}</div>
                <div class="text-muted" style="font-size: 0.65rem;">Frühaufsteher</div>
              </div>` : ''}
              <div class="card" style="padding: 8px; text-align: center;">
                <div style="font-size: 1.2rem;">📊</div>
                <div style="font-size: 1rem; font-weight: 700; color: var(--color-gold);">${yearHM.toLocaleString('de')}</div>
                <div class="text-muted" style="font-size: 0.65rem;">HM</div>
              </div>
            </div>
          </div>`;
      }

      if (trophyHtml) {
        badgesGrid.innerHTML = trophyHtml;
      }
    }
  }

  // Profil-Avatar mit Initialen füllen
  const profilAvatar = document.getElementById('profile-avatar');
  const profilName = document.getElementById('profile-name');
  const profilUsername = document.getElementById('profile-username');
  if (profil && profilName) {
    profilName.textContent = profil.display_name || profil.username || 'Bergfreund';
    if (profilUsername) profilUsername.textContent = '@' + (profil.username || '');
    if (profilAvatar) {
      if (profil.avatar_url) {
        profilAvatar.style.backgroundImage = 'url(' + profil.avatar_url + ')';
        profilAvatar.style.backgroundSize = 'cover';
        profilAvatar.textContent = '';
      } else {
        profilAvatar.textContent = (profil.username || 'B').charAt(0).toUpperCase();
      }
    }
  }

  // Strava-Button → zu Einstellungen
  const stravaProfileBtn = document.getElementById('strava-profile-btn');
  if (stravaProfileBtn) {
    stravaProfileBtn.addEventListener('click', function () {
      window.location.href = '/settings.html';
    });
  }

  // Abmelde-Button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      await GK.supabase.auth.signOut();
      window.location.href = '/index.html';
    });
  }

  // Gipfel des Tages laden
  showPeakOfDay();

  // Streak berechnen und anzeigen
  if (benutzer && benutzer.id) {
    calculateStreak(benutzer.id).then(function(streak) {
      const streakEl = document.getElementById('streak-display');
      if (streakEl && streak > 0) {
        streakEl.textContent = streak + ' Wo.';
        streakEl.parentElement.style.display = '';
      }
    });
  }

  // Navigation — Inhaltsbereiche umschalten
  initNavigation();

  // Karte als Startseite — app-content ausblenden, Karte zeigen
  const mapContainerInit = document.getElementById('map-section');
  const appContentInit = document.querySelector('.app-content');
  if (mapContainerInit) mapContainerInit.style.display = 'flex';
  if (appContentInit) appContentInit.style.display = 'none';

  // Karte-Tab als aktiv markieren
  document.querySelectorAll('.nav-item').forEach(function (nav) {
    nav.classList.remove('active');
    if (nav.getAttribute('data-section') === 'map') nav.classList.add('active');
  });

  // Karte neu berechnen
  if (GK.map && GK.map.leaflet) {
    setTimeout(function () { GK.map.leaflet.invalidateSize(); }, 100);
  }
}

/**
 * Navigations-Logik: Klick auf Navigations-Elemente blendet
 * den passenden Inhaltsbereich ein und alle anderen aus.
 */
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');
  const mapContainer = document.getElementById('map-section');
  const appContent = document.querySelector('.app-content');

  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      const zielId = 'section-' + item.getAttribute('data-section');
      const isMap = zielId === 'section-map';

      // Alle Abschnitte ausblenden
      sections.forEach(function (section) {
        section.style.display = 'none';
      });

      // Aktive Klasse von allen Nav-Elementen entfernen
      navItems.forEach(function (nav) {
        nav.classList.remove('active');
      });

      // Karte: map-container zeigen, app-content ausblenden
      if (mapContainer) {
        mapContainer.style.display = isMap ? 'flex' : 'none';
      }
      if (appContent) {
        appContent.style.display = isMap ? 'none' : 'block';
      }

      // Zielabschnitt einblenden und Nav-Element hervorheben
      if (!isMap) {
        const zielSection = document.getElementById(zielId);
        if (zielSection) zielSection.style.display = 'block';
      }
      item.classList.add('active');

      // Gipfel des Tages nur auf Karte anzeigen
      const potd = document.getElementById('peak-of-day');
      if (potd) potd.style.display = isMap ? 'block' : 'none';

      // Karte neu berechnen wenn sichtbar (Leaflet Bug)
      if (zielId === 'section-map' && GK.map && GK.map.leaflet) {
        setTimeout(function () {
          GK.map.leaflet.invalidateSize();
          // Peaks nicht neu laden — sind schon da
        }, 50);
      }

      // Daten laden beim Tab-Wechsel
      if (zielId === 'section-summits' && GK.summits && GK.summits.loadMySummits) {
        GK.summits.loadMySummits();
      }
      if (zielId === 'section-leaderboard' && GK.game && GK.game.loadLeaderboard) {
        GK.game.loadLeaderboard();
      }
      if (zielId === 'section-feed') {
        loadFeed();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Initialisierung — erkennt automatisch, welche Seite geladen ist
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Import-Fortschrittsbalken — pollt den Status aus user_profiles
// ---------------------------------------------------------------------------

// Seitenweiser Import — ein Request pro Seite, kein Timeout
async function startPagedImport(userId, stravaToken) {
  const bar = document.getElementById('import-bar');
  const progressEl = document.getElementById('import-progress');
  const messageEl = document.getElementById('import-message');
  const percentEl = document.getElementById('import-percent');

  if (bar) bar.style.display = 'block';

  let page = 1;
  let totalSummits = 0;
  let totalPoints = 0;
  const allPeaks = [];

  while (true) {
    try {
      // Fortschritt anzeigen
      const progress = Math.min(95, page * 8);
      if (progressEl) progressEl.style.width = progress + '%';
      if (percentEl) percentEl.textContent = progress + '%';
      if (messageEl) messageEl.textContent = `Seite ${page} · ${totalSummits} Gipfel gefunden`;

      console.log(`Import Seite ${page}...`);

      const { data, error } = await GK.supabase.functions.invoke('import-activities', {
        body: { user_id: userId, strava_token: stravaToken, page }
      });

      if (error) {
        console.error('Import-Fehler Seite ' + page + ':', error);
        if (messageEl) messageEl.textContent = 'Fehler bei Seite ' + page + ' — versuche nächste...';
        page++;
        if (page > 50) break; // Sicherheits-Limit
        continue;
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      console.log('Seite ' + page + ' Ergebnis:', result);

      if (result.error) {
        console.error('Server-Fehler:', result.error);
        if (messageEl) messageEl.textContent = 'Fehler: ' + result.error;
        break;
      }

      totalSummits += result.summits_found || 0;
      totalPoints += result.points || 0;
      if (result.peaks) allPeaks.push(...result.peaks);

      // Header-Punkte live aktualisieren
      if (result.total_points) {
        const punkteEl = document.getElementById('user-points');
        if (punkteEl) punkteEl.textContent = result.total_points.toLocaleString('de') + ' Pkt';
      }

      // Gipfel-Toast bei Fund
      if (result.peaks && result.peaks.length > 0) {
        if (typeof GK.showToast === 'function') {
          GK.showToast('⛰️ ' + result.peaks.join(', '), 'success');
        }
      }

      // Fertig?
      if (result.done || !result.has_more) {
        console.log('Import abgeschlossen! ' + totalSummits + ' Gipfel, ' + totalPoints + ' Punkte');
        if (progressEl) progressEl.style.width = '100%';
        if (percentEl) percentEl.textContent = '100%';
        if (messageEl) messageEl.textContent = '✅ ' + totalSummits + ' Gipfel · ' + totalPoints.toLocaleString('de') + ' Punkte';

        // Import-Status auf done setzen damit er nicht nochmal startet
        await GK.supabase.from('user_profiles').update({ import_status: 'done' }).eq('id', userId);

        // Nach 3 Sekunden Bar ausblenden (kein Reload!)
        setTimeout(() => {
          if (bar) bar.style.display = 'none';
        }, 3000);
        break;
      }

      page++;
    } catch (err) {
      console.error('Import Seite ' + page + ' Fehler:', err);
      page++;
      if (page > 50) break;
    }
  }
}

// ---------------------------------------------------------------------------
// Strava Aktivitäten-Import (läuft im Browser nach OAuth)
// ---------------------------------------------------------------------------

// Haversine-Distanz in Metern
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function importStravaActivities(userId, accessToken) {
  // Alle Gipfel aus der DB laden
  let allPeaks = [];
  let from = 0;
  while (true) {
    const { data } = await GK.supabase
      .from('peaks')
      .select('id, name, lat, lng, elevation, osm_region')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allPeaks = allPeaks.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('Gipfel geladen:', allPeaks.length);

  // Alle Strava-Aktivitäten abrufen
  let page = 1;
  let totalSummits = 0;
  let totalActivities = 0;

  while (true) {
    const res = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=50&page=' + page,
      { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );
    const activities = await res.json();
    if (!activities || !Array.isArray(activities) || activities.length === 0) break;

    for (const activity of activities) {
      if (!['Hike', 'Run', 'Walk', 'TrailRun', 'BackcountrySki', 'Snowshoe'].includes(activity.type)) continue;
      if (!activity.total_elevation_gain || activity.total_elevation_gain < 100) continue;

      totalActivities++;

      // GPS-Streams abrufen
      try {
        const streamRes = await fetch(
          'https://www.strava.com/api/v3/activities/' + activity.id + '/streams?keys=latlng,time&key_type=distance',
          { headers: { 'Authorization': 'Bearer ' + accessToken } }
        );

        if (streamRes.status === 429) {
          console.log('Rate Limit — warte 60 Sekunden...');
          await new Promise(r => setTimeout(r, 60000));
          continue;
        }

        const streams = await streamRes.json();
        const latlngStream = streams.find(s => s.type === 'latlng');
        const timeStream = streams.find(s => s.type === 'time');
        if (!latlngStream) continue;

        // GPS-Punkte gegen Gipfel prüfen (80m Radius)
        const foundPeaks = new Map();
        for (let i = 0; i < latlngStream.data.length; i++) {
          const [lat, lng] = latlngStream.data[i];
          for (const peak of allPeaks) {
            if (foundPeaks.has(peak.id)) continue;
            const dist = haversineDistance(lat, lng, peak.lat, peak.lng);
            if (dist <= 80) {
              const timeOffset = timeStream ? timeStream.data[i] : 0;
              const summitTime = new Date(new Date(activity.start_date).getTime() + timeOffset * 1000);
              foundPeaks.set(peak.id, { peak, summitTime, dist });
            }
          }
        }

        // Gefundene Gipfel speichern
        for (const [peakId, info] of foundPeaks) {
          const season = info.summitTime.getFullYear().toString();
          const elevGain = activity.total_elevation_gain ? Math.round(activity.total_elevation_gain) : 0;
          const distKm = activity.distance ? Math.round(activity.distance / 1000) : 0;

          // Basis: HM/100 + km×1 + Gipfel-Bonus
          let basePts = Math.round(elevGain / 100) + distKm + 10;

          // Prüfe Saison-Erster und Personal-Erster
          const { data: existingSeason } = await GK.supabase
            .from('summits')
            .select('id')
            .eq('peak_id', peakId)
            .eq('season', season)
            .limit(1);

          const { data: existingPersonal } = await GK.supabase
            .from('summits')
            .select('id')
            .eq('peak_id', peakId)
            .eq('user_id', userId)
            .limit(1);

          const isSeasonFirst = !existingSeason || existingSeason.length === 0;
          const isPersonalFirst = !existingPersonal || existingPersonal.length === 0;

          // Multiplikatoren
          let pts = basePts;
          if (isSeasonFirst) pts = Math.round(basePts * 3);
          else if (isPersonalFirst) pts = Math.round(basePts * 2);
          else pts = Math.round(basePts * 0.2);

          // Frühaufsteher Bonus (Tour-Startzeit < 07:00)
          if (new Date(activity.start_date).getHours() < 7) pts += 15;

          await GK.supabase.from('summits').upsert({
            user_id: userId,
            peak_id: peakId,
            summited_at: info.summitTime.toISOString(),
            season: season,
            strava_activity_id: activity.id.toString(),
            checkin_method: 'strava',
            points: pts,
            elevation_gain: elevGain,
            distance: distKm * 1000,
            safety_ok: true,
            is_season_first: isSeasonFirst,
            is_personal_first: isPersonalFirst
          }, { onConflict: 'user_id,peak_id,summited_at', ignoreDuplicates: true });

          totalSummits++;
          console.log('⛰️ ' + info.peak.name + ' (' + info.peak.elevation + 'm) — ' +
            info.summitTime.toLocaleDateString('de') + ' — ' + Math.round(info.dist) + 'm');
        }

        // Rate Limiting: 2 Sekunden zwischen Requests
        await new Promise(r => setTimeout(r, 2000));

      } catch (err) {
        console.error('Stream-Fehler für Aktivität ' + activity.id + ':', err);
      }
    }

    console.log('Seite ' + page + ' verarbeitet: ' + totalActivities + ' Aktivitäten, ' + totalSummits + ' Gipfel');

    if (typeof GK.showToast === 'function') {
      GK.showToast('Import: ' + totalSummits + ' Gipfel gefunden...', 'success');
    }

    page++;
  }

  // Gesamt-Punkte berechnen und Profil aktualisieren
  const { data: allSummits } = await GK.supabase
    .from('summits')
    .select('points')
    .eq('user_id', userId);

  const totalPoints = allSummits ? allSummits.reduce((s, r) => s + (r.points || 0), 0) : 0;
  await GK.supabase.from('user_profiles').update({ total_points: totalPoints }).eq('id', userId);

  console.log('Import abgeschlossen! ' + totalSummits + ' Gipfel, ' + totalPoints + ' Punkte');
  if (typeof GK.showToast === 'function') {
    GK.showToast('Import fertig! ' + totalSummits + ' Gipfel erkannt!', 'success');
  }

  // Seite neu laden um die Daten anzuzeigen
  setTimeout(() => window.location.reload(), 3000);
}

// Gipfel des Tages — deterministisch basierend auf Datum
// Gipfel des Tages — deterministisch basierend auf Datum, pro Sub-Region
async function showPeakOfDay() {
  const potdEl = document.getElementById('peak-of-day');
  if (!potdEl) return;

  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth()+1) * 100 + today.getDate();

  // Lade Peaks in der Nähe der Kartenposition
  const center = GK.map && GK.map.map ? GK.map.map.getCenter() : { lat: 47.35, lng: 10.15 };
  const range = 0.5;

  const { data: peaks } = await GK.supabase
    .from('peaks')
    .select('id, name, elevation, lat, lng')
    .gte('lat', center.lat - range)
    .lte('lat', center.lat + range)
    .gte('lng', center.lng - range)
    .lte('lng', center.lng + range)
    .not('elevation', 'is', null)
    .gt('elevation', 1000)
    .limit(500);

  if (!peaks || peaks.length === 0) return;

  // Finde Sub-Region der aktuellen Kartenposition
  let currentSubRegion = null;
  const subRegions = (typeof window.SUB_REGIONS !== 'undefined') ? window.SUB_REGIONS :
    (GK.game && GK.game.SUB_REGIONS ? GK.game.SUB_REGIONS : null);
  if (subRegions) {
    for (const sr of subRegions) {
      if (center.lat >= sr.latMin && center.lat <= sr.latMax &&
          center.lng >= sr.lngMin && center.lng <= sr.lngMax) {
        currentSubRegion = sr;
        break;
      }
    }
  }

  // Filtere Peaks in der Sub-Region (wenn vorhanden)
  let regionPeaks = peaks;
  if (currentSubRegion) {
    regionPeaks = peaks.filter(p =>
      p.lat >= currentSubRegion.latMin && p.lat <= currentSubRegion.latMax &&
      p.lng >= currentSubRegion.lngMin && p.lng <= currentSubRegion.lngMax
    );
    if (regionPeaks.length === 0) regionPeaks = peaks;
  }

  // Deterministisch auswählen (Seed + Sub-Region-ID für verschiedene Gipfel pro Region)
  const regionSeed = currentSubRegion ?
    seed + currentSubRegion.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) :
    seed;
  const index = regionSeed % regionPeaks.length;
  const peak = regionPeaks[index];

  // UI
  const regionLabel = currentSubRegion ? currentSubRegion.name : '';
  document.getElementById('potd-name').textContent = peak.name;
  document.getElementById('potd-info').textContent =
    peak.elevation + ' m' + (regionLabel ? ' · ' + regionLabel : '') + ' · 5× Punkte!';
  potdEl.style.display = 'block';

  GK.peakOfDayId = peak.id;
  GK.peakOfDayCoords = [peak.lat, peak.lng];

  // Klick-Handler
  potdEl.onclick = () => {
    if (GK.map && GK.map.map && GK.peakOfDayCoords) {
      GK.map.map.setView(GK.peakOfDayCoords, 15);
      setTimeout(() => {
        if (typeof window.openPeakPanel === 'function') window.openPeakPanel(GK.peakOfDayId);
      }, 500);
    }
  };

  // Stern-Marker auf der Karte
  if (GK.map && GK.map.map) {
    if (GK._potdMarker) GK.map.map.removeLayer(GK._potdMarker);
    const starIcon = L.divIcon({
      className: 'potd-marker',
      html: '<div style="width:32px;height:32px;background:rgba(255,215,0,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 15px rgba(255,215,0,0.7);animation:potdPulse 2s infinite;">⭐</div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    GK._potdMarker = L.marker([peak.lat, peak.lng], { icon: starIcon, zIndexOffset: 1000 })
      .addTo(GK.map.map)
      .bindPopup('<div style="text-align:center;"><strong>🎲 Gipfel des Tages</strong><br>' + peak.name + ' · ' + peak.elevation + ' m<br><span style="color:#ffd700;font-weight:bold;">5× Punkte!</span></div>');
  }
}

// Streak berechnen — Wochen-Streak
async function calculateStreak(userId) {
  const { data: summits } = await GK.supabase
    .from('summits')
    .select('summited_at')
    .eq('user_id', userId)
    .order('summited_at', { ascending: false });

  if (!summits || summits.length === 0) return 0;

  const now = new Date();
  const getWeekNumber = function(d) {
    const start = new Date(d.getFullYear(), 0, 1);
    const diff = d - start;
    return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
  };

  // Eindeutige Wochen mit Besteigungen sammeln
  const activeWeeks = new Set();
  for (const s of summits) {
    const d = new Date(s.summited_at);
    const weekKey = d.getFullYear() + '-' + getWeekNumber(d);
    activeWeeks.add(weekKey);
  }

  // Aufeinanderfolgende Wochen rückwärts von aktueller Woche zählen
  let streak = 0;
  for (let i = 0; i < 52; i++) {
    const checkDate = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const weekKey = checkDate.getFullYear() + '-' + getWeekNumber(checkDate);
    if (activeWeeks.has(weekKey)) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

document.addEventListener('DOMContentLoaded', async function () {
  // Route-Schutz: app.html braucht Login
  if (document.getElementById('logout-btn') || document.getElementById('user-points')) {
    const { data: { session } } = await GK.supabase.auth.getSession();
    if (!session) {
      window.location.href = '/login.html';
      return;
    }
    initAppPage();
  }
});
