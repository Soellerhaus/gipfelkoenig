/* Bergkönig — Spiel-Animationen */

// Confetti Animation
function showConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);
  const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ff9ff3'];
  for (let i = 0; i < 40; i++) {
    const particle = document.createElement('div');
    particle.className = 'confetti-particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    particle.style.animationDelay = Math.random() * 0.5 + 's';
    particle.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
    container.appendChild(particle);
  }
  setTimeout(() => container.remove(), 3500);
}

// Points Flying Up Animation
function showPointsAnimation(points, element) {
  const el = document.createElement('div');
  el.className = 'points-fly';
  el.textContent = '+' + points + ' Pkt';
  // Position near the element or center of screen
  if (element) {
    const rect = element.getBoundingClientRect();
    el.style.left = rect.left + rect.width / 2 + 'px';
    el.style.top = rect.top + 'px';
  } else {
    el.style.left = '50%';
    el.style.top = '50%';
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// Crown/König Animation
function showCrownAnimation(peakName) {
  const overlay = document.createElement('div');
  overlay.className = 'crown-overlay';
  overlay.innerHTML = '<div class="crown-content">' +
    '<div class="crown-emoji">👑</div>' +
    '<div class="crown-title">BERGKÖNIG!</div>' +
    '<div class="crown-peak">' + peakName + '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('active'), 50);
  setTimeout(() => { overlay.classList.remove('active'); setTimeout(() => overlay.remove(), 500); }, 2500);
}

// Gold Flash
function showGoldFlash() {
  const flash = document.createElement('div');
  flash.className = 'gold-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 800);
}

// Global verfügbar machen
window.showConfetti = showConfetti;
window.showPointsAnimation = showPointsAnimation;
window.showCrownAnimation = showCrownAnimation;
window.showGoldFlash = showGoldFlash;
