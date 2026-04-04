/**
 * Bergkoenig — Benachrichtigungen (DB-persistiert)
 * Laedt Notifications aus Supabase, generiert Wochenrueckblick + neue Preise client-seitig
 */

window.GK = window.GK || {};

window.GK.notifications = (() => {
  'use strict';

  // DB-Notifications (persistiert)
  let _dbNotifications = [];

  /**
   * Alle Notifications aus der DB laden (letzte 30)
   */
  async function loadNotifications(userId) {
    try {
      const { data, error } = await GK.supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      _dbNotifications = data || [];
      return _dbNotifications;
    } catch (err) {
      console.error('Fehler beim Laden der Notifications:', err);
      return [];
    }
  }

  /**
   * Einzelne Notification als gelesen markieren
   */
  async function markAsRead(notificationId) {
    try {
      await GK.supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      const n = _dbNotifications.find(n => n.id === notificationId);
      if (n) n.read = true;
    } catch (err) {
      console.error('Fehler beim Markieren:', err);
    }
  }

  /**
   * Alle DB-Notifications als gelesen markieren
   */
  async function markAllRead(userId) {
    try {
      await GK.supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);

      _dbNotifications.forEach(n => n.read = true);
    } catch (err) {
      console.error('Fehler beim Markieren aller:', err);
    }
  }

  /**
   * Anzahl ungelesener DB-Notifications
   */
  function getUnreadCount() {
    return _dbNotifications.filter(n => !n.read).length;
  }

  /**
   * DB-Notifications als Array zurueckgeben (fuer Merge mit In-Memory)
   */
  function getDbNotifications() {
    return _dbNotifications.map(n => ({
      id: n.id,
      icon: n.icon || '🔔',
      text: n.body,
      title: n.title,
      type: n.type,
      time: new Date(n.created_at),
      read: n.read,
      data: n.data,
      fromDb: true
    }));
  }

  // ============================
  // Wochenrueckblick (Client-seitig)
  // ============================

  /**
   * Pruefen ob ein Wochenrueckblick angezeigt werden soll
   * Jeden Montag beim ersten App-Oeffnen
   */
  async function checkWeeklyRecap(userId) {
    try {
      const now = new Date();
      // Nur Montag (1) pruefen
      if (now.getDay() !== 1) return null;

      const weekKey = now.getFullYear() + '-W' + getWeekNumber(now);
      const storageKey = 'bergkoenig_weekly_recap_' + weekKey;
      if (localStorage.getItem(storageKey)) return null;

      // Summits der letzten 7 Tage laden
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const { data: summits, error } = await GK.supabase
        .from('summits')
        .select('peak_id, points, is_season_first, safety_ok')
        .eq('user_id', userId)
        .eq('safety_ok', true)
        .gte('summited_at', weekAgo.toISOString());

      if (error || !summits || summits.length === 0) {
        localStorage.setItem(storageKey, 'empty');
        return null;
      }

      // Stats berechnen
      const uniquePeaks = new Set(summits.map(s => s.peak_id)).size;
      const totalPoints = summits.reduce((sum, s) => sum + (s.points || 0), 0);
      const pioneers = summits.filter(s => s.is_season_first).length;

      // Neue Kronen zaehlen (Ownership-Check)
      const { data: crowns } = await GK.supabase
        .from('ownership')
        .select('peak_id')
        .eq('user_id', userId)
        .eq('season', now.getFullYear().toString())
        .gte('king_since', weekAgo.toISOString());

      const newCrowns = crowns ? crowns.length : 0;

      // Recap-Text bauen
      let body = 'Deine Woche: ' + uniquePeaks + ' Gipfel, ' + totalPoints + ' Punkte';
      if (newCrowns > 0) body += ', ' + newCrowns + ' neue Krone' + (newCrowns > 1 ? 'n' : '');
      if (pioneers > 0) body += ', ' + pioneers + ' Pionier' + (pioneers > 1 ? 'e' : '');
      body += '. Weiter so!';

      // Als In-Memory Notification hinzufuegen (nicht in DB, da client-seitig)
      localStorage.setItem(storageKey, 'shown');

      return {
        icon: '📊',
        text: body,
        title: 'Wochenrückblick',
        type: 'weekly_recap',
        time: new Date(),
        read: false,
        fromDb: false
      };
    } catch (err) {
      console.error('Wochenrückblick Fehler:', err);
      return null;
    }
  }

  /**
   * ISO Kalenderwoche berechnen
   */
  function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  // ============================
  // Neue Preise Check (Client-seitig)
  // ============================

  /**
   * Pruefen ob es neue Preise gibt seit dem letzten Check
   */
  async function checkNewPrizes() {
    try {
      const lastCheck = localStorage.getItem('bergkoenig_last_prize_check');
      const lastDate = lastCheck ? new Date(lastCheck) : new Date(0);

      // Sponsors mit neueren created_at laden
      const { data: newSponsors, error } = await GK.supabase
        .from('sponsors')
        .select('id, prize_name, created_at')
        .gt('created_at', lastDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(5);

      // Timestamp aktualisieren
      localStorage.setItem('bergkoenig_last_prize_check', new Date().toISOString());

      if (error || !newSponsors || newSponsors.length === 0) return null;

      const prizeNames = newSponsors.map(s => s.prize_name).filter(Boolean);
      let body;
      if (prizeNames.length === 1) {
        body = 'Neuer Preis: ' + prizeNames[0] + '! Schau dir die Gewinne an.';
      } else {
        body = prizeNames.length + ' neue Preise verfügbar! Schau dir die Gewinne an.';
      }

      return {
        icon: '🎁',
        text: body,
        title: 'Neue Preise',
        type: 'new_prize',
        time: new Date(),
        read: false,
        data: { url: 'prizes.html' },
        fromDb: false
      };
    } catch (err) {
      console.error('Prize check Fehler:', err);
      return null;
    }
  }

  // --- Oeffentliche API ---

  return {
    loadNotifications,
    markAsRead,
    markAllRead,
    getUnreadCount,
    getDbNotifications,
    checkWeeklyRecap,
    checkNewPrizes
  };
})();
