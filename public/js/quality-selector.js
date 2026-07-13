/* ─── Stream quality selector ────────────────────────────────── */

let _streamProfiles  = {};
let _selectedRes     = 'auto';
let _selectedFps     = 30;
let _selectedBTier   = 'auto'; // 'auto' | 'low' | 'standard' | 'high'


function _formatKbps(kbps) {
  if (kbps === 0) return 'Auto';
  return kbps >= 1000 ? `${+(kbps / 1000).toFixed(1)} Mbps` : `${kbps} Kbps`;
}

function _currentBitrate() {
  const fps_data = _streamProfiles[_selectedRes]?.fps_options?.[_selectedFps];
  return fps_data?.[_selectedBTier] ?? 0;
}

function _rebuildFpsButtons() {
  const container = document.getElementById('fpsSelector');
  if (!container) return;
  const profile = _streamProfiles[_selectedRes];
  if (!profile) return;

  const fpsList = Object.keys(profile.fps_options).map(Number).sort((a, b) => a - b);

  if (!fpsList.includes(_selectedFps)) _selectedFps = fpsList[fpsList.length - 1];

  container.innerHTML = fpsList.map(fps =>
    `<button class="qc-btn${fps === _selectedFps ? ' active' : ''}" data-fps="${fps}">${fps} fps</button>`
  ).join('');
}

function _rebuildBitrateButtons() {
  const container = document.getElementById('bitrateSelector');
  if (!container) return;
  const fps_data = _streamProfiles[_selectedRes]?.fps_options?.[_selectedFps];
  if (!fps_data) return;

  const tiers = [
    { key: 'auto',     label: 'Auto'     },
    { key: 'low',      label: 'Low'      },
    { key: 'standard', label: 'Standard' },
    { key: 'high',     label: 'High'     },
  ];

  container.innerHTML = tiers.map(({ key, label }) =>
    `<button class="qc-btn${key === _selectedBTier ? ' active' : ''}" data-tier="${key}">
      <span class="qc-btn-label">${label}</span>
      <span class="qc-btn-val">${_formatKbps(fps_data[key])}</span>
    </button>`
  ).join('');
}

function initQualitySelector() {
  fetch('/api/stream-profiles')
    .then(r => r.json())
    .then(data => {
      _streamProfiles = data;
      _rebuildFpsButtons();
      _rebuildBitrateButtons();
    })
    .catch(() => {});

  document.getElementById('qualitySelector').addEventListener('click', e => {
    const item = e.target.closest('.yt-quality-item');
    if (!item) return;
    document.querySelectorAll('#qualitySelector .yt-quality-item').forEach(i => {
      i.classList.remove('active');
      i.querySelector('.yt-check').textContent = '';
    });
    item.classList.add('active');
    item.querySelector('.yt-check').textContent = '✓';
    _selectedRes = item.dataset.preset;
    _rebuildFpsButtons();
    _rebuildBitrateButtons();
  });

  document.getElementById('fpsSelector').addEventListener('click', e => {
    const btn = e.target.closest('.qc-btn');
    if (!btn) return;
    document.querySelectorAll('#fpsSelector .qc-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _selectedFps = parseInt(btn.dataset.fps);
    _rebuildBitrateButtons();
  });

  document.getElementById('bitrateSelector').addEventListener('click', e => {
    const btn = e.target.closest('.qc-btn');
    if (!btn) return;
    document.querySelectorAll('#bitrateSelector .qc-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _selectedBTier = btn.dataset.tier;
  });
}

function getPreset() {
  const p    = _streamProfiles[_selectedRes] ?? { width: 640, height: 360, faceswap_quality: 2 };
  const bmax = _currentBitrate();
  return {
    faceswapQuality:  p.faceswap_quality,
    camera: { width: p.width, height: p.height, frameRate: _selectedFps, bitrateMin: bmax === 0 ? 0 : Math.round(bmax * 0.5), bitrateMax: bmax },
    optimizationMode: p.faceswap_quality === 3 ? 'detail' : 'motion',
  };
}

function getQualityDescription() {
  const p        = _streamProfiles[_selectedRes] ?? { label: 'Auto', width: 640, height: 360 };
  const label    = p.label ?? _selectedRes;
  const bps      = _currentBitrate();
  const tierLabel = { auto: 'Auto', low: 'Low', standard: 'Standard', high: 'High' }[_selectedBTier] ?? _selectedBTier;
  const bpsStr   = bps === 0 ? 'Auto' : _formatKbps(bps);
  return `${label} ${p.width}×${p.height} · ${_selectedFps} fps · ${tierLabel} bitrate (${bpsStr})`;
}

// Alias used in camera-relay.js log line
const _selectedPreset = { toString() { return `${_selectedRes} ${_selectedFps}fps`; } };
