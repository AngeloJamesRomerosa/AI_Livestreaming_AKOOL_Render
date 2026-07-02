/* ─── Background UI — presets ────────────────────────────────────── */

const BG_PRESETS = [
  { id: 'none',       label: 'None'       },
  { id: 'blur',       label: 'Blur'       },
  { id: 'black',      label: 'Black'      },
  { id: 'classroom',  label: 'Classroom'  },
  { id: 'gym',        label: 'Gym'        },
  { id: 'white_room', label: 'White Room' },
  { id: 'pink_wall',  label: 'Pink Wall'  },
  { id: 'beach',      label: 'Beach'      },
  { id: 'image',      label: '+ Image'    },
];

let _bgPreset  = 'none';
let _bgImageLoaded = false;
let _bgMode = 'output'; // tracks server-side mode for re-sync on session start
function isBgActive() { return _bgPreset !== 'none'; }

/* ── Preset & mode controls ─────────────────────────────────── */

function setBgPreset(id) {
  _bgPreset = id;
  document.querySelectorAll('.bg-opt').forEach(el =>
    el.classList.toggle('active', el.dataset.bg === id));

  const presetLabel = BG_PRESETS.find(p => p.id === id)?.label ?? id;
  fetch('/api/bg/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: id, sid: session?._id || '' }),
  })
    .then(r => r.json())
    .then(d => {
      if (d.ok) log(`Background preset "${presetLabel}" confirmed server-side`, 'success');
      else log(`Background preset "${presetLabel}" — server error: ${d.error ?? 'unknown'}`, 'warn');
    })
    .catch(() => log(`Background preset "${presetLabel}" — could not reach server`, 'warn'));

  _updateSegBtn();
  if (isBgActive()) {
    setModelStatus('background', 'ready', 'Active');
  } else {
    setModelStatus('background', 'loaded', 'Ready');
    log('Background: preset cleared', 'info');
  }
}

function handleBgImageClick() {
  if (_bgImageLoaded) setBgPreset('image');
  document.getElementById('bgImageInput').click();
}

function handleBgImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    _bgImageLoaded = true;
    const swatch = document.querySelector('.bg-opt[data-bg="image"]');
    if (swatch) {
      swatch.style.backgroundImage    = `url(${url})`;
      swatch.style.backgroundSize     = 'cover';
      swatch.style.backgroundPosition = 'center';
      swatch.style.color              = '#fff';
      swatch.style.textShadow         = '0 1px 3px rgba(0,0,0,0.8)';
      swatch.textContent              = '✓ Image';
    }
    log('Uploading background image to server…', 'info');
    const fd = new FormData();
    fd.append('file', file);
    fetch(`/api/bg/image?sid=${session?._id || ''}`, { method: 'POST', body: fd })
      .then(() => {
        setBgPreset('image');
        log('Custom background image loaded', 'success');
      })
      .catch(() => {
        log('Background image upload to server failed', 'warn');
      });
  };
  img.onerror = () => log('Failed to load background image', 'error');
  img.src = url;
}

function setBgOutputMode(mode) {
  document.querySelectorAll('.bg-mode-btn').forEach(el => {
    const isActive = el.dataset.mode === mode;
    el.classList.toggle('active', isActive);
    el.style.border     = isActive ? '1px solid var(--accent)' : '1px solid var(--border)';
    el.style.color      = isActive ? 'var(--accent)'           : 'var(--muted)';
    el.style.background = isActive ? '#1a2240'                 : 'var(--bg)';
  });
  const noteA = document.getElementById('bgModeNote');
  const noteB = document.getElementById('bgModeNoteB');
  if (noteA) noteA.style.display = mode === 'optionA' ? 'block' : 'none';
  if (noteB) noteB.style.display = mode === 'optionB' ? 'block' : 'none';

  const serverMode = mode === 'optionB' ? 'input' : 'output';
  _bgMode = serverMode;
  fetch('/api/bg/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: serverMode, sid: session?._id || '__preview__' }),
  }).catch(() => {});
}

/* ── Initialize background model status badge on page load ──── */

fetch('/api/bg/status')
  .then(r => r.json())
  .then(({ available }) => {
    if (available) {
      setModelStatus('background', 'loaded', 'Ready');
    } else {
      setModelStatus('background', 'error', 'Unavailable');
      log('Background removal: MediaPipe not installed on server', 'warn');
    }
  })
  .catch(() => setModelStatus('background', 'error', 'Unavailable'));

// Reset server-side bg state on page load so refresh always starts at "none"
fetch('/api/bg/preset', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ preset: 'none', sid: '__preview__' }),
}).catch(() => {});
