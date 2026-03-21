// =============================================================================
// Gipfelkönig — Authentifizierungs-Modul (auth.js)
// Login, Registrierung, Strava-OAuth und Sitzungsverwaltung.
// =============================================================================

window.GK = window.GK || {};

// ---------------------------------------------------------------------------
// Strava OAuth — Platzhalter-Konfiguration
// ---------------------------------------------------------------------------
const STRAVA_CLIENT_ID = '211591';
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

  // Strava-Verbindung — Weiterleitung zur OAuth-Seite
  if (stravaBtn) {
    stravaBtn.addEventListener('click', function () {
      window.location.href = STRAVA_AUTH_URL;
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
  }

  // Strava-OAuth-Callback verarbeiten (Code in URL-Parametern)
  const urlParams = new URLSearchParams(window.location.search);
  const stravaCode = urlParams.get('code');

  if (stravaCode) {
    try {
      // Code an die Edge Function senden, um Token zu tauschen
      const { data, error } = await GK.supabase.functions.invoke('strava-callback', {
        body: { code: stravaCode },
      });

      if (error) {
        console.error('Strava-OAuth-Fehler:', error);
      } else {
        console.log('Strava erfolgreich verbunden.');
      }

      // URL bereinigen — Code-Parameter entfernen
      window.history.replaceState({}, document.title, 'app.html');
    } catch (err) {
      console.error('Fehler beim Strava-Callback:', err);
    }
  }

  // Profil-Stats aus Summits berechnen
  if (profil) {
    const { data: summits } = await GK.supabase
      .from('summits')
      .select('peak_id, points')
      .eq('user_id', benutzer.id);

    if (summits) {
      const totalPoints = summits.reduce((sum, s) => sum + (s.points || 0), 0);
      const uniquePeaks = new Set(summits.map(s => s.peak_id)).size;

      const statPoints = document.getElementById('stat-points');
      const statSummits = document.getElementById('stat-summits');
      const statCrowns = document.getElementById('stat-crowns');

      if (statPoints) statPoints.textContent = totalPoints.toLocaleString('de');
      if (statSummits) statSummits.textContent = uniquePeaks;
      if (statCrowns) statCrowns.textContent = '0'; // TODO: aus ownership Tabelle
    }

    // Badges aus DB laden und anzeigen
    const { data: badges } = await GK.supabase
      .from('badges')
      .select('badge_type, peak_id, season')
      .eq('user_id', benutzer.id);

    const badgesGrid = document.getElementById('badges-grid');
    if (badgesGrid && badges && badges.length > 0) {
      const badgeTypes = {
        pioneer: { emoji: '🌟', label: 'Pionier' },
        combo: { emoji: '⚔️', label: 'Combo' },
        king_end: { emoji: '👑', label: 'König' },
        rare: { emoji: '💎', label: 'Selten' },
        streak: { emoji: '🔥', label: 'Streak' },
      };

      // Badges nach Typ zählen
      const counts = {};
      for (const b of badges) {
        counts[b.badge_type] = (counts[b.badge_type] || 0) + 1;
      }

      let badgeHtml = '';
      for (const [type, count] of Object.entries(counts)) {
        const info = badgeTypes[type] || { emoji: '🏅', label: type };
        badgeHtml += `
          <div class="profile-badge">
            <div class="profile-badge-icon">${info.emoji}</div>
            <span>${info.label}</span>
            <span style="color: var(--color-gold); font-size: 0.8rem;">${count}x</span>
          </div>`;
      }
      badgesGrid.innerHTML = badgeHtml;
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

  // Strava-Button im Profil
  const stravaProfileBtn = document.getElementById('strava-profile-btn');
  if (stravaProfileBtn) {
    stravaProfileBtn.addEventListener('click', function () {
      window.location.href = STRAVA_AUTH_URL;
    });
  }

  // Abmelde-Button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      await GK.supabase.auth.signOut();
      window.location.href = 'index.html';
    });
  }

  // Navigation — Inhaltsbereiche umschalten
  initNavigation();
}

/**
 * Navigations-Logik: Klick auf Navigations-Elemente blendet
 * den passenden Inhaltsbereich ein und alle anderen aus.
 */
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.content-section');
  const mapContainer = document.getElementById('map-section');

  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      const zielId = 'section-' + item.getAttribute('data-section');

      // Alle Abschnitte ausblenden
      sections.forEach(function (section) {
        section.style.display = 'none';
      });

      // Aktive Klasse von allen Nav-Elementen entfernen
      navItems.forEach(function (nav) {
        nav.classList.remove('active');
      });

      // Karte nur bei Karte-Tab anzeigen
      if (mapContainer) {
        mapContainer.style.display = (zielId === 'section-map') ? 'block' : 'none';
      }

      // Zielabschnitt einblenden und Nav-Element hervorheben
      const zielSection = document.getElementById(zielId);
      if (zielSection) zielSection.style.display = 'block';
      item.classList.add('active');

      // Karte neu berechnen wenn sichtbar (Leaflet Bug)
      if (zielId === 'section-map' && GK.map && GK.map.leaflet) {
        setTimeout(function () { GK.map.leaflet.invalidateSize(); }, 100);
      }

      // Daten laden beim Tab-Wechsel
      if (zielId === 'section-summits' && GK.summits && GK.summits.loadMySummits) {
        GK.summits.loadMySummits();
      }
      if (zielId === 'section-leaderboard' && GK.game && GK.game.loadLeaderboard) {
        GK.game.loadLeaderboard();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Initialisierung — erkennt automatisch, welche Seite geladen ist
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  // Prüfen, ob wir auf der Landing-Page oder App-Seite sind
  if (document.getElementById('auth-form')) {
    initLandingPage();
  } else if (document.getElementById('logout-btn') || document.getElementById('user-points')) {
    initAppPage();
  }
});
