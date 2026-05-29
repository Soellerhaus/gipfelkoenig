// =============================================================================
// Bergkönig — Web-Push (push.js)
// Registriert den Service Worker, fragt die Push-Berechtigung ab, erzeugt eine
// Subscription und speichert sie in der Tabelle push_subscriptions.
// So erreichen wir Nutzer auch, wenn die App geschlossen ist (Krone angegriffen,
// überholt, ...). Privacy: Opt-in, jederzeit abschaltbar.
// =============================================================================

window.GK = window.GK || {};
GK.push = {};

(function () {
  'use strict';

  // VAPID Public Key (öffentlich, darf im Frontend stehen).
  // Der zugehörige Private Key liegt NUR als Supabase-Secret (VAPID_PRIVATE_KEY).
  const VAPID_PUBLIC_KEY = 'BGQNA4nvWterG5mujLhWsz1vV0xwDz0kFUjbzOXGhLfMXQsbzoPjZSwESNr1QNj4Vj9HgzNbmMgk_jUA_voKJV0';

  let swRegistration = null;

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  /** base64url → Uint8Array (für applicationServerKey) */
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  /** Service Worker registrieren (idempotent) */
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      return swRegistration;
    } catch (e) {
      console.warn('SW-Registrierung fehlgeschlagen:', e);
      return null;
    }
  }

  /** Aktuelle User-ID (lokal, ohne Netzwerk) */
  async function getUserId() {
    try {
      const { data: { session } } = await GK.supabase.auth.getSession();
      return session && session.user ? session.user.id : null;
    } catch (e) { return null; }
  }

  /** Subscription in Supabase speichern (upsert per endpoint) */
  async function saveSubscription(sub, userId) {
    const json = sub.toJSON();
    const row = {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 250),
    };
    const { error } = await GK.supabase
      .from('push_subscriptions')
      .upsert(row, { onConflict: 'endpoint' });
    if (error) throw error;
  }

  /** Push aktivieren: Berechtigung + Subscription + Speichern */
  async function enable() {
    if (!supported()) {
      if (GK.showToast) GK.showToast('Push wird auf diesem Gerät nicht unterstützt.', 'error');
      return false;
    }
    const userId = await getUserId();
    if (!userId) {
      if (GK.showToast) GK.showToast('Bitte zuerst anmelden.', 'error');
      return false;
    }

    try {
      const reg = swRegistration || await registerSW();
      if (!reg) throw new Error('Kein Service Worker');
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (GK.showToast) GK.showToast('Benachrichtigungen wurden nicht erlaubt.', 'error');
        refreshOptinUI();
        return false;
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      await saveSubscription(sub, userId);
      if (GK.showToast) GK.showToast('Push aktiviert 🔔', 'success');
      refreshOptinUI();
      return true;
    } catch (e) {
      console.error('Push-Aktivierung fehlgeschlagen:', e);
      if (GK.showToast) GK.showToast('Push konnte nicht aktiviert werden.', 'error');
      return false;
    }
  }

  /** Push abschalten (Subscription lokal + serverseitig entfernen) */
  async function disable() {
    try {
      const reg = swRegistration || (await navigator.serviceWorker.getRegistration());
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await GK.supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      }
      if (GK.showToast) GK.showToast('Push deaktiviert.', 'success');
      refreshOptinUI();
    } catch (e) {
      console.warn('Push-Deaktivierung fehlgeschlagen:', e);
    }
  }

  /** Ist Push aktuell aktiv (Permission + bestehende Subscription)? */
  async function isEnabled() {
    if (!supported() || Notification.permission !== 'granted') return false;
    try {
      const reg = swRegistration || (await navigator.serviceWorker.getRegistration());
      if (!reg) return false;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch (e) { return false; }
  }

  /** Opt-in-Karte im Notif-Dropdown zeigen/verstecken */
  async function refreshOptinUI() {
    const box = document.getElementById('push-optin');
    if (!box) return;
    // Nur zeigen, wenn unterstützt, eingeloggt, und noch NICHT aktiv/abgelehnt
    if (!supported() || Notification.permission === 'denied') { box.style.display = 'none'; return; }
    const userId = await getUserId();
    const active = await isEnabled();
    box.style.display = (userId && !active) ? 'block' : 'none';
  }

  // Beim Laden: SW registrieren + Subscription aktuell halten (falls schon erlaubt)
  async function init() {
    if (!supported()) return;
    await registerSW();
    // Falls bereits erlaubt & abonniert: Eintrag in DB sicherstellen (z.B. neues Gerät/Login)
    try {
      if (Notification.permission === 'granted') {
        await navigator.serviceWorker.ready;
        const reg = swRegistration || (await navigator.serviceWorker.getRegistration());
        const sub = reg && (await reg.pushManager.getSubscription());
        const userId = await getUserId();
        if (sub && userId) await saveSubscription(sub, userId).catch(() => {});
      }
    } catch (e) { /* still fine */ }
    refreshOptinUI();
  }

  GK.push.enable = enable;
  GK.push.disable = disable;
  GK.push.isEnabled = isEnabled;
  GK.push.refreshOptinUI = refreshOptinUI;
  GK.push.supported = supported;

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(init, 1200);
  });
})();
