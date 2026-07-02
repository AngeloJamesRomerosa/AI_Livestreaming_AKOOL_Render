/* ─── Background UI — toggles (segmenter only — server-side toggles not available) ── */

let _bgToggleStates = { pose: false, hand: true, face: false, outline: false };

function _updateSegBtn() {
  const btn = document.getElementById('bgToggleSeg');
  if (!btn) return;
  if (isBgActive()) {
    btn.textContent      = 'Segmenter: ON';
    btn.style.border     = '1px solid var(--accent)';
    btn.style.color      = 'var(--accent)';
    btn.style.background = '#1a2240';
    btn.style.cursor     = 'default';
    btn.style.opacity    = '0.85';
    btn.title            = 'Segmenter is always active when a background is selected';
  } else {
    btn.textContent      = 'Segmenter: OFF';
    btn.style.border     = '1px solid var(--border)';
    btn.style.color      = 'var(--muted)';
    btn.style.background = 'var(--bg)';
    btn.style.cursor     = 'default';
    btn.style.opacity    = '0.6';
    btn.title            = 'Select a background to activate segmenter';
  }
}

function bgToggleSeg() { /* Segmenter is locked — no-op */ }

/* Server-side pose/hand/face/outline/GPU toggles are not available in this deployment */
function bgToggle(feature) {
  log(`BG ${feature} toggle: not available (server-side pipeline not running)`, 'warn');
}

function bgToggleGpu() {
  log('GPU toggle: not available in this deployment', 'warn');
}

function syncBgToggles(_sid) { /* no-op — no server-side BG state */ }

/* ── Init GPU button as N/A on page load ─────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('bgToggleGpu');
  if (btn) {
    btn.textContent            = 'GPU: N/A';
    btn.style.color            = 'var(--muted)';
    btn.style.opacity          = '0.45';
    btn.style.cursor           = 'default';
    btn.dataset.unavailable    = 'true';
    btn.title                  = 'GPU processing not available in this deployment';
  }
});
