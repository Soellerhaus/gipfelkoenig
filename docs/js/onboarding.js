// =============================================================================
// Bergkönig — Onboarding-Aha-Moment (onboarding.js)
// Beim ersten App-Start: zeigt die nächste FREIE Krone in der Nähe und gibt
// ein sofortiges Ziel ("hol sie dir!"). Neue Nutzer haben damit von der ersten
// Sekunde an einen Grund loszuziehen — statt nur eine leere Karte zu sehen.
// =============================================================================

window.GK = window.GK || {};
GK.onboarding = {};

// ===========================================================================
// Sicherheits-Disclaimer — einmalig beim ersten App-Start, muss bestaetigt
// werden. Bergkoenig ist ein Spiel, kein Tourenplaner. Wo Lawinendaten
// vorliegen, sperren wir gefaehrliche Gipfel — ueberall sonst gilt:
// auf eigene Verantwortung.
// ===========================================================================
(function () {
  'use strict';
  const ACK = 'bergkoenig_safety_ack_v1';

  function showDisclaimer() {
    if (localStorage.getItem(ACK)) return;
    if (document.getElementById('gk-safety-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'gk-safety-modal';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.7);' +
      'display:flex;align-items:center;justify-content:center;padding:18px;';
    overlay.innerHTML =
      '<div style="max-width:420px;background:linear-gradient(135deg,#2a2620,#1c1915);' +
      'border:1px solid var(--color-gold,#c9a84c);border-radius:16px;padding:22px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.6);">' +
        '<div style="font-size:2rem;text-align:center;margin-bottom:8px;">⚠️</div>' +
        '<h2 style="font-family:var(--font-display,serif);color:var(--color-gold,#c9a84c);' +
        'text-align:center;margin:0 0 12px;font-size:1.2rem;">Sicherheitshinweis</h2>' +
        '<p style="color:var(--color-cream,#f0ece4);font-size:0.85rem;line-height:1.5;margin:0 0 10px;">' +
          'Bergkönig ist ein <strong>Spiel</strong>, kein Tourenplaner. Berge bergen echte ' +
          'Gefahren — Lawinen, Wetter, Absturz. Du bist <strong>auf eigene Verantwortung</strong> unterwegs.' +
        '</p>' +
        '<p style="color:var(--color-muted,#a89b86);font-size:0.78rem;line-height:1.5;margin:0 0 18px;">' +
          'Prüfe Verhältnisse, Lawinenlage und dein Können immer selbst. Wo Lawinendaten ' +
          'vorliegen, sperren wir gefährliche Gipfel — verlass dich aber nie allein darauf.' +
        '</p>' +
        '<button id="gk-safety-ok" style="width:100%;background:var(--color-gold,#c9a84c);' +
        'color:#1a1814;border:none;padding:11px;border-radius:10px;font-weight:700;' +
        'font-size:0.9rem;cursor:pointer;">Verstanden — auf eigene Gefahr</button>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.querySelector('#gk-safety-ok').addEventListener('click', function () {
      localStorage.setItem(ACK, new Date().toISOString());
      overlay.remove();
    });
  }

  GK.onboarding.showSafetyDisclaimer = showDisclaimer;
  GK.onboarding.resetSafetyAck = function () { localStorage.removeItem(ACK); };

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(showDisclaimer, 600); // vor dem Kronen-Banner
  });
})();

(function () {
  'use strict';

  const FLAG = 'bergkoenig_onboarded_v1';

  function getSeason() { return new Date().getFullYear().toString(); }

  /** Luftlinie in km (Haversine) */
  function distKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Warten bis die Karte initialisiert ist (max ~10s) */
  function waitForMap() {
    return new Promise(resolve => {
      let tries = 0;
      const iv = setInterval(() => {
        if (GK.map && GK.map.leaflet) { clearInterval(iv); resolve(true); }
        else if (++tries > 50) { clearInterval(iv); resolve(false); }
      }, 200);
    });
  }

  /** Eingeloggte User-ID (lokal, ohne Netzwerk) */
  async function getUserId() {
    try {
      const { data: { session } } = await GK.supabase.auth.getSession();
      return session && session.user ? session.user.id : null;
    } catch (e) { return null; }
  }

  /** Nächste freie Krone (reachable Gipfel ohne Besitzer in dieser Saison) finden */
  async function findNearestFreeCrown(center) {
    const lat = center.lat, lng = center.lng;
    // Großzügige Box um die Kartenmitte (~25–30 km)
    const pad = 0.35;
    const { data: peaks } = await GK.supabase
      .from('peaks')
      .select('id, name, elevation, lat, lng')
      .gte('lat', lat - pad).lte('lat', lat + pad)
      .gte('lng', lng - pad).lte('lng', lng + pad)
      .or('reachable.eq.true,reachable.is.null')
      .not('elevation', 'is', null)
      .limit(400);

    if (!peaks || peaks.length === 0) return null;

    // Besitz (Kronen) dieser Saison für diese Gipfel laden
    const ids = peaks.map(p => p.id);
    const owned = new Set();
    const batch = 200;
    for (let i = 0; i < ids.length; i += batch) {
      const { data: own } = await GK.supabase
        .from('ownership')
        .select('peak_id')
        .eq('season', getSeason())
        .in('peak_id', ids.slice(i, i + batch));
      if (own) for (const o of own) owned.add(o.peak_id);
    }

    // Nächsten freien Gipfel wählen
    let best = null, bestD = Infinity;
    for (const p of peaks) {
      if (owned.has(p.id)) continue;
      const d = distKm(lat, lng, p.lat, p.lng);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return null;
    return { peak: best, distKm: bestD };
  }

  /** Goldenes Onboarding-Banner anzeigen */
  function showBanner(html, onAction, actionLabel) {
    if (document.getElementById('gk-onboard-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'gk-onboard-banner';
    bar.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);top:60px;z-index:1500;' +
      'width:calc(100% - 24px);max-width:440px;' +
      'background:linear-gradient(135deg,#2a2620,#1c1915);' +
      'border:1px solid var(--color-gold,#c9a84c);border-radius:14px;' +
      'box-shadow:0 8px 30px rgba(0,0,0,0.5);padding:14px 16px;' +
      'animation:gkOnboardIn .4s ease;';

    bar.innerHTML =
      '<div style="display:flex;gap:10px;align-items:flex-start;">' +
        '<div style="font-size:1.6rem;line-height:1;">👑</div>' +
        '<div style="flex:1;font-size:0.85rem;color:var(--color-cream,#f0ece4);line-height:1.45;">' + html + '</div>' +
        '<button id="gk-onboard-x" aria-label="Schließen" style="background:none;border:none;color:#888;font-size:1.1rem;cursor:pointer;line-height:1;padding:0 2px;">✕</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
        (actionLabel ? '<button id="gk-onboard-go" style="flex:1;background:var(--color-gold,#c9a84c);color:#1a1814;border:none;padding:9px;border-radius:9px;font-weight:700;font-size:0.82rem;cursor:pointer;">' + actionLabel + '</button>' : '') +
        '<button id="gk-onboard-ok" style="flex:0 0 auto;background:rgba(255,255,255,0.06);color:var(--color-cream,#f0ece4);border:1px solid rgba(255,255,255,0.12);padding:9px 14px;border-radius:9px;font-size:0.82rem;cursor:pointer;">Los geht\'s</button>' +
      '</div>';

    // Keyframes einmalig injizieren
    if (!document.getElementById('gk-onboard-style')) {
      const st = document.createElement('style');
      st.id = 'gk-onboard-style';
      st.textContent = '@keyframes gkOnboardIn{from{opacity:0;transform:translate(-50%,-12px)}to{opacity:1;transform:translate(-50%,0)}}';
      document.head.appendChild(st);
    }

    document.body.appendChild(bar);

    const close = () => { bar.remove(); };
    bar.querySelector('#gk-onboard-x').addEventListener('click', close);
    bar.querySelector('#gk-onboard-ok').addEventListener('click', close);
    const goBtn = bar.querySelector('#gk-onboard-go');
    if (goBtn && onAction) {
      goBtn.addEventListener('click', () => { onAction(); close(); });
    }
  }

  async function run() {
    try {
      if (localStorage.getItem(FLAG)) return;

      const ok = await waitForMap();
      if (!ok) return;

      const userId = await getUserId();
      if (!userId) return;

      // Hat der Nutzer schon Gipfel? (bestimmt die Tonalität)
      let summitCount = 0;
      if (Array.isArray(window._allSummitsCache)) {
        summitCount = window._allSummitsCache.filter(s => s.peak_id).length;
      } else {
        const { count } = await GK.supabase
          .from('summits').select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        summitCount = count || 0;
      }

      const center = GK.map.leaflet.getCenter();
      const found = await findNearestFreeCrown(center);

      // Flag JETZT setzen — nur einmal anzeigen, egal ob etwas gefunden wurde
      localStorage.setItem(FLAG, new Date().toISOString());

      let html;
      let action = null;
      let actionLabel = null;

      if (found) {
        const p = found.peak;
        const dist = found.distKm < 1
          ? Math.round(found.distKm * 1000) + ' m'
          : found.distKm.toFixed(1) + ' km';
        const elev = p.elevation ? ' (' + p.elevation + ' m)' : '';
        html = '<strong>Freie Krone in der Nähe!</strong><br>' +
          '<span style="color:var(--color-gold,#c9a84c);font-weight:600;">' + p.name + elev + '</span> · ' + dist + ' Luftlinie<br>' +
          (summitCount === 0
            ? 'Sei der Erste oben — dein erster Gipfel = dein erstes Los 🎟️'
            : 'Als Erster oben holst du dir die Krone 👑');
        actionLabel = '🗺️ Auf der Karte zeigen';
        action = () => {
          try {
            GK.map.leaflet.setView([p.lat, p.lng], 14);
            const open = window.openPeakPanel || (GK.map && GK.map.openPeakPanel);
            if (typeof open === 'function') setTimeout(() => open(p.id), 350);
          } catch (e) { /* ignore */ }
        };
      } else if (summitCount === 0) {
        html = '<strong>Willkommen bei Bergkönig!</strong><br>' +
          'Verbinde Strava/Suunto oder mach einen GPS-Check-in am Gipfel. ' +
          'Jeder Gipfel bringt dir ein Los 🎟️ für die Saison-Verlosung.';
      } else {
        return; // nichts Sinnvolles zu zeigen
      }

      showBanner(html, action, actionLabel);
    } catch (e) {
      console.warn('Onboarding übersprungen:', e);
    }
  }

  GK.onboarding.run = run;
  GK.onboarding.reset = function () { localStorage.removeItem(FLAG); };

  document.addEventListener('DOMContentLoaded', () => {
    // Etwas verzögert, damit Karte + Peaks zuerst laden
    setTimeout(run, 1500);
  });
})();
