/**
 * Bergkönig — Web-Push-Benachrichtigungen
 * Registrierung, Abo-Verwaltung und Fallback auf Telegram
 */

window.GK = window.GK || {};

window.GK.notifications = (() => {
  'use strict';

  // VAPID Public Key (muss durch echten Schlüssel ersetzt werden)
  const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY';

  /**
   * Prüfen ob der Browser Push-Benachrichtigungen unterstützt
   */
  function isSupported() {
    return 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
  }

  /**
   * VAPID-Schlüssel von Base64 in Uint8Array umwandeln
   * (wird für die PushManager-Subscription benötigt)
   */
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      output[i] = raw.charCodeAt(i);
    }
    return output;
  }

  /**
   * Berechtigung anfragen und Push-Abo einrichten
   * Wird beim ersten App-Start aufgerufen
   */
  async function init() {
    // Browser-Unterstützung prüfen
    if (!isSupported()) {
      console.info('Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.');
      showTelegramFallback();
      return;
    }

    // Aktuelle Berechtigung prüfen
    const permission = Notification.permission;

    if (permission === 'denied') {
      console.info('Push-Benachrichtigungen wurden vom Benutzer blockiert.');
      showTelegramFallback();
      return;
    }

    if (permission === 'default') {
      // Berechtigung anfragen
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        console.info('Berechtigung für Push-Benachrichtigungen nicht erteilt.');
        showTelegramFallback();
        return;
      }
    }

    // Push-Abo einrichten
    await subscribe();
  }

  /**
   * Service Worker registrieren und Push-Abo erstellen
   */
  async function subscribe() {
    try {
      const registration = await navigator.serviceWorker.ready;

      // Bestehendes Abo prüfen
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        // Neues Abo erstellen
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        console.info('Push-Abo erfolgreich erstellt.');
      }

      // Abo im Benutzerprofil speichern
      await saveSubscription(subscription);
    } catch (err) {
      console.error('Fehler beim Einrichten des Push-Abos:', err);
      showTelegramFallback();
    }
  }

  /**
   * Push-Subscription im Benutzerprofil speichern
   */
  async function saveSubscription(subscription) {
    try {
      await GK.api.updateUserProfile({
        push_subscription: JSON.stringify(subscription),
      });
      console.info('Push-Abo im Profil gespeichert.');
    } catch (err) {
      console.error('Fehler beim Speichern des Push-Abos:', err);
    }
  }

  /**
   * Push-Abo entfernen (abmelden)
   */
  async function unsubscribe() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        console.info('Push-Abo erfolgreich entfernt.');

        // Abo aus Profil entfernen
        await GK.api.updateUserProfile({ push_subscription: null });
      }
    } catch (err) {
      console.error('Fehler beim Entfernen des Push-Abos:', err);
    }
  }

  /**
   * Hinweis anzeigen, dass Telegram als Alternative verfügbar ist
   */
  function showTelegramFallback() {
    const container = document.getElementById('notification-fallback');
    if (!container) return;

    container.innerHTML = `
      <div class="notification-info">
        <p>Push-Benachrichtigungen sind in diesem Browser nicht verfügbar oder wurden deaktiviert.</p>
        <p>Als Alternative kannst du Benachrichtigungen über
          <a href="https://t.me/BergkoenigBot" target="_blank" rel="noopener">
            unseren Telegram-Bot
          </a> erhalten.
        </p>
      </div>
    `;
  }

  // --- Service Worker: Push-Event-Handler ---
  // (Wird im Service Worker selbst registriert, hier als Referenz)

  /**
   * Service Worker Push-Event registrieren
   * Muss im Service Worker-Skript aufgerufen werden (sw.js)
   */
  function registerServiceWorkerHandlers() {
    if (!('serviceWorker' in navigator)) return;

    // Hinweis: Dieser Code muss im Service Worker Kontext laufen.
    // Hier nur als Vorlage — in sw.js einfügen:
    //
    // self.addEventListener('push', (event) => {
    //   const data = event.data ? event.data.json() : {};
    //   const title = data.title || 'Bergkönig';
    //   const options = {
    //     body: data.body || 'Du hast eine neue Benachrichtigung.',
    //     icon: '/img/icon-192.png',
    //     badge: '/img/badge-72.png',
    //     data: data.url || '/',
    //   };
    //   event.waitUntil(self.registration.showNotification(title, options));
    // });
    //
    // self.addEventListener('notificationclick', (event) => {
    //   event.notification.close();
    //   event.waitUntil(clients.openWindow(event.notification.data));
    // });

    console.info('Service-Worker-Handler: Siehe sw.js für Push-Event-Registrierung.');
  }

  // --- Öffentliche API ---

  return {
    isSupported,
    init,
    subscribe,
    unsubscribe,
    showTelegramFallback,
    registerServiceWorkerHandlers,
  };
})();
