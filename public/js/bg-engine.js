/* ─── Background Segmentation Engine (MediaPipe SelfieSegmentation) ── */

// Segmentation state — MediaPipe SelfieSegmentation (WebAssembly, no TF.js required)
let _selfieSegmentation = null;
let _segPendingResolve  = null; // resolves when onResults fires
let _segReady       = false;
let _segInitPromise = null;
let _segProcessing  = false;
let _segFrameCount  = 0;

// Reusable canvases for mask processing
let _featherCanvas = null;
let _featherCtx    = null;
let _smoothCanvas  = null; // running EMA of the feathered mask across frames
let _smoothCtx     = null;
let _tempCanvas    = null; // scratch canvas for EMA blend computation
let _tempCtx       = null;

// Edge feather radius — softens the boundary for natural blending.
const EDGE_FEATHER_PX = 2;
// Contrast boost — pushes semi-transparent interior pixels toward fully solid.
const EDGE_CONTRAST   = 4;
// Temporal blend factor — how much of the NEW mask to mix in each frame.
// Lower = smoother/less jitter, but edges lag slightly when you move fast.
// 0.4 is a good balance: stable edges when still, responsive when moving.
const TEMPORAL_ALPHA  = 0.4;

let _personCanvas = null;
let _personCtx    = null;

function _ensurePersonCanvas(w, h) {
  if (!_personCanvas || _personCanvas.width !== w || _personCanvas.height !== h) {
    _personCanvas        = document.createElement('canvas');
    _personCanvas.width  = w;
    _personCanvas.height = h;
    _personCtx           = _personCanvas.getContext('2d');
  }
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s    = document.createElement('script');
    s.src      = src;
    s.crossOrigin = 'anonymous';
    s.onload   = resolve;
    s.onerror  = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

function _initSegmentation() {
  if (_segInitPromise) return _segInitPromise;
  _segInitPromise = (async () => {
    log('Loading background segmentation library…', 'info');
    setModelStatus('background', 'loading', 'Loading…');

    const MP_VER = '0.1.1675465747';
    await _loadScript(
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${MP_VER}/selfie_segmentation.min.js`
    );

    _selfieSegmentation = new SelfieSegmentation({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${MP_VER}/${file}`,
    });
    _selfieSegmentation.setOptions({ modelSelection: 1, selfieMode: false });

    // Persistent callback — resolves the pending promise from _compositeFrame
    _selfieSegmentation.onResults(result => {
      if (_segPendingResolve) {
        const cb = _segPendingResolve;
        _segPendingResolve = null;
        cb(result.segmentationMask);
      }
    });

    // Warm-up: triggers WASM download + model init, waits for first onResults
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Background model init timed out')), 30000);
      _segPendingResolve = () => { clearTimeout(t); resolve(); };
      const blank = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
      _selfieSegmentation.send({ image: blank }).catch(err => {
        clearTimeout(t);
        _segPendingResolve = null;
        reject(err);
      });
    });

    _segReady = true;
    setModelStatus('background', 'loaded', 'Ready');
    log('Background removal ready', 'success');
  })();
  _segInitPromise.catch(() => { _segInitPromise = null; }); // allow retry on failure
  return _segInitPromise;
}

// Core compositing: segments the person and draws [background] + [person] onto outputCanvas.
async function _compositeFrame(outputCanvas, outputCtx, w, h, videoEl) {
  if (!videoEl) return;
  // <video> elements have readyState; <img> elements are ready when .complete is true
  const ready = videoEl.readyState !== undefined ? videoEl.readyState >= 2 : videoEl.complete;
  if (!ready) return;
  if (!_segReady || !_selfieSegmentation) {
    outputCtx.drawImage(videoEl, 0, 0, w, h);
    return;
  }

  // Ask MediaPipe to segment; result arrives via onResults callback
  const maskCanvas = await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      _segPendingResolve = null;
      reject(new Error('segmentation timeout'));
    }, 3000);
    _segPendingResolve = mask => { clearTimeout(t); resolve(mask); };
    _selfieSegmentation.send({ image: videoEl }).catch(err => {
      clearTimeout(t);
      _segPendingResolve = null;
      reject(err);
    });
  });

  // 1. Feather: contrast hardens semi-transparent interior, blur softens only the boundary.
  if (!_featherCanvas || _featherCanvas.width !== w || _featherCanvas.height !== h) {
    _featherCanvas        = document.createElement('canvas');
    _featherCanvas.width  = w;
    _featherCanvas.height = h;
    _featherCtx           = _featherCanvas.getContext('2d');
  }
  _featherCtx.clearRect(0, 0, w, h);
  _featherCtx.filter = `contrast(${EDGE_CONTRAST}) blur(${EDGE_FEATHER_PX}px)`;
  _featherCtx.drawImage(maskCanvas, 0, 0, w, h);
  _featherCtx.filter = 'none';

  // 2. Temporal smoothing — EMA of feathered mask: new = (1-α)*old + α*new
  //    Uses 'lighter' (additive) blend for exact linear interpolation without
  //    alpha-premultiplication distortion.
  if (!_smoothCanvas || _smoothCanvas.width !== w || _smoothCanvas.height !== h) {
    _smoothCanvas        = document.createElement('canvas');
    _smoothCanvas.width  = w;
    _smoothCanvas.height = h;
    _smoothCtx           = _smoothCanvas.getContext('2d');
    _smoothCtx.drawImage(_featherCanvas, 0, 0); // seed first frame
  }
  if (!_tempCanvas || _tempCanvas.width !== w || _tempCanvas.height !== h) {
    _tempCanvas        = document.createElement('canvas');
    _tempCanvas.width  = w;
    _tempCanvas.height = h;
    _tempCtx           = _tempCanvas.getContext('2d');
  }

  _tempCtx.clearRect(0, 0, w, h);
  _tempCtx.globalAlpha = 1 - TEMPORAL_ALPHA;
  _tempCtx.drawImage(_smoothCanvas, 0, 0);
  _tempCtx.globalAlpha = 1;
  _tempCtx.globalCompositeOperation = 'lighter';
  _tempCtx.globalAlpha = TEMPORAL_ALPHA;
  _tempCtx.drawImage(_featherCanvas, 0, 0);
  _tempCtx.globalAlpha = 1;
  _tempCtx.globalCompositeOperation = 'source-over';

  _smoothCtx.clearRect(0, 0, w, h);
  _smoothCtx.drawImage(_tempCanvas, 0, 0);

  // 3. Stamp smoothed mask, cut person out, draw background underneath
  outputCtx.clearRect(0, 0, w, h);
  outputCtx.drawImage(_smoothCanvas, 0, 0, w, h);
  outputCtx.globalCompositeOperation = 'source-in';
  outputCtx.drawImage(videoEl, 0, 0, w, h);
  outputCtx.globalCompositeOperation = 'destination-over';
  _drawBackground(outputCtx, w, h, videoEl); // defined in bg-ui.js
  outputCtx.globalCompositeOperation = 'source-over';

  if (++_segFrameCount % 60 === 0) {
    log(`BG segmentation: ${_segFrameCount} frames processed`, 'info');
  }
}

/* ── Public ─────────────────────────────────────────────────── */

function isBgActive()  { return _bgPreset !== 'none'; }
function isBgOptionA() { return isBgActive() && _bgMode === 'optionA'; }
function isBgOptionB() { return isBgActive() && _bgMode === 'optionB'; }

function bgReset() {
  _segFrameCount = 0;
  _segProcessing = false;
  // Clear temporal smoother so stale mask from previous session doesn't bleed in
  if (_smoothCtx) { _smoothCtx.clearRect(0, 0, _smoothCanvas.width, _smoothCanvas.height); }
}
