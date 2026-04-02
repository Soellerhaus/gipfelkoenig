// =============================================================================
// Bergkönig — Authentifizierungs-Modul (auth.js)
// Login, Registrierung, Strava-OAuth und Sitzungsverwaltung.
// =============================================================================

window.GK = window.GK || {};

// ---------------------------------------------------------------------------
// Jahres-Wähler für Profil-Saison
// ---------------------------------------------------------------------------
window.currentProfileSeason = new Date().getFullYear();
window._allSummitsCache = null;
window._currentUserId = null;

window.switchProfileSeason = function(delta) {
  const newYear = window.currentProfileSeason + delta;
  const currentYear = new Date().getFullYear();
  if (newYear < 2020 || newYear > currentYear) return;
  window.currentProfileSeason = newYear;

  const label = document.getElementById('profile-season-label');
  if (label) label.textContent = 'SAISON ' + newYear;

  // Reload profile stats for this year
  loadProfileForSeason(newYear);
};

async function loadProfileForSeason(year) {
  try {
  const summits = window._allSummitsCache;
  if (!summits) return;

  const yearStr = year.toString();
  const seasonSummits = summits.filter(s => s.season === yearStr);
  const seasonPts = seasonSummits.reduce((sum, s) => sum + (s.points || 0), 0);
  const seasonUnique = new Set(seasonSummits.map(s => s.peak_id)).size;

  const el = (id) => document.getElementById(id);

  // Haupt-Stats aktualisieren
  if (el('stat-points')) el('stat-points').textContent = seasonPts.toLocaleString('de');
  if (el('stat-summits')) el('stat-summits').textContent = seasonUnique;
  if (el('stat-crowns')) el('stat-crowns').textContent = '0';
  if (el('season-summits')) el('season-summits').textContent = seasonUnique;
  if (el('season-points')) el('season-points').textContent = seasonPts.toLocaleString('de');
  // Header-Punkte auf aktuelle Saison setzen (nicht total_points)
  const punkteEl = document.querySelector('.header-points');
  if (punkteEl) punkteEl.textContent = seasonPts.toLocaleString('de') + ' Pkt';

  // HM berechnen — echte Aufstiegs-HM aus elevation_gain, Fallback auf Berghöhe
  let seasonHM = 0;
  for (const s of seasonSummits) {
    if (s.elevation_gain && s.elevation_gain > 0) {
      seasonHM += s.elevation_gain;
    } else {
      // Fallback: Berghöhe als grobe Schätzung
      const p = await GK.api.getPeakById(s.peak_id);
      if (p && p.elevation) seasonHM += p.elevation;
    }
  }
  if (el('season-hm')) el('season-hm').textContent = seasonHM.toLocaleString('de');

  // Trophäen aktualisieren
  const trophySeason = el('trophy-season');
  if (trophySeason) trophySeason.textContent = yearStr;

  // trophy-koenig wird nach Kronen-Berechnung gesetzt (weiter unten)

  const pioneerCount = seasonSummits.filter(s => s.is_season_first).length;
  if (el('trophy-pionier')) el('trophy-pionier').textContent = pioneerCount;

  const byDate = {};
  for (const s of seasonSummits) {
    const date = s.summited_at.slice(0, 10);
    if (!byDate[date]) byDate[date] = new Set();
    byDate[date].add(s.peak_id);
  }
  const comboCount = Object.values(byDate).filter(peaks => peaks.size >= 2).length;
  if (el('trophy-combo')) el('trophy-combo').textContent = comboCount;

  const earlyCount = seasonSummits.filter(s => {
    const h = new Date(s.summited_at).getHours();
    return h < 7;
  }).length;
  if (el('trophy-frueh')) el('trophy-frueh').textContent = earlyCount;

  if (el('trophy-gipfel')) el('trophy-gipfel').textContent = seasonUnique;

  let yearHM = 0;
  for (const s of seasonSummits) {
    if (s.elevation_gain) yearHM += s.elevation_gain;
  }
  if (el('trophy-hm')) el('trophy-hm').textContent = yearHM.toLocaleString('de');

  // Kronen berechnen: Prüfe auf welchen Gipfeln der User die meisten Besteigungen hat (König ist)
  let crownCount = 0;
  const userId = window._currentUserId;
  const peakIds = [...new Set(seasonSummits.map(s => s.peak_id))];
  if (userId && peakIds.length > 0) {
    // Für jeden Gipfel des Users: alle Summits aller User laden und prüfen ob User König ist
    for (const pid of peakIds) {
      const { data: allSummits } = await GK.supabase
        .from('summits')
        .select('user_id')
        .eq('peak_id', pid);
      if (!allSummits || allSummits.length === 0) continue;
      // Zähle Besteigungen pro User
      const counts = {};
      for (const s of allSummits) {
        counts[s.user_id] = (counts[s.user_id] || 0) + 1;
      }
      const maxCount = Math.max(...Object.values(counts));
      // User ist König wenn er die meisten Besteigungen hat (bei Gleichstand alle Könige)
      if ((counts[userId] || 0) === maxCount) {
        crownCount++;
      }
    }
  }
  if (el('stat-crowns')) el('stat-crowns').textContent = crownCount;
  if (el('trophy-koenig')) el('trophy-koenig').textContent = crownCount;

  // Rang berechnen und anzeigen
  if (GK.game && GK.game.getRank) {
    const rank = GK.game.getRank(seasonUnique, crownCount);
    const rankBadge = el('profile-rank-badge');
    const rankProgress = el('profile-rank-progress');
    const rankCurrentDisplay = el('rank-current-display');
    const rankNextHint = el('rank-next-hint');

    if (rankBadge) rankBadge.textContent = rank.icon + ' ' + rank.name;

    if (rankProgress && rankCurrentDisplay && rankNextHint) {
      rankCurrentDisplay.textContent = rank.icon + ' ' + rank.name;
      rankProgress.style.display = 'block';

      if (rank.next) {
        const hints = [];
        if (rank.peaksNeeded > 0) hints.push(rank.peaksNeeded + ' Gipfel');
        if (rank.crownsNeeded > 0) hints.push(rank.crownsNeeded + ' Krone' + (rank.crownsNeeded > 1 ? 'n' : ''));
        rankNextHint.textContent = 'Noch ' + hints.join(' + ') + ' bis ' + rank.next.icon + ' ' + rank.next.name + '!';
      } else {
        rankNextHint.textContent = 'Hoechster Rang erreicht!';
      }
    }
  }

  // Lose berechnen fuer diese Saison (neues System)
  const gipfelLose = seasonSummits.length;   // 1 Los pro Gipfel
  const koenigLose = crownCount;              // 1 Los pro Krone
  // Gebiet-Lose: Anzahl beherrschter Gebiete * 5
  let gebietLose = 0;
  // Gipfel des Tages Lose
  const potdLose = 0; // TODO: track separately when POTD summits exist
  // Punkte-Lose: 1 Los pro 1000 Punkte
  const punkteLose = Math.floor(seasonPts / 1000);
  const total = gipfelLose + koenigLose + gebietLose + potdLose + punkteLose;

  const setEl = (id, val) => { const e = document.getElementById(id); if(e) e.textContent = val; };
  setEl('tickets-total', total);
  setEl('tickets-gipfel', gipfelLose);
  setEl('tickets-koenig', koenigLose);
  setEl('tickets-gebiet', gebietLose);
  setEl('tickets-potd', potdLose);
  setEl('tickets-punkte', punkteLose);
  } catch (err) {
    console.warn('loadProfileForSeason Fehler (nicht kritisch):', err.message);
  }
}

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

  // User global verfügbar machen für andere Module (game.js Leaderboard etc.)
  GK.auth = { user: benutzer };

  // Avatar-Emoji Mapping
  const AVATAR_EMOJIS = {
    'mountain': '🏔️', 'eagle': '🦅', 'ski': '⛷️', 'climber': '🧗',
    'tree': '🌲', 'snow': '❄️', 'deer': '🦌', 'rock': '🪨'
  };

  // Benutzerprofil laden und in der Kopfzeile anzeigen
  const profil = await GK.api.getUserProfile(benutzer.id);
  if (profil) {
    const nameEl = document.getElementById('user-avatar');
    const punkteEl = document.getElementById('user-points');
    if (nameEl) {
      if (profil.avatar_url) {
        nameEl.innerHTML = '<img src="' + profil.avatar_url + '" alt="Avatar">';
        nameEl.classList.add('has-image');
      } else {
        const avatarEmoji = profil.avatar_type ? AVATAR_EMOJIS[profil.avatar_type] : null;
        nameEl.textContent = avatarEmoji || (profil.username || 'B').charAt(0).toUpperCase();
      }
    }
    if (punkteEl) punkteEl.textContent = (profil.total_points || 0).toLocaleString('de') + ' Pkt';

    // Laufenden Import erkennen (bei Seiten-Reload während Import)
    if ((profil.import_status === 'importing' || profil.import_status === 'pending') && profil.strava_token) {
      startPagedImport(benutzer.id, profil.strava_token);
    }
  }

  // Täglichen Login-Bonus prüfen
  // checkDailyReward(); -- entfernt

  // Kronen-Angriffe + Rivalen prüfen (im Hintergrund, blockiert nicht)
  checkCrownThreats(benutzer.id);

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
      .select('peak_id, points, summited_at, season, is_season_first, elevation_gain')
      .eq('user_id', benutzer.id)
      .order('summited_at', { ascending: false });

    if (summits) {
      // Cache für Jahres-Wechsel
      window._allSummitsCache = summits;
      window._currentUserId = benutzer.id;

      // Letzte 5 Besteigungen (jahresunabhängig)
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

      // Rang berechnen (jahresunabhängig)
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

      // Saison-Stats für aktuelles Jahr laden
      const currentYear = window.currentProfileSeason || new Date().getFullYear();
      const label = document.getElementById('profile-season-label');
      if (label) label.textContent = 'SAISON ' + currentYear;
      loadProfileForSeason(currentYear).catch(e => console.warn('Season load:', e.message));
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
        profilAvatar.innerHTML = '<img src="' + profil.avatar_url + '" alt="Avatar">';
        profilAvatar.classList.add('has-image');
      } else {
        const avatarEmoji = profil.avatar_type ? AVATAR_EMOJIS[profil.avatar_type] : null;
        profilAvatar.textContent = avatarEmoji || (profil.username || 'B').charAt(0).toUpperCase();
        if (avatarEmoji) profilAvatar.style.fontSize = '1.8rem';
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

  // Letzte Seite aus localStorage laden (Fortsetzung nach Abbruch)
  const savedPage = parseInt(localStorage.getItem('import_last_page_' + userId) || '0');
  let page = savedPage > 0 ? savedPage : 1;
  let totalSummits = 0;
  let totalPoints = 0;
  const allPeaks = [];
  if (savedPage > 1) console.log('Import wird fortgesetzt ab Seite ' + savedPage);

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

        // Import-Status auf done setzen + Fortschritt aufräumen
        await GK.supabase.from('user_profiles').update({ import_status: 'done' }).eq('id', userId);
        localStorage.removeItem('import_last_page_' + userId);

        // Nach 3 Sekunden Bar ausblenden (kein Reload!)
        setTimeout(() => {
          if (bar) bar.style.display = 'none';
        }, 3000);
        break;
      }

      page++;
      localStorage.setItem('import_last_page_' + userId, page.toString());
    } catch (err) {
      console.error('Import Seite ' + page + ' Fehler:', err);
      localStorage.setItem('import_last_page_' + userId, page.toString());
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
// Letzte Sub-Region merken, damit bei gleicher Region kein Update passiert
let _lastPotdRegionKey = null;

async function showPeakOfDay() {
  const el = document.getElementById('peak-of-day');
  const nameEl = document.getElementById('potd-name');
  if (!el || !nameEl || !GK.map || !GK.map.leaflet) return;

  const center = GK.map.leaflet.getCenter();
  const bounds = GK.map.leaflet.getBounds();

  // Sub-Region-Key: Kartenmitte gerundet auf 0.5° Raster
  const regionKey = Math.round(center.lat * 2) + Math.round(center.lng * 2) * 1000;

  // Wenn gleiche Sub-Region wie vorher → nicht ändern
  if (_lastPotdRegionKey !== null && _lastPotdRegionKey === regionKey) return;

  // Lade Peaks im sichtbaren Bereich
  const { data: allPeaks } = await GK.supabase
    .from('peaks')
    .select('id, name, elevation, lat, lng')
    .gte('lat', bounds.getSouth())
    .lte('lat', bounds.getNorth())
    .gte('lng', bounds.getWest())
    .lte('lng', bounds.getEast())
    .not('elevation', 'is', null)
    .order('elevation', { ascending: false })
    .limit(200);

  if (!allPeaks || allPeaks.length === 0) {
    el.style.display = 'none';
    return;
  }

  // Schneegrenze je nach Monat (max. erreichbare Gipfelhöhe)
  var month = new Date().getMonth(); // 0=Jan, 11=Dez
  var snowLine = [1800, 1900, 2200, 2500, 3000, 3500, 4500, 4500, 3500, 2800, 2200, 1800][month];

  // Nur Gipfel innerhalb 20km vom Kartenzentrum UND unter der Schneegrenze
  var cLat = center.lat * Math.PI / 180, cLng = center.lng * Math.PI / 180;
  var peaks = allPeaks.filter(function(p) {
    // Schneegrenze: Gipfel muss erreichbar sein
    if (p.elevation && p.elevation > snowLine) return false;
    var dLat = (p.lat * Math.PI / 180) - cLat;
    var dLng = (p.lng * Math.PI / 180) - cLng;
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(cLat)*Math.cos(p.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) <= 20;
  });

  if (peaks.length === 0) {
    el.style.display = 'none';
    return;
  }

  // Deterministischer Seed basierend auf Datum + Region-Center (gerundet auf 0.5°)
  var today = new Date();
  var seed = today.getFullYear() * 10000 + (today.getMonth()+1) * 100 + today.getDate();
  var index = Math.abs((seed + regionKey) * 2654435761) % peaks.length;

  var peak = peaks[index];
  _lastPotdRegionKey = regionKey;
  GK.peakOfDayId = peak.id;
  GK.peakOfDayCoords = [peak.lat, peak.lng];

  // Banner ausblenden — Gipfel des Tages nur als Notification + Marker
  el.style.display = 'none';

  // Notification in der Glocke (nur 1× pro Tag pro Region)
  var potdNotifKey = 'bergkoenig_potd_notif_' + getTodayStr() + '_' + regionKey;
  if (!localStorage.getItem(potdNotifKey)) {
    var peakLabel = peak.name + (peak.elevation ? ' (' + peak.elevation + ' m)' : '');
    addNotification('🃏', 'Gipfel des Tages: ' + peakLabel + ' — 5× Punkte!', 'potd');
    localStorage.setItem(potdNotifKey, '1');
  }

  // Stern-Marker auf Karte
  if (GK.map._potdMarker) {
    GK.map.leaflet.removeLayer(GK.map._potdMarker);
  }
  GK.map._potdMarker = L.marker([peak.lat, peak.lng], {
    icon: L.divIcon({
      className: 'potd-star',
      html: '<div class="potd-dice" style="font-size:1.3rem;filter:drop-shadow(0 0 4px gold);">🃏</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    }),
    zIndexOffset: 1000
  }).addTo(GK.map.leaflet)
    .bindPopup('<b>🃏 Gipfel des Tages</b><br>' + peak.name + '<br><span style="color:#ffd700">5× Punkte!</span>');
  // Klick auf Marker → Info-Panel öffnen
  GK.map._potdMarker.on('click', function() {
    if (typeof openPeakPanel === 'function') openPeakPanel(peak.id);
    else if (typeof window.openPeakPanel === 'function') window.openPeakPanel(peak.id);
  });
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

// ---------------------------------------------------------------------------
// Täglicher Login-Bonus ("Täglicher Bonus")
// ---------------------------------------------------------------------------

const DAILY_REWARD_POINTS = [5, 10, 15, 20, 30, 40, 50];

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function checkDailyReward() {
  const today = getTodayStr();
  const lastClaim = localStorage.getItem('bergkoenig_last_login_date');

  // Bereits heute eingesammelt → nichts tun
  if (lastClaim === today) return;

  // Streak berechnen
  let streak = parseInt(localStorage.getItem('bergkoenig_login_streak') || '0', 10);

  if (lastClaim) {
    // Prüfen ob gestern war (Streak fortsetzen) oder Streak zurücksetzen
    const lastDate = new Date(lastClaim);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      // Gestern eingesammelt → Streak weiter
      streak = (streak % 7) + 1;
    } else {
      // Mehr als 1 Tag verpasst → Reset
      streak = 1;
    }
  } else {
    // Erster Login überhaupt
    streak = 1;
  }

  const dayIndex = streak - 1; // 0-basiert
  const points = DAILY_REWARD_POINTS[dayIndex] || 5;
  const isDay7 = streak === 7;

  // Modal füllen
  const streakEl = document.getElementById('daily-reward-streak');
  const pointsEl = document.getElementById('daily-reward-points');
  const bonusEl = document.getElementById('daily-reward-bonus');
  const dotsEl = document.getElementById('daily-reward-dots');

  if (streakEl) streakEl.textContent = 'Tag ' + streak + ' 🔥';
  if (pointsEl) pointsEl.textContent = '+' + points + ' Punkte';
  if (bonusEl) bonusEl.style.display = isDay7 ? 'block' : 'none';

  // Streak-Dots rendern
  if (dotsEl) {
    let html = '';
    for (let i = 1; i <= 7; i++) {
      let cls = 'daily-reward-dot';
      let icon = '';
      if (i < streak) {
        cls += ' done';
        icon = '✓';
      } else if (i === streak) {
        cls += ' current';
        icon = '🔥';
      } else if (i === 7) {
        cls += ' future';
        icon = '🎁';
      } else {
        cls += ' future';
        icon = '○';
      }
      html += '<div class="' + cls + '">' + icon + '<span class="dot-label">' + i + '</span></div>';
    }
    dotsEl.innerHTML = html;
  }

  // Modal anzeigen
  const overlay = document.getElementById('daily-reward-overlay');
  if (overlay) overlay.style.display = 'flex';

  // Claim-Button Handler (einmal binden)
  const claimBtn = document.getElementById('daily-reward-claim');
  if (claimBtn) {
    // Alten Listener entfernen durch Klonen
    const newBtn = claimBtn.cloneNode(true);
    claimBtn.parentNode.replaceChild(newBtn, claimBtn);

    newBtn.addEventListener('click', function() {
      claimDailyReward(streak, points, isDay7);
    });
  }
}

async function claimDailyReward(streak, points, isDay7) {
  const overlay = document.getElementById('daily-reward-overlay');
  const modal = document.getElementById('daily-reward-modal');
  const today = getTodayStr();

  try {
    // 1. Punkte zum Profil in Supabase addieren
    const userId = GK.auth && GK.auth.user ? GK.auth.user.id : null;
    if (userId) {
      // Aktuelle Punkte holen
      const { data: profile } = await GK.supabase
        .from('user_profiles')
        .select('total_points')
        .eq('id', userId)
        .single();

      const currentPoints = (profile && profile.total_points) || 0;
      const newTotal = currentPoints + points;

      await GK.supabase
        .from('user_profiles')
        .update({ total_points: newTotal })
        .eq('id', userId);

      // 2. Header-Punkte aktualisieren
      const punkteEl = document.getElementById('user-points');
      if (punkteEl) punkteEl.textContent = newTotal.toLocaleString('de') + ' Pkt';
    }

    // 3. localStorage aktualisieren
    localStorage.setItem('bergkoenig_last_login_date', today);
    localStorage.setItem('bergkoenig_login_streak', streak.toString());

    // 4. Gold Flash + Confetti + Modal schließen
    if (overlay) overlay.classList.add('gold-flash');
    fireConfetti();

    setTimeout(function() {
      if (modal) modal.classList.add('closing');
      setTimeout(function() {
        if (overlay) {
          overlay.style.display = 'none';
          overlay.classList.remove('gold-flash');
        }
        if (modal) modal.classList.remove('closing');
      }, 350);
    }, 600);

    // Toast
    if (typeof GK.showToast === 'function') {
      const msg = '+' + points + ' Punkte eingesammelt!' + (isDay7 ? ' 🎁 +1 Bonus-Los!' : '');
      GK.showToast(msg, 'success');
    }

    // Notification in Glocke
    addNotification('🎁', '+' + points + ' Tages-Bonus (Tag ' + streak + '/7)' + (isDay7 ? ' + Bonus-Los!' : ''), 'reward');

  } catch (err) {
    console.error('Daily reward claim Fehler:', err);
    // Trotzdem localStorage updaten damit Modal nicht endlos kommt
    localStorage.setItem('bergkoenig_last_login_date', today);
    localStorage.setItem('bergkoenig_login_streak', streak.toString());
    if (overlay) overlay.style.display = 'none';
  }
}

// ============================
// Kronen-Angriffe & Rivalen-Check
// ============================
async function checkCrownThreats(userId) {
  try {
    const season = new Date().getFullYear().toString();
    const lastCheck = localStorage.getItem('bergkoenig_last_crown_check') || '2000-01-01';

    // 1. Alle Peaks laden wo der User Summits hat
    const { data: mySummits } = await GK.supabase
      .from('summits').select('peak_id, season')
      .eq('user_id', userId).eq('season', season);
    if (!mySummits || mySummits.length === 0) return;

    // Zähle meine Besteigungen pro Peak
    const myCounts = {};
    for (const s of mySummits) {
      myCounts[s.peak_id] = (myCounts[s.peak_id] || 0) + 1;
    }
    const myPeakIds = Object.keys(myCounts).map(Number);

    // 2. Alle Summits auf diesen Peaks laden (von allen Usern)
    const { data: allSummits } = await GK.supabase
      .from('summits').select('peak_id, user_id, summited_at, season')
      .in('peak_id', myPeakIds).eq('season', season);
    if (!allSummits) return;

    // 3. Wer ist König pro Peak? + Gibt es neue Bedrohungen?
    const peakData = {};
    for (const s of allSummits) {
      if (!peakData[s.peak_id]) peakData[s.peak_id] = {};
      peakData[s.peak_id][s.user_id] = (peakData[s.peak_id][s.user_id] || 0) + 1;
    }

    // Bedrohte Kronen und verlorene Kronen finden
    const threats = [];  // ⚔️ Jemand ist nah dran
    const lost = [];     // 💀 Krone verloren

    for (const [pid, users] of Object.entries(peakData)) {
      const sorted = Object.entries(users).sort((a, b) => b[1] - a[1]);
      const myCount = users[userId] || 0;
      if (myCount === 0) continue;

      const topUser = sorted[0];
      const topCount = topUser[1];

      if (topUser[0] === userId) {
        // Ich bin König — gibt es Bedrohungen?
        if (sorted.length > 1) {
          const challenger = sorted[1];
          const gap = myCount - challenger[1];
          if (gap <= 2 && gap > 0) {
            // Nur 1-2 Vorsprung — Angriff!
            threats.push({ peakId: parseInt(pid), challengerId: challenger[0], gap, myCount });
          }
        }
      } else {
        // Ich bin NICHT mehr König!
        if (myCounts[pid] && myCounts[pid] > 0) {
          // Hatte ich mal die Krone? Prüfe ob ich vorher König war
          const newKingCount = topCount;
          if (myCount >= newKingCount - 2) {
            // Ich war kürzlich König und wurde überholt
            lost.push({ peakId: parseInt(pid), newKingId: topUser[0], newKingCount, myCount });
          }
        }
      }
    }

    // 4. Peak-Namen laden für die Notifications
    const notifPeakIds = [...threats.map(t => t.peakId), ...lost.map(l => l.peakId)];
    if (notifPeakIds.length === 0) {
      // Kein Angriff — Rivalen-Check statt dessen
      checkRival(userId, season, allSummits);
      return;
    }

    const { data: peaks } = await GK.supabase
      .from('peaks').select('id, name')
      .in('id', notifPeakIds);
    const peakNames = {};
    if (peaks) peaks.forEach(p => peakNames[p.id] = p.name);

    // Challenger-Namen laden
    const challengerIds = [...new Set([...threats.map(t => t.challengerId), ...lost.map(l => l.newKingId)])];
    const { data: profiles } = await GK.supabase
      .from('user_profiles').select('id, username')
      .in('id', challengerIds);
    const userNames = {};
    if (profiles) profiles.forEach(p => userNames[p.id] = p.username);

    // 5. Notifications erstellen
    for (const t of threats) {
      const name = peakNames[t.peakId] || 'Unbekannt';
      const challenger = userNames[t.challengerId] || 'Jemand';
      addNotification('⚔️',
        challenger + ' greift deine Krone an! ' + name + ' — noch ' + t.gap + ' Vorsprung!',
        'crown-attack');
    }

    for (const l of lost) {
      const name = peakNames[l.peakId] || 'Unbekannt';
      const newKing = userNames[l.newKingId] || 'Jemand';
      addNotification('💀',
        'Krone verloren! ' + newKing + ' ist neuer König auf ' + name + ' (' + l.newKingCount + '×)',
        'crown-lost');
    }

    // Timestamp speichern
    localStorage.setItem('bergkoenig_last_crown_check', new Date().toISOString());

    // Rivalen-Check auch noch
    checkRival(userId, season, allSummits);

  } catch (err) {
    console.error('Crown threats check:', err);
  }
}

// Rivalen-Check: Wer ist direkt über/unter mir in der Rangliste?
async function checkRival(userId, season) {
  try {
    // Letzte Prüfung heute schon? → Skip
    const lastRivalCheck = localStorage.getItem('bergkoenig_last_rival_check');
    const today = getTodayStr();
    if (lastRivalCheck === today) return;

    // Alle User-Punkte laden (Top 50)
    const { data: leaderboard } = await GK.supabase
      .from('user_profiles').select('id, username, total_points')
      .order('total_points', { ascending: false }).limit(50);
    if (!leaderboard) return;

    const myIndex = leaderboard.findIndex(u => u.id === userId);
    if (myIndex < 0) return;

    const myPoints = leaderboard[myIndex].total_points || 0;

    // Spieler direkt über mir
    if (myIndex > 0) {
      const rival = leaderboard[myIndex - 1];
      const gap = (rival.total_points || 0) - myPoints;
      if (gap < 100 && gap > 0) {
        addNotification('📊',
          'Noch ' + gap + ' Pkt bis Platz ' + myIndex + '! ' + (rival.username || 'Jemand') + ' ist knapp vor dir.',
          'rival');
      }
    }

    // Spieler direkt unter mir greift an
    if (myIndex < leaderboard.length - 1) {
      const chaser = leaderboard[myIndex + 1];
      const gap = myPoints - (chaser.total_points || 0);
      if (gap < 50 && gap > 0) {
        addNotification('🏃',
          (chaser.username || 'Jemand') + ' holt auf! Nur noch ' + gap + ' Pkt hinter dir.',
          'rival-chase');
      }
    }

    localStorage.setItem('bergkoenig_last_rival_check', today);
  } catch (err) {
    console.error('Rival check:', err);
  }
}

// ============================
// Notification-System (Glocke)
// ============================
const _notifications = [];

function addNotification(icon, text, type) {
  _notifications.unshift({ icon, text, type, time: new Date() });
  if (_notifications.length > 20) _notifications.pop();
  updateNotifBadge();
  renderNotifications();
}

function updateNotifBadge() {
  const countEl = document.getElementById('notif-count');
  const unread = _notifications.filter(n => !n.read).length;
  if (countEl) {
    if (unread > 0) {
      countEl.textContent = unread > 9 ? '9+' : unread;
      countEl.style.display = 'block';
    } else {
      countEl.style.display = 'none';
    }
  }
}

function renderNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (_notifications.length === 0) {
    list.innerHTML = '<div style="padding:12px 14px;font-size:0.75rem;color:var(--color-muted);text-align:center;">Keine Benachrichtigungen</div>';
    return;
  }
  list.innerHTML = _notifications.map(n => {
    const ago = timeAgo(n.time);
    const bg = n.read ? '' : 'background:rgba(201,168,76,0.06);';
    return '<div style="padding:8px 14px;border-bottom:1px solid var(--color-border);' + bg + 'cursor:pointer;" onclick="this.style.background=\'none\'">'
      + '<div style="display:flex;gap:8px;align-items:flex-start;">'
      + '<span style="font-size:1.1rem;">' + n.icon + '</span>'
      + '<div style="flex:1;">'
      + '<div style="font-size:0.75rem;color:var(--color-text);line-height:1.3;">' + n.text + '</div>'
      + '<div style="font-size:0.6rem;color:var(--color-muted);margin-top:2px;">' + ago + '</div>'
      + '</div></div></div>';
  }).join('');
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return Math.floor(s / 60) + ' Min';
  if (s < 86400) return Math.floor(s / 3600) + ' Std';
  return Math.floor(s / 86400) + ' Tage';
}

function toggleNotifDropdown() {
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Alle als gelesen markieren
    _notifications.forEach(n => n.read = true);
    updateNotifBadge();
  }
}

// Dropdown schliessen bei Klick ausserhalb
document.addEventListener('click', function(e) {
  const dd = document.getElementById('notif-dropdown');
  const bell = document.getElementById('notification-bell');
  if (dd && dd.style.display !== 'none' && !dd.contains(e.target) && !bell.contains(e.target)) {
    dd.style.display = 'none';
  }
});

// Global verfügbar machen
window.toggleNotifDropdown = toggleNotifDropdown;
window.addNotification = addNotification;

// Confetti-Burst Animation
function fireConfetti() {
  const canvas = document.getElementById('daily-reward-confetti');
  if (!canvas) return;
  canvas.style.display = 'block';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const colors = ['#ffd700','#ff6b6b','#48bb78','#4299e1','#ed64a6','#ecc94b','#fff'];
  const particles = [];
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 60,
      y: canvas.height / 2 - 40,
      vx: (Math.random() - 0.5) * 12,
      vy: Math.random() * -12 - 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 6 + 3,
      life: 1,
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.vy += 0.25; // Schwerkraft
      p.y += p.vy;
      p.life -= 0.012;
      p.rotation += p.rotSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 120) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }
  requestAnimationFrame(animate);
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
