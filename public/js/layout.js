/* ─── Layout detection and switching (mobile ↔ desktop) ──────── */

const _LAYOUT_KEY = 'preferred_layout';

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad Pro
}

function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

function _autoDetectMobile() {
  const touch  = navigator.maxTouchPoints > 0;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 768;
  return [touch, coarse, narrow].filter(Boolean).length >= 2;
}

function isMobileLayout() {
  return document.body.classList.contains('layout-mobile');
}

function setLayout(mode) {
  document.body.classList.toggle('layout-mobile',  mode === 'mobile');
  document.body.classList.toggle('layout-desktop', mode === 'desktop');
  localStorage.setItem(_LAYOUT_KEY, mode);

  // Hide auto indicator once user makes a manual choice
  const auto = document.getElementById('layoutAutoIndicator');
  if (auto) auto.style.display = 'none';

  _syncSwitch(mode);

  if (mode === 'mobile') {
    if (typeof switchVcamMethod === 'function') switchVcamMethod('golive');
  }
}

function _syncSwitch(mode) {
  document.getElementById('layoutMobileBtn') ?.classList.toggle('active', mode === 'mobile');
  document.getElementById('layoutDesktopBtn')?.classList.toggle('active', mode === 'desktop');
}

// Runs immediately — sets body class before first paint to prevent layout flash
(function _initLayout() {
  const isMobileDevice = _autoDetectMobile();
  if (isMobileDevice) document.body.setAttribute('data-mobile-device', '');

  const saved  = localStorage.getItem(_LAYOUT_KEY);
  const isAuto = !saved;
  const mode   = saved || (isMobileDevice ? 'mobile' : 'desktop');

  document.body.classList.add(mode === 'mobile' ? 'layout-mobile' : 'layout-desktop');
  _syncSwitch(mode);

  if (isAuto) {
    document.addEventListener('DOMContentLoaded', () => {
      const auto = document.getElementById('layoutAutoIndicator');
      if (auto) auto.style.display = '';
    });
  }
})();
