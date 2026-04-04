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
  const seasonUnique = new Set(seasonSummits.filter(s => s.peak_id !== null).map(s => s.peak_id)).size;

  const el = (id) => document.getElementById(id);

  // Haupt-Stats aktualisieren
  if (el('stat-points')) el('stat-points').textContent = seasonPts.toLocaleString('de');
  if (el('stat-summits')) el('stat-summits').textContent = seasonUnique;
  if (el('stat-crowns')) el('stat-crowns').textContent = '0';
  if (el('season-summits')) el('season-summits').textContent = seasonUnique;
  if (el('season-points')) el('season-points').textContent = seasonPts.toLocaleString('de');
  // Header-Punkte auf aktuelle Saison setzen
  const headerPunkteEl = document.getElementById('user-points');
  if (headerPunkteEl) headerPunkteEl.textContent = seasonPts.toLocaleString('de') + ' Pkt';

  // HM berechnen — dedupliziert nach Aktivität
  let seasonHM = 0;
  const seenHM = new Set();
  for (const s of seasonSummits) {
    const key = s.strava_activity_id || s.peak_id;
    if (seenHM.has(key)) continue;
    seenHM.add(key);
    if (s.elevation_gain && s.elevation_gain > 0) seasonHM += s.elevation_gain;
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

  // Kronen berechnen: König bleibt bis jemand anderes den Berg in der neuen Saison besteigt
  let crownCount = 0;
  let currentSeasonCrownCount = 0; // NUR Kronen aus aktueller Saison (für Lose!)
  const userId = window._currentUserId;
  const peakIds = [...new Set(seasonSummits.filter(s => s.peak_id).map(s => s.peak_id))];

  // Auch Gipfel laden, auf denen der User im Vorjahr König war (Kronen-Übernahme)
  const prevYear = (year - 1).toString();
  let carryOverPeakIds = [];
  if (userId) {
    const { data: prevSummits } = await GK.supabase
      .from('summits')
      .select('peak_id')
      .eq('user_id', userId)
      .eq('season', prevYear)
      .not('peak_id', 'is', null);
    if (prevSummits) {
      carryOverPeakIds = [...new Set(prevSummits.map(s => s.peak_id))].filter(pid => !peakIds.includes(pid));
    }
  }

  const allCrownPeakIds = [...peakIds, ...carryOverPeakIds];

  if (userId && allCrownPeakIds.length > 0) {
    for (const pid of allCrownPeakIds) {
      // Aktuelle Saison prüfen
      const { data: currentSummits } = await GK.supabase
        .from('summits')
        .select('user_id')
        .eq('peak_id', pid)
        .eq('season', yearStr);

      if (currentSummits && currentSummits.length > 0) {
        // Jemand war in dieser Saison dort → normal zählen
        const counts = {};
        for (const s of currentSummits) {
          counts[s.user_id] = (counts[s.user_id] || 0) + 1;
        }
        const maxCount = Math.max(...Object.values(counts));
        if ((counts[userId] || 0) === maxCount) {
          crownCount++;
          currentSeasonCrownCount++; // Aktuelle Saison → zählt für Lose!
        }
      } else {
        // Niemand war in dieser Saison dort → Vorjahres-König bleibt König
        // ABER: Vorjahres-Kronen geben KEINE Lose!
        const { data: prevSeasonSummits } = await GK.supabase
          .from('summits')
          .select('user_id')
          .eq('peak_id', pid)
          .eq('season', prevYear);
        if (prevSeasonSummits && prevSeasonSummits.length > 0) {
          const counts = {};
          for (const s of prevSeasonSummits) {
            counts[s.user_id] = (counts[s.user_id] || 0) + 1;
          }
          const maxCount = Math.max(...Object.values(counts));
          if ((counts[userId] || 0) === maxCount) {
            crownCount++; // König vom Vorjahr bleibt (für Anzeige)
            // KEIN currentSeasonCrownCount++ → keine Lose für Vorjahres-Kronen!
          }
        }
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

  // km berechnen — dedupliziert nach Aktivität
  let seasonKM = 0;
  const seenKM = new Set();
  for (const s of seasonSummits) {
    const key = s.strava_activity_id || s.peak_id;
    if (seenKM.has(key)) continue;
    seenKM.add(key);
    if (s.distance && s.distance > 0) seasonKM += s.distance;
  }
  if (el('season-km')) el('season-km').textContent = seasonKM.toLocaleString('de');

  // Lose NUR fuer diese Saison (nicht uebertragbar!)
  const gipfelLose = seasonUnique;                    // 1 Los pro Gipfel (unique)
  const koenigLose = currentSeasonCrownCount * 5;      // 5 Lose pro Krone (NUR aktuelle Saison!)
  let gebietLose = 0;                                 // 15 Lose pro Gebiet
  const potdLose = 0;                                 // Gipfel des Tages (TODO)

  // Gebiete zaehlen: Hex-Territorien wo User die meisten verschiedenen Gipfel hat
  try {
    if (userId && seasonSummits.length > 0) {
      const HEX_SIZE = 5, LAT_KM = 111.32, LNG_KM = 75.9;
      const sLat = HEX_SIZE / LAT_KM, sLng = HEX_SIZE / LNG_KM;
      const colSp = 1.5 * sLng, rowSp = Math.sqrt(3) * sLat;

      // Meine Peaks pro Hex zaehlen
      const myHexPeaks = {};
      const uniquePeakIds = [...new Set(seasonSummits.map(s => s.peak_id))];
      for (const pid of uniquePeakIds) {
        const peak = window._allPeaksCache ? window._allPeaksCache[pid] : null;
        if (!peak) continue;
        const col = Math.round(peak.lng / colSp);
        const rowOff = (col % 2 !== 0) ? rowSp / 2 : 0;
        const row = Math.round((peak.lat - rowOff) / rowSp);
        const key = col + ',' + row;
        if (!myHexPeaks[key]) myHexPeaks[key] = new Set();
        myHexPeaks[key].add(pid);
      }

      // Pro Hex pruefen ob ich die meisten habe (vereinfacht: Gebiete aus loadTerritories Cache)
      if (window._hexTerritoryKings) {
        let myTerritories = 0;
        for (const [hexKey, king] of Object.entries(window._hexTerritoryKings)) {
          if (king.userId === userId) myTerritories++;
        }
        gebietLose = myTerritories * 15;
      }
    }
  } catch (e) { console.warn('Gebiet-Lose Fehler:', e); }
  const punkteLose = Math.floor(seasonPts / 1000);    // 1 Los pro 1000 Pkt
  const hmLose = Math.floor(seasonHM / 10000);        // 1 Los pro 10.000 HM
  const kmLose = Math.floor(seasonKM / 100);          // 1 Los pro 100 km
  const total = gipfelLose + koenigLose + gebietLose + potdLose + punkteLose + hmLose + kmLose;

  const setEl = (id, val) => { const e = document.getElementById(id); if(e) e.textContent = val; };
  setEl('tickets-total', total);
  setEl('header-lose', total > 0 ? total + ' Lose' : '');
  setEl('tickets-gipfel', gipfelLose);
  setEl('lose-gipfel-count', seasonUnique);
  setEl('tickets-koenig', koenigLose);
  setEl('tickets-gebiet', gebietLose);
  setEl('tickets-potd', potdLose);
  setEl('tickets-punkte', punkteLose);
  setEl('tickets-hm', hmLose);
  setEl('tickets-km', kmLose);
  // Neue Detail-Werte für die Saison-Übersicht
  setEl('tickets-koenig-count', currentSeasonCrownCount);
  setEl('tickets-punkte-val', seasonPts.toLocaleString('de'));
  setEl('tickets-hm-val', seasonHM.toLocaleString('de'));
  setEl('tickets-km-val', seasonKM.toLocaleString('de'));

  // "Nächstes Los" Motivation berechnen — was ist am nächsten dran?
  const nextLosHints = [];
  const hmBisLos = 10000 - (seasonHM % 10000);
  const kmBisLos = 100 - (seasonKM % 100);
  const pktBisLos = 1000 - (seasonPts % 1000);
  // Das nächste Los: welches ist am schnellsten erreichbar?
  if (hmBisLos <= 3000) nextLosHints.push('Noch ' + hmBisLos.toLocaleString('de') + ' HM bis zum nächsten HM-Los!');
  if (kmBisLos <= 20) nextLosHints.push('Noch ' + kmBisLos + ' km bis zum nächsten km-Los!');
  if (pktBisLos <= 500) nextLosHints.push('Noch ' + pktBisLos.toLocaleString('de') + ' Punkte bis zum nächsten Punkte-Los!');
  // Fallback: immer das nächste zeigen
  if (nextLosHints.length === 0) {
    // Welches ist am nächsten (prozentual)?
    const hmPct = (seasonHM % 10000) / 10000;
    const kmPct = (seasonKM % 50) / 50;
    const pktPct = (seasonPts % 1000) / 1000;
    if (hmPct >= kmPct && hmPct >= pktPct) nextLosHints.push('Noch ' + hmBisLos.toLocaleString('de') + ' HM bis zum nächsten HM-Los!');
    else if (kmPct >= hmPct && kmPct >= pktPct) nextLosHints.push('Noch ' + kmBisLos + ' km bis zum nächsten km-Los!');
    else nextLosHints.push('Noch ' + pktBisLos.toLocaleString('de') + ' Punkte bis zum nächsten Punkte-Los!');
  }
  const nextLosEl = el('next-los-hint');
  if (nextLosEl) nextLosEl.textContent = nextLosHints[0];

  // Global speichern für Gipfel-Tab
  window._nextLosHints = nextLosHints;
  window._seasonStats = { seasonHM, seasonKM, seasonPts, hmBisLos, kmBisLos, pktBisLos };

  // Losnummern mit DB synchronisieren (zufällige Nummern 1-10000)
  if (userId) {
    await syncRaffleTickets(userId, yearStr, {
      gipfel: gipfelLose,
      krone: koenigLose,
      punkte: punkteLose,
      hm: hmLose,
      km: kmLose
    });
  }

  } catch (err) {
    console.warn('loadProfileForSeason Fehler (nicht kritisch):', err.message);
  }
}

// ---------------------------------------------------------------------------
// Losnummern-Sync: DB ↔ berechnete Ansprüche
// Jedes Los bekommt eine zufällige Nummer 1-10000 (pro Saison einzigartig)
// ---------------------------------------------------------------------------
async function syncRaffleTickets(userId, season, expected) {
  try {
    console.log('syncRaffleTickets gestartet:', userId, season, expected);
    // Aktuelle Tickets aus DB laden
    const { data: existing, error } = await GK.supabase
      .from('raffle_tickets')
      .select('id, ticket_number, source, source_ref')
      .eq('user_id', userId)
      .eq('season', season)
      .order('source', { ascending: true });

    if (error) {
      // Tabelle existiert evtl. noch nicht — still ignorieren
      console.warn('Raffle-Tickets konnten nicht geladen werden:', error.message);
      return;
    }

    // Nach Quelle gruppieren
    const bySource = {};
    for (const t of (existing || [])) {
      if (!bySource[t.source]) bySource[t.source] = [];
      bySource[t.source].push(t);
    }

    // Pro Quelle: fehlende hinzufügen, überschüssige löschen
    for (const [source, count] of Object.entries(expected)) {
      const current = bySource[source] || [];
      const diff = count - current.length;

      if (diff > 0) {
        // Fehlende Tickets hinzufügen mit zufälligen Nummern
        // Bereits vergebene Nummern dieser Saison laden
        const { data: allNums } = await GK.supabase
          .from('raffle_tickets')
          .select('ticket_number')
          .eq('season', season);
        const taken = new Set((allNums || []).map(t => t.ticket_number));

        for (let i = 0; i < diff; i++) {
          // Zufällige Nummer finden die noch nicht vergeben ist
          let num;
          let attempts = 0;
          do {
            num = Math.floor(Math.random() * 100000) + 1;
            attempts++;
          } while (taken.has(num) && attempts < 100);

          if (taken.has(num)) {
            // Alle beliebt Nummern vergeben? Sequenziell suchen
            for (let n = 1; n <= 100000; n++) {
              if (!taken.has(n)) { num = n; break; }
            }
          }

          taken.add(num);
          const ref = source === 'punkte' ? 'punkte-' + (count * 1000) :
                      source === 'hm' ? 'hm-' + (count * 10000) :
                      source === 'km' ? 'km-' + (count * 50) : null;

          var insertResult = await GK.supabase.from('raffle_tickets').insert({
            user_id: userId, season: season, ticket_number: num,
            source: source, source_ref: ref
          });
          if (insertResult.error) {
            console.warn('Ticket #' + num + ' insert fehlgeschlagen:', insertResult.error.message, insertResult.error.code);
            // Bei UNIQUE violation (Nummer schon vergeben) → nächste Nummer versuchen
            if (insertResult.error.code === '23505') {
              taken.add(num);
              i--; // Retry mit anderer Nummer
              continue;
            }
          }
        }
      } else if (diff < 0) {
        // Überschüssige Tickets löschen (z.B. Krone verloren)
        const toDelete = current.slice(0, Math.abs(diff));
        for (const t of toDelete) {
          await GK.supabase.from('raffle_tickets').delete().eq('id', t.id);
        }
      }
    }

    // Tickets für Anzeige neu laden
    const { data: tickets } = await GK.supabase
      .from('raffle_tickets')
      .select('ticket_number, source')
      .eq('user_id', userId)
      .eq('season', season)
      .order('ticket_number', { ascending: true });

    // In Dropdown rendern
    const dropdownEl = document.getElementById('ticket-numbers-list');
    if (dropdownEl && tickets && tickets.length > 0) {
      const sourceEmoji = { gipfel: '⛰️', krone: '👑', punkte: '📊', hm: '🏔️', km: '🥾' };
      const sourceLabel = { gipfel: 'Gipfel', krone: 'Krone', punkte: 'Punkte', hm: 'Höhenmeter', km: 'Kilometer' };
      let html = '';
      // Nach Quelle gruppieren
      const grouped = {};
      for (const t of tickets) {
        if (!grouped[t.source]) grouped[t.source] = [];
        grouped[t.source].push(t.ticket_number);
      }
      for (const [src, nums] of Object.entries(grouped)) {
        html += '<div style="margin-bottom:6px;">';
        html += '<div style="font-size:0.72rem;color:var(--color-gold);font-weight:600;">' + (sourceEmoji[src] || '🎫') + ' ' + (sourceLabel[src] || src) + ' (' + nums.length + ')</div>';
        html += '<div style="font-size:0.7rem;color:var(--color-muted);font-family:var(--font-mono);line-height:1.6;">';
        html += nums.map(function(n) { return '<span style="display:inline-block;background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.2);border-radius:4px;padding:1px 6px;margin:2px;">#' + String(n).padStart(4, '0') + '</span>'; }).join(' ');
        html += '</div></div>';
      }
      dropdownEl.innerHTML = html;
    } else if (dropdownEl) {
      dropdownEl.innerHTML = '<div style="font-size:0.75rem;color:var(--color-muted);text-align:center;">Noch keine Losnummern</div>';
    }

    window._raffleTickets = tickets || [];

  } catch (err) {
    console.warn('syncRaffleTickets Fehler:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Strava OAuth — Platzhalter-Konfiguration
// ---------------------------------------------------------------------------
const STRAVA_CLIENT_ID = '211591';
// Client Secret nicht mehr im Frontend — Token-Exchange läuft über Edge Function
const STRAVA_REDIRECT_URI = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'app.html';
const STRAVA_AUTH_URL =
  'https://www.strava.com/oauth/authorize' +
  '?client_id=' + STRAVA_CLIENT_ID +
  '&redirect_uri=' + encodeURIComponent(STRAVA_REDIRECT_URI) +
  '&response_type=code' +
  '&scope=read,activity:read_all,activity:write';

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
    // Punkte werden von loadProfileForSeason auf Saison-Punkte gesetzt (nicht hier)

    // Laufenden Import erkennen (bei Seiten-Reload während Import)
    if ((profil.import_status === 'importing' || profil.import_status === 'pending') && profil.strava_token) {
      startPagedImport(benutzer.id, profil.strava_token);
    }
  }

  // Täglichen Login-Bonus prüfen
  // checkDailyReward(); -- entfernt

  // Kronen-Angriffe + Rivalen prüfen (im Hintergrund, blockiert nicht)
  checkCrownThreats(benutzer.id);

  // DB-Notifications laden + Client-seitige Checks (Wochenrueckblick, neue Preise)
  loadDbNotifications(benutzer.id);

  // Strava-OAuth-Callback verarbeiten (Code in URL-Parametern)
  const urlParams = new URLSearchParams(window.location.search);
  const stravaCode = urlParams.get('code');

  if (stravaCode) {
    try {
      console.log('Strava-Code erhalten, tausche gegen Token via Edge Function...');

      // Token-Austausch über Backend Edge Function (Client Secret bleibt serverseitig)
      const session = await GK.supabase.auth.getSession();
      const authToken = session?.data?.session?.access_token;
      const { data: exchangeResult, error: exchangeError } = await GK.supabase.functions.invoke('strava-exchange-token', {
        body: { code: stravaCode }
      });

      const result = typeof exchangeResult === 'string' ? JSON.parse(exchangeResult) : exchangeResult;

      if (exchangeError || !result?.success) {
        console.error('Strava Token-Tausch fehlgeschlagen:', result?.error || exchangeError);
        if (typeof GK.showToast === 'function') {
          GK.showToast('Strava-Verbindung fehlgeschlagen: ' + (result?.error || 'Unbekannter Fehler'), 'error');
        }
      } else {
        console.log('Strava erfolgreich verbunden via Edge Function!');

        // Profil neu laden um aktuelle Daten zu haben
        const updatedProfil = await GK.api.getUserProfile(benutzer.id);

        // Avatar aktualisieren
        const avatarEl = document.getElementById('user-avatar');
        if (avatarEl && updatedProfil?.avatar_url) {
          avatarEl.innerHTML = '<img src="' + updatedProfil.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        }

        // Erfolgs-Toast anzeigen
        if (typeof GK.showToast === 'function') {
          GK.showToast('Strava verbunden! Deine Gipfel werden im Hintergrund importiert...', 'success');
        }

        // Import-Status setzen und starten
        await GK.supabase.from('user_profiles').update({ import_status: 'importing' }).eq('id', benutzer.id);
        console.log('Starte seitenweisen Aktivitäten-Import...');
        startPagedImport(benutzer.id, updatedProfil.strava_token);
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
      .select('peak_id, points, summited_at, season, is_season_first, elevation_gain, distance, strava_activity_id')
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

      // Saison-Stats: neueste Saison mit Daten anzeigen (nicht immer aktuelles Jahr)
      const currentYear = new Date().getFullYear();
      window.currentProfileSeason = currentYear;
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

// Seitenweiser Import — page hochzählen, before für Zeitfenster
async function startPagedImport(userId, stravaToken) {
  const bar = document.getElementById('import-bar');
  const progressEl = document.getElementById('import-progress');
  const messageEl = document.getElementById('import-message');
  const percentEl = document.getElementById('import-percent');

  if (bar) bar.style.display = 'block';

  // Fortschritt laden: bis wohin wurde bereits importiert?
  const savedBefore = localStorage.getItem('import_before_' + userId);
  let beforeEpoch = savedBefore ? parseInt(savedBefore) : Math.floor(Date.now() / 1000);

  // Nur aktuelles Jahr + Vorjahr importieren (sonst dauert es zu lange)
  const currentYear = new Date().getFullYear();
  const importSince = Math.floor(new Date(currentYear - 1, 0, 1).getTime() / 1000);
  let totalSummits = 0;
  let totalPoints = 0;
  let currentPage = 1;
  let totalPages = 0;
  let consecutiveErrors = 0;
  const allPeaks = [];

  if (savedBefore) console.log('Import fortgesetzt — lade Aktivitäten vor ' + new Date(beforeEpoch * 1000).toLocaleDateString('de'));

  while (true) {
    try {
      totalPages++;
      // Fortschritt anzeigen
      const progress = Math.min(95, totalPages * 8);
      if (progressEl) progressEl.style.width = progress + '%';
      if (percentEl) percentEl.textContent = progress + '%';
      const dateStr = new Date(beforeEpoch * 1000).toLocaleDateString('de', { month: 'short', year: 'numeric' });
      if (messageEl) messageEl.textContent = (totalSummits > 0 ? totalSummits + ' Gipfel gefunden · ' : '') + dateStr + ' · GPS-Abgleich mit Gipfeln...';

      console.log('Import: vor ' + dateStr + ' (page=' + currentPage + ', total=' + totalPages + ')');

      const { data, error } = await GK.supabase.functions.invoke('import-activities', {
        body: { user_id: userId, strava_token: stravaToken, page: currentPage, before: beforeEpoch }
      });

      // Token-Fehler erkennen (Edge Function gibt 401 zurück → Supabase meldet FunctionsHttpError)
      if (error) {
        const errMsg = error.message || error.toString();
        // Token abgelaufen (401 von Edge Function)
        if (errMsg.includes('401') || errMsg.includes('non-2xx')) {
          // Versuche response body zu lesen
          let body = null;
          try { body = typeof data === 'string' ? JSON.parse(data) : data; } catch(e) {}
          if (body?.token_expired) {
            if (messageEl) messageEl.textContent = 'Strava Token abgelaufen — bitte neu verbinden';
            await GK.supabase.from('user_profiles').update({ import_status: 'done' }).eq('id', userId);
            localStorage.removeItem('import_before_' + userId);
            setTimeout(function() { if (bar) bar.style.display = 'none'; }, 5000);
            break;
          }
        }

        consecutiveErrors++;
        console.error('Import-Fehler (' + consecutiveErrors + '/5):', errMsg);
        if (consecutiveErrors >= 5) {
          if (messageEl) messageEl.textContent = 'Import fehlgeschlagen — bitte Strava neu verbinden';
          await GK.supabase.from('user_profiles').update({ import_status: 'done' }).eq('id', userId);
          localStorage.removeItem('import_before_' + userId);
          setTimeout(function() { if (bar) bar.style.display = 'none'; }, 5000);
          break;
        }
        if (messageEl) messageEl.textContent = 'Fehler — Retry in 5s...';
        await new Promise(function(r) { setTimeout(r, 5000); });
        continue;
      }
      consecutiveErrors = 0;

      const result = typeof data === 'string' ? JSON.parse(data) : data;
      console.log('Ergebnis:', result);

      // Token-Fehler im JSON Body erkennen
      if (result.token_expired) {
        if (messageEl) messageEl.textContent = 'Strava Token abgelaufen — bitte neu verbinden';
        await GK.supabase.from('user_profiles').update({ import_status: 'done' }).eq('id', userId);
        localStorage.removeItem('import_before_' + userId);
        setTimeout(function() { if (bar) bar.style.display = 'none'; }, 5000);
        break;
      }

      if (result.error) {
        console.error('Server-Fehler:', result.error);
        if (messageEl) messageEl.textContent = 'Fehler: ' + result.error;
        break;
      }

      // Rate Limit — warte 60s und versuche erneut (gleiche page + before)
      if (result.rate_limited) {
        console.log('Rate Limit — warte 60s...');
        if (messageEl) messageEl.textContent = 'Strava Rate Limit — warte 60 Sekunden...';
        await new Promise(function(r) { setTimeout(r, 60000); });
        // oldest_date updaten falls vorhanden, dann gleiche page nochmal
        if (result.oldest_date) {
          beforeEpoch = Math.floor(new Date(result.oldest_date).getTime() / 1000) - 1;
          localStorage.setItem('import_before_' + userId, beforeEpoch.toString());
          currentPage = 1; // Neuer Zeitraum, page zurücksetzen
        }
        totalSummits += result.summits_found || 0;
        totalPoints += result.points || 0;
        if (result.peaks) allPeaks.push(...result.peaks);
        continue;
      }

      totalSummits += result.summits_found || 0;
      totalPoints += result.points || 0;
      if (result.peaks) allPeaks.push(...result.peaks);

      // Header-Punkte live aktualisieren
      if (result.total_points) {
        var punkteEl = document.getElementById('user-points');
        if (punkteEl) punkteEl.textContent = result.total_points.toLocaleString('de') + ' Pkt';
      }

      // Gipfel-Toast bei Fund
      if (result.peaks && result.peaks.length > 0) {
        if (typeof GK.showToast === 'function') {
          GK.showToast(result.peaks.join(', '), 'success');
        }
      }

      // Ältestes Datum dieser Seite als nächsten "before" Marker setzen
      if (result.oldest_date) {
        beforeEpoch = Math.floor(new Date(result.oldest_date).getTime() / 1000) - 1;
        localStorage.setItem('import_before_' + userId, beforeEpoch.toString());
        currentPage = 1; // Neuer Zeitraum, page zurücksetzen
      } else {
        // Kein oldest_date → nächste Seite im gleichen Zeitraum
        currentPage++;
      }

      // Stopp wenn älter als 1. Januar Vorjahr
      if (beforeEpoch < importSince) {
        console.log('Import: Zeitlimit erreicht (ab ' + (currentYear - 1) + ')');
        result.done = true;
      }

      if (result.done || !result.has_more) {
        console.log('Import abgeschlossen! ' + totalSummits + ' Gipfel, ' + totalPoints + ' Punkte');
        if (progressEl) progressEl.style.width = '100%';
        if (percentEl) percentEl.textContent = '100%';
        if (messageEl) messageEl.textContent = totalSummits + ' Gipfel gefunden · ' + totalPoints.toLocaleString('de') + ' Punkte · Daten werden geladen...';

        await GK.supabase.from('user_profiles').update({ import_status: 'done' }).eq('id', userId);
        localStorage.removeItem('import_before_' + userId);

        // Auto-Refresh: Profil, Summits und Karte neu laden
        try {
          // Summits-Cache neu laden
          var { data: freshSummits } = await GK.supabase
            .from('summits')
            .select('peak_id, points, summited_at, season, is_season_first, elevation_gain, distance, strava_activity_id')
            .eq('user_id', userId)
            .order('summited_at', { ascending: false });
          if (freshSummits) {
            window._allSummitsCache = freshSummits;
            window._currentUserId = userId;
          }

          // Profil neu laden und Header aktualisieren
          var freshProfil = await GK.api.getUserProfile(userId);
          if (freshProfil) {
            var punkteHeader = document.getElementById('user-points');
            if (punkteHeader) punkteHeader.textContent = (freshProfil.total_points || 0).toLocaleString('de') + ' Pkt';
          }

          // Saison-Stats neu berechnen
          var seasonYear = window.currentProfileSeason || new Date().getFullYear();
          await loadProfileForSeason(seasonYear);

          // Gipfel-Tab neu laden
          if (GK.summits && GK.summits.loadMySummits) GK.summits.loadMySummits();

          // Karte: Marker + Hexagone neu laden
          if (GK.map && GK.map.loadUserSummits) GK.map.loadUserSummits();
          if (GK.map && GK.map.loadHexagons) GK.map.loadHexagons();

          // Feed neu laden
          if (typeof loadFeed === 'function') loadFeed();

          // Leaderboard aktualisieren
          if (GK.game && GK.game.loadLeaderboard) GK.game.loadLeaderboard();

          console.log('Auto-Refresh nach Import abgeschlossen');
        } catch (refreshErr) {
          console.warn('Auto-Refresh teilweise fehlgeschlagen:', refreshErr.message);
        }

        if (messageEl) messageEl.textContent = totalSummits + ' Gipfel gefunden · ' + totalPoints.toLocaleString('de') + ' Punkte';

        if (typeof GK.showToast === 'function') {
          GK.showToast('Import fertig! ' + totalSummits + ' Gipfel erkannt!', 'success');
        }

        setTimeout(function() {
          if (bar) bar.style.display = 'none';
        }, 5000);
        break;
      }

    } catch (err) {
      console.error('Import Fehler:', err);
      if (totalPages > 100) break;
    }
  }
}

// Browser-seitiger Import (importStravaActivities) wurde entfernt
// Import läuft jetzt komplett über die Edge Function import-activities

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
// DB-persistiert + In-Memory Session-Notifications
// ============================
const _notifications = [];       // In-Memory (Session, z.B. Rival-Check)
let _dbNotificationsLoaded = false;
let _currentNotifUserId = null;

// DB-Notifications laden und mit Client-Checks kombinieren
async function loadDbNotifications(userId) {
  try {
    _currentNotifUserId = userId;
    window._currentNotifUserId = userId;

    // 1. DB-Notifications laden
    await GK.notifications.loadNotifications(userId);
    _dbNotificationsLoaded = true;

    // 2. Client-seitige Checks (Wochenrueckblick + neue Preise)
    const [recap, prizes] = await Promise.all([
      GK.notifications.checkWeeklyRecap(userId),
      GK.notifications.checkNewPrizes()
    ]);

    if (recap) _notifications.unshift(recap);
    if (prizes) _notifications.unshift(prizes);

    // Rendering aktualisieren
    updateNotifBadge();
    renderNotifications();
  } catch (err) {
    console.error('DB-Notifications laden:', err);
  }
}

function addNotification(icon, text, type) {
  _notifications.unshift({ icon, text, type, time: new Date() });
  if (_notifications.length > 20) _notifications.pop();
  updateNotifBadge();
  renderNotifications();
}

// Alle Notifications zusammenfuehren (DB + In-Memory), sortiert nach Zeit
function getAllNotifications() {
  const dbNotifs = _dbNotificationsLoaded ? GK.notifications.getDbNotifications() : [];
  const all = [..._notifications, ...dbNotifs];
  all.sort((a, b) => b.time.getTime() - a.time.getTime());
  return all.slice(0, 30);
}

function updateNotifBadge() {
  const countEl = document.getElementById('notif-count');
  const all = getAllNotifications();
  const unread = all.filter(n => !n.read).length;
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
  const all = getAllNotifications();
  if (all.length === 0) {
    list.innerHTML = '<div style="padding:12px 14px;font-size:0.75rem;color:var(--color-muted);text-align:center;">Keine Benachrichtigungen</div>';
    return;
  }
  list.innerHTML = all.map(n => {
    const ago = timeAgo(n.time);
    const bg = n.read ? '' : 'background:rgba(201,168,76,0.06);';
    const clickAttr = n.data && n.data.url
      ? 'onclick="window.location.href=\'' + n.data.url + '\'"'
      : 'onclick="this.style.background=\'none\'"';
    return '<div style="padding:8px 14px;border-bottom:1px solid var(--color-border);' + bg + 'cursor:pointer;" ' + clickAttr + '>'
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
    // Alle als gelesen markieren (In-Memory + DB)
    _notifications.forEach(n => n.read = true);
    if (_currentNotifUserId && _dbNotificationsLoaded) {
      GK.notifications.markAllRead(_currentNotifUserId);
    }
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

// Global verfuegbar machen
window.toggleNotifDropdown = toggleNotifDropdown;
window.addNotification = addNotification;
window.updateNotifBadge = updateNotifBadge;

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
    loadSponsorTicker();
  }
});

// Sponsor-Ticker im App Header laden
// Sponsor-Ticker — zeigt nur Sponsoren die für die Heimat-Region des Users relevant sind
async function loadSponsorTicker() {
  const container = document.getElementById('sponsor-header-ticker');
  if (!container) return;
  try {
    // Alle aktiven Sponsoren laden
    const { data: sponsors } = await GK.supabase
      .from('sponsors')
      .select('company_name, logo_url, website_url, product_url, prize_name, hex_regions, all_regions')
      .eq('status', 'active');

    if (!sponsors || sponsors.length === 0) { container.style.display = 'none'; return; }

    // Cache für Karten-Overlay
    GK.map = GK.map || {};
    GK.map._sponsors = sponsors;

    // User-Heimatort für Filterung (aus Profil oder Browser-GPS)
    var userHexKey = null;
    try {
      var userId = GK.map._currentUserId;
      if (userId) {
        var profil = await GK.api.getUserProfile(userId);
        if (profil && profil.home_lat && profil.home_lng) {
          // Hex-Zelle des Heimatorts berechnen
          var HEX_SIZE = 5, LAT_KM = 111.32, LNG_KM = 75.9;
          var sLat = HEX_SIZE/LAT_KM, sLng = HEX_SIZE/LNG_KM;
          var colSp = 1.5*sLng, rowSp = Math.sqrt(3)*sLat;
          var col = Math.round(profil.home_lng/colSp);
          var rowOff = (col%2!==0) ? rowSp/2 : 0;
          var row = Math.round((profil.home_lat-rowOff)/rowSp);
          userHexKey = col+','+row;
        }
      }
    } catch(e) {}

    // Filtern: all_regions ODER User-Hex in hex_regions
    var filtered = sponsors.filter(function(s) {
      if (s.all_regions) return true;
      if (!userHexKey || !s.hex_regions || s.hex_regions.length === 0) return s.all_regions;
      return s.hex_regions.indexOf(userHexKey) !== -1;
    });

    // Fallback: wenn keine regionalen Sponsoren, zeige alle
    if (filtered.length === 0) filtered = sponsors;

    // Gruppiere nach Sponsor — gleicher Name nur 1x, dann alle Preise hintereinander
    var grouped = {};
    filtered.forEach(function(s) {
      if (!grouped[s.company_name]) grouped[s.company_name] = { sponsor: s, prizes: [] };
      grouped[s.company_name].prizes.push(s);
    });

    var tickerHtml = '';
    Object.values(grouped).forEach(function(g) {
      var s = g.sponsor;
      var logo = s.logo_url ? '<img src="' + s.logo_url + '" style="height:32px;border-radius:4px;margin-right:6px;">' : '';
      // Logo + "Firma sponsort folgendes:"
      tickerHtml += '<span class="sponsor-ticker-item" style="margin-right:6px;">' +
        logo + '<span style="color:var(--color-text);">' + s.company_name + '</span>' +
        '<span style="color:var(--color-muted);margin-left:6px;">sponsort:</span></span>';
      // Alle Preise mit Wert in Klammer
      g.prizes.forEach(function(p) {
        var preis = p.prize_value ? ' (' + p.prize_value + ')' : '';
        tickerHtml += '<a href="/prizes.html" class="sponsor-ticker-item">' +
          '<span class="sponsor-prize">' + p.prize_name + preis + '</span></a>';
      });
      tickerHtml += '<span style="margin:0 3rem;"></span>';
    });

    // Doppelt für nahtlosen Loop
    var track = document.createElement('div');
    track.className = 'sponsor-ticker-track';
    track.innerHTML = tickerHtml + tickerHtml;
    container.appendChild(track);
  } catch (e) {
    console.warn('Sponsor-Ticker Fehler:', e);
  }
}
