// =============================================================================
// Bergkönig — API-Schicht (api.js)
// Initialisiert den Supabase-Client und stellt alle Backend-Aufrufe bereit.
// =============================================================================

// Globaler Namespace
window.GK = window.GK || {};

// ---------------------------------------------------------------------------
// Supabase-Client initialisieren
// URL und Anon-Key werden später aus Umgebungsvariablen geladen.
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE';

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Client öffentlich verfügbar machen
GK.supabase = supabaseClient;

// ---------------------------------------------------------------------------
// API-Objekt mit allen Backend-Funktionen
// ---------------------------------------------------------------------------
GK.api = {};

/**
 * Gipfel innerhalb der Kartenbegrenzung abrufen.
 * @param {Object} bounds - { north, south, east, west }
 * @returns {Promise<Array>} Liste der Gipfel
 */
GK.api.getPeaks = async function (bounds) {
  try {
    const { data, error } = await supabaseClient
      .from('peaks')
      .select('*')
      .gte('lat', bounds.south)
      .lte('lat', bounds.north)
      .gte('lng', bounds.west)
      .lte('lng', bounds.east);

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Fehler beim Laden der Gipfel:', err);
    return [];
  }
};

/**
 * Einzelnen Gipfel anhand der ID abrufen.
 * @param {string} id - Gipfel-ID
 * @returns {Promise<Object|null>} Gipfel-Objekt oder null
 */
GK.api.getPeakById = async function (id) {
  try {
    const { data, error } = await supabaseClient
      .from('peaks')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Fehler beim Laden des Gipfels:', err);
    return null;
  }
};

/**
 * Sicherheitsstatus für eine Region und ein Datum abrufen.
 * @param {string} regionId - Regions-ID
 * @param {string} date - Datum im Format YYYY-MM-DD
 * @returns {Promise<Object|null>} Sicherheitsstatus oder null
 */
GK.api.getSafetyStatus = async function (regionId, date) {
  try {
    const { data, error } = await supabaseClient
      .from('safety_status')
      .select('*')
      .eq('region_id', regionId)
      .eq('date', date)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Fehler beim Laden des Sicherheitsstatus:', err);
    return null;
  }
};

/**
 * Benutzerprofil abrufen.
 * @param {string} userId - Benutzer-ID (UUID)
 * @returns {Promise<Object|null>} Profil-Objekt oder null
 */
GK.api.getUserProfile = async function (userId) {
  try {
    const { data, error } = await supabaseClient
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Fehler beim Laden des Benutzerprofils:', err);
    return null;
  }
};

/**
 * Benutzerprofil aktualisieren.
 * @param {string} userId - Benutzer-ID (UUID)
 * @param {Object} data - Zu aktualisierende Felder
 * @returns {Promise<Object|null>} Aktualisiertes Profil oder null
 */
GK.api.updateUserProfile = async function (userId, data) {
  try {
    const { data: updated, error } = await supabaseClient
      .from('user_profiles')
      .update(data)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return updated;
  } catch (err) {
    console.error('Fehler beim Aktualisieren des Benutzerprofils:', err);
    return null;
  }
};

/**
 * Gipfelbesteigungen (Summits) eines Benutzers für eine Saison abrufen.
 * @param {string} userId - Benutzer-ID (UUID)
 * @param {string} season - Saison-Bezeichnung, z. B. "2026"
 * @returns {Promise<Array>} Liste der Besteigungen
 */
GK.api.getSummits = async function (userId, season) {
  try {
    const { data, error } = await supabaseClient
      .from('summits')
      .select('*')
      .eq('user_id', userId)
      .eq('season', season);

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Fehler beim Laden der Besteigungen:', err);
    return [];
  }
};

/**
 * Besitzer eines Gipfels in einer bestimmten Saison abfragen.
 * @param {string} peakId - Gipfel-ID
 * @param {string} season - Saison-Bezeichnung
 * @returns {Promise<Object|null>} Besitz-Datensatz oder null
 */
GK.api.getOwnership = async function (peakId, season) {
  try {
    const { data, error } = await supabaseClient
      .from('ownership')
      .select('*')
      .eq('peak_id', peakId)
      .eq('season', season)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Fehler beim Laden der Gipfel-Besitzrechte:', err);
    return null;
  }
};

/**
 * Bestenliste abrufen — Top-Benutzer nach Gesamtpunkten.
 * @param {string} region - Regions-Filter (oder null für alle)
 * @param {string} season - Saison-Bezeichnung
 * @param {number} limit - Maximale Anzahl Einträge
 * @returns {Promise<Array>} Sortierte Bestenliste
 */
GK.api.getLeaderboard = async function (region, season, limit) {
  try {
    const { data, error } = await supabaseClient
      .from('user_profiles')
      .select('id, username, display_name, total_points')
      .gt('total_points', 0)
      .order('total_points', { ascending: false })
      .limit(limit || 10);

    if (error) throw error;

    // Gipfel-Anzahl pro User berechnen
    if (data) {
      for (const user of data) {
        const { count } = await supabaseClient
          .from('summits')
          .select('peak_id', { count: 'exact', head: true })
          .eq('user_id', user.id);
        user.summit_count = count || 0;
      }
    }

    return data;
  } catch (err) {
    console.error('Fehler beim Laden der Bestenliste:', err);
    return [];
  }
};

/**
 * Check-in durchführen — ruft die Supabase Edge Function auf.
 * @param {number} lat - Breitengrad
 * @param {number} lng - Längengrad
 * @returns {Promise<Object|null>} Ergebnis des Check-ins oder null
 */
GK.api.checkin = async function (lat, lng) {
  try {
    const { data, error } = await supabaseClient.functions.invoke('checkin', {
      body: { lat, lng },
    });

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Fehler beim Check-in:', err);
    return null;
  }
};

/**
 * Abzeichen (Badges) eines Benutzers abrufen.
 * @param {string} userId - Benutzer-ID (UUID)
 * @returns {Promise<Array>} Liste der Abzeichen
 */
GK.api.getBadges = async function (userId) {
  try {
    const { data, error } = await supabaseClient
      .from('badges')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Fehler beim Laden der Abzeichen:', err);
    return [];
  }
};
