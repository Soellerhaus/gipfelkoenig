// =============================================================================
// Bergkönig — Capacitor-Bridge (native.js)
// Nur relevant in der nativen App (iOS/Android via Capacitor). Im Web ein No-Op.
//
// Aufgabe: OAuth (Strava/Suunto) sauber in der App abwickeln.
//  - openOAuth(url): oeffnet die Auth-Seite im System-Browser.
//  - Beim Ruecksprung (https://bergkoenig.app/settings.html?code=...) oeffnet
//    der Universal-Link (iOS) / App-Link (Android) die App -> appUrlOpen feuert
//    -> wir holen code/scope in die App-WebView, wo die bestehenden Callback-
//    Handler den Token-Tausch mit der eingeloggten Supabase-Session machen.
// =============================================================================

window.GK = window.GK || {};

(function () {
  'use strict';

  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

  GK.native = {
    isNative: isNative,
    platform: (Cap && typeof Cap.getPlatform === 'function') ? Cap.getPlatform() : 'web',
    // Auth-URL oeffnen: nativ im System-Browser, im Web normale Weiterleitung.
    openOAuth: function (url) {
      try {
        if (isNative && Cap.Plugins && Cap.Plugins.Browser) {
          Cap.Plugins.Browser.open({ url: url });
          return;
        }
      } catch (e) { /* faellt auf Weiterleitung zurueck */ }
      window.location.href = url;
    }
  };

  if (!isNative) return;

  // Deep-Link-Ruecksprung abfangen
  if (Cap.Plugins && Cap.Plugins.App && Cap.Plugins.App.addListener) {
    Cap.Plugins.App.addListener('appUrlOpen', function (data) {
      try {
        var url = (data && data.url) ? data.url : '';
        if (!url) return;
        var u = new URL(url);
        // Nur OAuth-Callbacks (code oder error) verarbeiten
        if (!u.searchParams.get('code') && !u.searchParams.get('error')) return;
        // System-Browser schliessen
        try {
          if (Cap.Plugins.Browser && Cap.Plugins.Browser.close) Cap.Plugins.Browser.close();
        } catch (e) {}
        // In der App-WebView zur Callback-Seite (mit code/scope) navigieren,
        // dort laufen handleStravaCallback / handleSuuntoCallback.
        var dest = (u.pathname || '/settings.html') + (u.search || '');
        window.location.href = dest;
      } catch (e) {
        console.error('appUrlOpen Fehler:', e);
      }
    });
  }
})();
