/* ─── Background UI — presets, Option A/B ───────────────────────── */

const BG_PRESETS = [
  { id: 'none',       label: 'None'                                              },
  { id: 'blur',       label: 'Blur',       type: 'blur'                         },
  { id: 'black',      label: 'Black',      type: 'color',  value: '#000000'     },
  { id: 'classroom',  label: 'Classroom',  type: 'preset', src: '/img/bg/classroom.jpeg' },
  { id: 'gym',        label: 'Gym',        type: 'preset', src: '/img/bg/gym.png'        },
  { id: 'white_room', label: 'White Room', type: 'preset', src: '/img/bg/white_room.png' },
  { id: 'pink_wall',  label: 'Pink Wall',  type: 'preset', src: '/img/bg/pink_wall.jpg'  },
  { id: 'beach',      label: 'Beach',      type: 'preset', src: '/img/bg/beach.jpg'      },
  { id: 'image',      label: '+ Image',    type: 'image'                        },
];

// Cache for preset images so they load once and are ready on the next frame
const _presetImageCache = {};

let _bgPreset  = 'none';
let _bgMode    = 'optionB';
let _bgImageEl = null;

// Option A state
let _optionAVideoEl = null;
let _optionACanvas  = null;
let _optionACtx     = null;
let _optionAStream  = null;
let _optionARaf     = null;
let _bgCustomTrack  = null;

/* ── Background drawing ─────────────────────────────────────── */

function _drawBgImage(ctx, img, w, h) {
  if (img.complete && img.naturalWidth) {
    const ia = img.naturalWidth / img.naturalHeight;
    const ca = w / h;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (ia > ca) { sw = sh * ca; sx = (img.naturalWidth  - sw) / 2; }
    else         { sh = sw / ca; sy = (img.naturalHeight - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.fillStyle = '#2a1215';
    ctx.fillRect(0, 0, w, h);
  }
}

function _drawBackground(ctx, w, h, videoEl) {
  const p = BG_PRESETS.find(x => x.id === _bgPreset);
  if (!p || !p.type) return;

  if (p.type === 'blur') {
    const PAD = 40;
    ctx.filter = 'blur(20px)';
    ctx.drawImage(videoEl, -PAD, -PAD, w + PAD * 2, h + PAD * 2);
    ctx.filter = 'none';
  } else if (p.type === 'color') {
    ctx.fillStyle = p.value;
    ctx.fillRect(0, 0, w, h);
  } else if (p.type === 'preset') {
    if (!_presetImageCache[p.id]) {
      const img = new Image();
      img.src = p.src;
      _presetImageCache[p.id] = img;
    }
    _drawBgImage(ctx, _presetImageCache[p.id], w, h);
  } else if (p.type === 'image') {
    if (_bgImageEl) _drawBgImage(ctx, _bgImageEl, w, h);
    else { ctx.fillStyle = '#2a1215'; ctx.fillRect(0, 0, w, h); }
  }
}

/* ── Preset & mode controls ─────────────────────────────────── */

function setBgPreset(id) {
  _bgPreset = id;
  document.querySelectorAll('.bg-opt').forEach(el =>
    el.classList.toggle('active', el.dataset.bg === id));

  if (isBgActive()) {
    if (!_segReady) {
      log('Loading background removal model…', 'info');
      _initSegmentation().catch(e => {
        setModelStatus('background', 'error', 'Failed');
        log(`Background model failed: ${e.message}`, 'error');
      });
    } else {
      setModelStatus('background', 'ready', 'Active');
      if (_bgMode === 'optionB') {
        log('Background preset active — see "Background Output Preview" panel during session.', 'info');
      } else {
        log('Background preset active — start or restart session to apply to camera input.', 'info');
      }
    }
  } else {
    if (_segReady) setModelStatus('background', 'loaded', 'Ready');
  }
}

function handleBgImageClick() {
  if (_bgImageEl) setBgPreset('image');
  document.getElementById('bgImageInput').click();
}

function handleBgImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    _bgImageEl = img;
    const swatch = document.querySelector('.bg-opt[data-bg="image"]');
    if (swatch) {
      swatch.style.backgroundImage    = `url(${url})`;
      swatch.style.backgroundSize     = 'cover';
      swatch.style.backgroundPosition = 'center';
      swatch.style.color              = '#fff';
      swatch.style.textShadow         = '0 1px 3px rgba(0,0,0,0.8)';
      swatch.textContent              = '✓ Image';
    }
    setBgPreset('image');
    log('Custom background image loaded', 'success');
  };
  img.onerror = () => log('Failed to load background image', 'error');
  img.src = url;
}

function setBgMode(mode) {
  _bgMode = mode;
  document.querySelectorAll('.bg-mode-btn').forEach(el => {
    const isActive = el.dataset.mode === mode;
    el.classList.toggle('active', isActive);
    el.style.border     = isActive ? '1px solid var(--accent)' : '1px solid var(--border)';
    el.style.color      = isActive ? 'var(--accent)'           : 'var(--muted)';
    el.style.background = isActive ? 'var(--accent-bg)'                 : 'var(--bg)';
  });
  const noteA = document.getElementById('bgModeNote');
  const noteB = document.getElementById('bgModeNoteB');
  if (noteA) noteA.style.display = mode === 'optionA' ? 'block' : 'none';
  if (noteB) noteB.style.display = mode === 'optionB' ? 'block' : 'none';
}

/* ── Option B: called from obs.js _sendObsFrame ─────────────── */

async function bgApplyToObsFrame(videoEl, canvas, ctx) {
  const w = canvas.width, h = canvas.height;

  if (!isBgOptionB() || !_segReady) {
    ctx.drawImage(videoEl, 0, 0, w, h);
  } else if (!_segProcessing) {
    _segProcessing = true;
    try {
      await _compositeFrame(canvas, ctx, w, h, videoEl);
    } catch (e) {
      log(`BG composite error: ${e.message}`, 'warn');
      ctx.drawImage(videoEl, 0, 0, w, h);
    } finally {
      _segProcessing = false;
    }
  }

  const preview = document.getElementById('bgPreviewCanvas');
  if (preview && preview.parentElement.style.display !== 'none') {
    if (preview.width !== w || preview.height !== h) {
      preview.width = w; preview.height = h;
    }
    preview.getContext('2d').drawImage(canvas, 0, 0);
  }
}

/* ── Option A: called from session.js after camera track creation ── */

async function bgStartOptionA(agoraVideoTrack) {
  if (!isBgOptionA()) return null;

  await _initSegmentation();

  const rawTrack = agoraVideoTrack.getMediaStreamTrack();
  _optionAVideoEl = document.createElement('video');
  _optionAVideoEl.srcObject = new MediaStream([rawTrack]);
  _optionAVideoEl.muted = true;
  await _optionAVideoEl.play();

  const { width = 640, height = 480 } = rawTrack.getSettings();
  _optionACanvas        = document.createElement('canvas');
  _optionACanvas.width  = width;
  _optionACanvas.height = height;
  _optionACtx           = _optionACanvas.getContext('2d');

  const loop = async () => {
    if (!_optionACanvas) return;
    const w = _optionACanvas.width, h = _optionACanvas.height;
    if (_segReady && !_segProcessing) {
      _segProcessing = true;
      try {
        await _compositeFrame(_optionACanvas, _optionACtx, w, h, _optionAVideoEl);
      } catch (e) {
        log(`BG Option A error: ${e.message}`, 'warn');
        _optionACtx.drawImage(_optionAVideoEl, 0, 0, w, h);
      } finally {
        _segProcessing = false;
      }
    } else if (!_segReady) {
      _optionACtx.drawImage(_optionAVideoEl, 0, 0, w, h);
    }
    _optionARaf = requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  _optionAStream = _optionACanvas.captureStream(30);
  _bgCustomTrack = AgoraRTC.createCustomVideoTrack({
    mediaStreamTrack: _optionAStream.getVideoTracks()[0],
  });
  return _bgCustomTrack;
}

function bgStopOptionA() {
  if (_optionARaf) cancelAnimationFrame(_optionARaf);
  _optionARaf    = null;
  _segProcessing = false;

  if (_optionACanvas && _optionACanvas.parentElement) {
    const panel = _optionACanvas.parentElement;
    _optionACanvas.remove();
    const rawVid = panel.querySelector('video');
    if (rawVid) rawVid.style.opacity = '';
  }

  _optionACanvas  = null;
  _optionACtx     = null;
  _optionAStream  = null;
  _optionAVideoEl = null;
  if (_bgCustomTrack) {
    _bgCustomTrack.stop();
    _bgCustomTrack.close();
    _bgCustomTrack = null;
  }
}

// Prefetch model 3 s after page load so it's ready before the user starts a session
setTimeout(() => _initSegmentation().catch(() => {}), 3000);
