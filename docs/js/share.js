// =============================================================================
// Bergkönig — Teilbare Story-Cards (share.js)
// Zeichnet pro Tour/Gipfel eine quadratische Bild-Karte (Canvas) und teilt
// sie via Web Share API (WhatsApp/Instagram/...) oder bietet Download an.
// Jede geteilte Karte ist kostenlose Werbung → wichtigster Wachstumskanal.
// =============================================================================

window.GK = window.GK || {};
GK.share = {};

(function () {
  'use strict';

  // Markenfarben (Canvas braucht literale Werte, keine CSS-Variablen)
  const COL_BG_TOP = '#1f1c18';
  const COL_BG_BOT = '#100e0b';
  const COL_GOLD = '#c9a84c';
  const COL_CREAM = '#f0ece4';
  const COL_MUTED = '#9a948a';

  /** Sicherstellen, dass die Schriften geladen sind, bevor wir auf Canvas malen */
  async function ensureFonts() {
    try {
      if (document.fonts && document.fonts.ready) {
        // Konkrete Schnitte vorladen, sonst nimmt Canvas evtl. Fallback
        await Promise.all([
          document.fonts.load('900 96px "Playfair Display"'),
          document.fonts.load('700 48px "Playfair Display"'),
          document.fonts.load('400 32px "DM Sans"'),
          document.fonts.load('500 30px "DM Mono"'),
        ]).catch(() => {});
        await document.fonts.ready;
      }
    } catch (e) { /* Fallback-Schriften sind ok */ }
  }

  /** Ein einzelnes (zu langes) Wort hart umbrechen, damit es in maxWidth passt */
  function breakLongWord(ctx, word, maxWidth) {
    if (ctx.measureText(word).width <= maxWidth) return [word];
    const parts = [];
    let chunk = '';
    for (const ch of word) {
      const test = chunk + ch;
      if (ctx.measureText(test).width > maxWidth && chunk) {
        parts.push(chunk);
        chunk = ch;
      } else {
        chunk = test;
      }
    }
    if (chunk) parts.push(chunk);
    return parts;
  }

  /** Text in Zeilen umbrechen (Wörter + harte Trennung zu langer Wörter) */
  function wrapLines(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        // Falls das Wort selbst zu lang ist, hart umbrechen
        const broken = breakLongWord(ctx, w, maxWidth);
        line = broken.pop();
        for (const b of broken) lines.push(b);
      } else if (ctx.measureText(test).width > maxWidth && !line) {
        // Erstes Wort ist allein schon zu lang
        const broken = breakLongWord(ctx, w, maxWidth);
        line = broken.pop();
        for (const b of broken) lines.push(b);
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Text mittig zeichnen (vorab umgebrochene Zeilen) */
  function drawLinesCentered(ctx, lines, x, y, lineHeight) {
    const totalH = (lines.length - 1) * lineHeight;
    let yy = y - totalH / 2;
    for (const l of lines) {
      ctx.fillText(l, x, yy);
      yy += lineHeight;
    }
    return lines.length;
  }

  /**
   * Story-Card rendern.
   * @param {Object} o
   *   peakName, elevation, points, dateStr, hm, km,
   *   badges: [{emoji,label}], subtitle (z.B. "Pionier" / "Tour")
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function renderCard(o) {
    await ensureFonts();
    const S = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');

    // Hintergrund-Verlauf
    const bg = ctx.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, COL_BG_TOP);
    bg.addColorStop(1, COL_BG_BOT);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);

    // Dezenter Bergrücken-Schattenriss unten
    ctx.fillStyle = 'rgba(201,168,76,0.06)';
    ctx.beginPath();
    ctx.moveTo(0, S);
    ctx.lineTo(0, 760);
    ctx.lineTo(260, 560);
    ctx.lineTo(470, 720);
    ctx.lineTo(680, 470);
    ctx.lineTo(900, 700);
    ctx.lineTo(S, 540);
    ctx.lineTo(S, S);
    ctx.closePath();
    ctx.fill();

    // Goldener Rahmen
    ctx.strokeStyle = COL_GOLD;
    ctx.lineWidth = 4;
    ctx.strokeRect(40, 40, S - 80, S - 80);

    ctx.textAlign = 'center';

    // Wortmarke oben: Berg(könig)
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 54px "Playfair Display", Georgia, serif';
    const w1 = ctx.measureText('Berg').width;
    const w2 = ctx.measureText('könig').width;
    const startX = S / 2 - (w1 + w2) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = COL_CREAM;
    ctx.fillText('Berg', startX, 150);
    ctx.fillStyle = COL_GOLD;
    ctx.fillText('könig', startX + w1, 150);
    ctx.textAlign = 'center';

    // Subtitle / Kontext-Zeile
    if (o.subtitle) {
      ctx.font = '500 30px "DM Mono", monospace';
      ctx.fillStyle = COL_GOLD;
      ctx.fillText(o.subtitle.toUpperCase(), S / 2, 215);
    }

    // Großes Symbol
    ctx.font = '120px serif';
    ctx.fillText(o.icon || '⛰️', S / 2, 380);

    // Gipfelname — Schriftgröße automatisch verkleinern, bis er passt
    ctx.fillStyle = COL_CREAM;
    const nameText = o.peakName || 'Tour';
    const maxNameWidth = S - 200; // Sicherer Abstand zum goldenen Rahmen
    let fontPx = 84;
    let lines, lineHeight;
    while (true) {
      ctx.font = '900 ' + fontPx + 'px "Playfair Display", Georgia, serif';
      lines = wrapLines(ctx, nameText, maxNameWidth);
      // Breiteste Zeile prüfen (nach hartem Umbruch sollte alles passen)
      const widest = Math.max.apply(null, lines.map(l => ctx.measureText(l).width));
      // Nicht zu viele Zeilen, und Breite muss passen
      if ((widest <= maxNameWidth && lines.length <= 3) || fontPx <= 44) break;
      fontPx -= 6;
    }
    lineHeight = Math.round(fontPx * 1.1);
    const nameLines = drawLinesCentered(ctx, lines, S / 2, 500, lineHeight);

    // Höhe
    if (o.elevation) {
      ctx.fillStyle = COL_MUTED;
      ctx.font = '400 38px "DM Sans", sans-serif';
      ctx.fillText(o.elevation + ' m', S / 2, 500 + (nameLines * lineHeight) / 2 + 24);
    }

    // Punkte — groß und golden
    const pointsY = 740;
    ctx.fillStyle = COL_GOLD;
    ctx.font = '900 130px "Playfair Display", Georgia, serif';
    ctx.fillText('+' + (o.points || 0), S / 2, pointsY);
    ctx.fillStyle = COL_MUTED;
    ctx.font = '500 30px "DM Mono", monospace';
    ctx.fillText('PUNKTE', S / 2, pointsY + 44);

    // HM / km Zeile
    const stats = [];
    if (o.hm) stats.push('↑ ' + Number(o.hm).toLocaleString('de') + ' HM');
    if (o.km) stats.push('🥾 ' + o.km + ' km');
    if (stats.length) {
      ctx.fillStyle = COL_CREAM;
      ctx.font = '400 34px "DM Sans", sans-serif';
      ctx.fillText(stats.join('     '), S / 2, 850);
    }

    // Badges
    if (o.badges && o.badges.length) {
      ctx.font = '400 30px "DM Sans", sans-serif';
      const labels = o.badges.map(b => (b.emoji ? b.emoji + ' ' : '') + b.label);
      ctx.fillStyle = COL_GOLD;
      ctx.fillText(labels.join('   ·   '), S / 2, 905);
    }

    // Footer: Datum + URL
    ctx.fillStyle = COL_MUTED;
    ctx.font = '400 28px "DM Sans", sans-serif';
    if (o.dateStr) ctx.fillText(o.dateStr, S / 2, 975);
    ctx.fillStyle = COL_GOLD;
    ctx.font = '500 30px "DM Mono", monospace';
    ctx.fillText('bergkoenig.app', S / 2, 1015);

    return canvas;
  }

  /** Canvas → Blob */
  function toBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
  }

  /**
   * Story-Card erzeugen und teilen (Web Share API) bzw. herunterladen.
   * @param {Object} o siehe renderCard
   */
  async function shareCard(o) {
    let canvas;
    try {
      canvas = await renderCard(o);
    } catch (e) {
      console.error('Story-Card Rendering fehlgeschlagen:', e);
      if (GK.showToast) GK.showToast('Bild konnte nicht erstellt werden.', 'error');
      return;
    }

    const blob = await toBlob(canvas);
    if (!blob) {
      if (GK.showToast) GK.showToast('Bild konnte nicht erstellt werden.', 'error');
      return;
    }

    const fileName = 'bergkoenig-' + (o.peakName || 'tour').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
    const file = new File([blob], fileName, { type: 'image/png' });
    const shareText = (o.peakName ? o.peakName + ' erobert! ' : '') + '+' + (o.points || 0) + ' Punkte bei Bergkönig ⛰️👑';

    // 1) Web Share mit Bild-Datei (mobil, beste Variante)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Bergkönig',
          text: shareText + '\nhttps://bergkoenig.app',
        });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // Nutzer hat abgebrochen
        // sonst weiter zum Fallback
      }
    }

    // 2) Web Share nur Text/URL (kein Datei-Support)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Bergkönig', text: shareText, url: 'https://bergkoenig.app' });
        // Bild zusätzlich zum Download anbieten
        downloadBlob(blob, fileName);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }

    // 3) Fallback: Download (Desktop)
    downloadBlob(blob, fileName);
    if (GK.showToast) GK.showToast('Bild gespeichert — jetzt teilen! 📸', 'success');
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------------------------------------------------------------------------
  // Event-Delegation: jeder Button mit [data-share-summit] teilt seine Tour.
  // Daten kommen als JSON im Attribut (von summits.js gesetzt).
  // ---------------------------------------------------------------------------
  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-share-summit]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(btn.getAttribute('data-share-summit')));
    } catch (err) {
      console.warn('Share-Payload ungültig:', err);
      return;
    }
    shareCard(payload);
  });

  // Öffentliche API
  GK.share.shareCard = shareCard;
  GK.share.renderCard = renderCard;

  /** Hilfsfunktion für summits.js: Payload sicher in ein Attribut kodieren */
  GK.share.encodePayload = function (obj) {
    return encodeURIComponent(JSON.stringify(obj));
  };
})();
