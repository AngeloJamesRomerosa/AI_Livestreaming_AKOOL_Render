/* ─── OBS helpers (Method A) ─────────────────────────────────── */

const OBS_FPS   = 30;
let _obsWs      = null;
let _obsCanvas  = null;
let _obsCtx     = null;
let _vcamWs     = null; // virtual camera not used in this deployment

function stopVirtualCamera() {
  if (_vcamWs) { _vcamWs.close(); _vcamWs = null; }
}

// Expose face-swapped stream so the popup viewer can grab it directly
// without joining Agora — avoids token/UID conflicts entirely
window._getViewerStream = function() {
  const video = document.querySelector('#remote-video video');
  if (!video) return null;
  return video.captureStream?.() ?? video.mozCaptureStream?.() ?? null;
};

function showObsPanel() {
  if (!session?.app_id) return;

  // stream_path includes the secret key generated server-side e.g. /stream.mjpeg?key=abc123
  const viewerUrl = `${window.location.protocol}//${window.location.host}${session.stream_path}`;
  document.getElementById('obsViewerUrl').value = viewerUrl;

  _startObsStream();
  document.getElementById('bgPreviewPanel').style.display = 'block';
  log('OBS viewer URL ready — see OBS Output panel', 'success');
}

/* ─── OBS frame relay ────────────────────────────────────────── */

// Guard against concurrent frame sends — the Worker timer fires even when
// Chrome is backgrounded, so _obsSending prevents pile-up on the same canvas.
let _obsSending     = false;
let _obsSendingAt   = 0;
let _obsWorker      = null;
const _OBS_WATCHDOG = 500; // ms — reset _obsSending if GPU spike stalls toBlob

// Web Worker timer — fires at OBS_FPS even when Chrome tab is in the background.
// setInterval on the main thread throttles to ~1fps when another window is fullscreen;
// Workers are exempt from that throttling, keeping the relay at full frame rate.
function _createObsWorker() {
  const ms  = Math.round(1000 / OBS_FPS);
  const src = `setInterval(() => self.postMessage('tick'), ${ms});`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w   = new Worker(url);
  URL.revokeObjectURL(url);
  w.onmessage = () => _sendObsFrame();
  return w;
}

function _stopObsWorker() {
  if (_obsWorker) { _obsWorker.terminate(); _obsWorker = null; }
}

function _startObsStream() {
  if (_obsWs) return;

  // Only one output method active at a time
  if (_vcamWs) {
    stopVirtualCamera();
    log('Built-in Camera stopped — switching to OBS relay', 'info');
  }

  // showObsPanel() is called before the AI video element lands in the DOM.
  // Retry until the element exists and has at least one decoded frame.
  const video = document.querySelector('#remote-video video');
  if (!video || video.readyState < 2) {
    setTimeout(_startObsStream, 300);
    return;
  }

  const width  = video.videoWidth  || 640;
  const height = video.videoHeight || 480;

  _obsCanvas        = document.createElement('canvas');
  _obsCanvas.width  = width;
  _obsCanvas.height = height;
  _obsCtx = _obsCanvas.getContext('2d');

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const sid   = session?._id || '';
  _obsWs = new WebSocket(`${proto}://${window.location.host}/ws/stream-out?sid=${sid}`);
  _obsWs.binaryType = 'arraybuffer';

  _obsWs.onopen = () => {
    log('OBS relay stream started', 'success');
    _obsSending = false;
    _obsWorker  = _createObsWorker();
    _startKeepAlive();
  };

  _obsWs.onclose = () => {
    _stopObsWorker();
    _obsWs      = null;
    _obsSending = false;
    if (session) {
      log('OBS relay disconnected — reconnecting…', 'warn');
      setTimeout(_startObsStream, 2000);
    }
  };

  _obsWs.onerror = () => {
    log('OBS relay WebSocket error', 'error');
    // onclose always fires after onerror — let it handle cleanup and reconnect
  };
}

async function _sendObsFrame() {
  // Watchdog: if a previous toBlob was stalled by a GPU spike (e.g. FP16
  // inference), release the lock so the relay doesn't freeze permanently.
  if (_obsSending && (Date.now() - _obsSendingAt) > _OBS_WATCHDOG) {
    _obsSending = false;
  }
  if (_obsSending) return;
  if (!_obsWs || _obsWs.readyState !== WebSocket.OPEN) return;

  const video = document.querySelector('#remote-video video');
  if (!video || video.readyState < 2) return;

  _obsSending   = true;
  _obsSendingAt = Date.now();
  try {
    await bgApplyToObsFrame(video, _obsCanvas, _obsCtx);
    await new Promise(resolve => {
      _obsCanvas.toBlob(blob => {
        if (blob && _obsWs?.readyState === WebSocket.OPEN) {
          // Fix 1: skip frame if send buffer exceeds 240KB — prevents
          // progressive slowdown from buffer buildup over long sessions
          if (_obsWs.bufferedAmount < 240000) {
            _obsWs.send(blob);
          }
        }
        resolve();
      }, 'image/jpeg', 0.85);
    });
  } catch (e) {
    log(`OBS frame error: ${e.message}`, 'warn');
  } finally {
    _obsSending = false;
  }
}

function stopObsStream() {
  _stopObsWorker();
  _stopKeepAlive();
  if (_obsWs) {
    _obsWs.onclose = null;
    _obsWs.close();
    _obsWs = null;
  }
  document.getElementById('bgPreviewPanel').style.display = 'none';
}

/* ─── Silent AudioContext keep-alive ─────────────────────────── */
// Chrome suspends video rendering and throttles tabs in the background.
// An active AudioContext prevents that — Chrome keeps the tab fully alive
// when it detects audio activity, even if the audio is completely silent.
let _keepAliveCtx = null;

function _startKeepAlive() {
  if (_keepAliveCtx) return;
  try {
    _keepAliveCtx       = new AudioContext();
    const osc           = _keepAliveCtx.createOscillator();
    const gain          = _keepAliveCtx.createGain();
    gain.gain.value     = 0; // completely silent — no audible output
    osc.connect(gain);
    gain.connect(_keepAliveCtx.destination);
    osc.start();
    log('Background keep-alive active — Chrome will not suspend video', 'info');
  } catch (e) {
    log('Keep-alive AudioContext failed — stream may throttle in background', 'warn');
  }
}

function _stopKeepAlive() {
  if (_keepAliveCtx) {
    _keepAliveCtx.close();
    _keepAliveCtx = null;
  }
}

function copyObsUrl() {
  const url = document.getElementById('obsViewerUrl').value;
  navigator.clipboard.writeText(url).then(() => {
    log('Viewer URL copied to clipboard', 'success');
  });
}

function popOutViewer() {
  const key = session?.stream_path
    ? new URLSearchParams(session.stream_path.split('?')[1] || '').get('key') || ''
    : '';
  const query = key ? '?key=' + key : '';
  const url = `${window.location.protocol}//${window.location.host}/viewer.html${query}`;
  window.open(url, 'akool-obs-output', 'popup,width=1280,height=720');
}

/* ─── Relay log poller ───────────────────────────────────────── */
// Polls /api/relay-log every 3s and surfaces viewer-relay.html Fix 3/4/5
// events into the main app activity log so the streamer can see them.
function _startRelayLogPoller() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/relay-log');
      if (!res.ok) return;
      const messages = await res.json();
      messages.forEach(({ msg, level }) => log(msg, level || 'warn'));
    } catch {}
  }, 3000);
}

/* ─── Cleanup on tab/browser close ──────────────────────────── */
window.addEventListener('beforeunload', () => {
  if (session?._id) {
    fetch('/api/session/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: session._id }),
      keepalive: true,
    });
  }
});

/* ─── Streaming Connections tab switcher ─────────────────────── */
function switchVcamMethod(method) {
  const methodId = 'method-' + method;

  // Update tab active state
  document.querySelectorAll('#vcamMethodTabs .tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === methodId);
  });

  // Show the selected method pane, hide others
  document.querySelectorAll('.vcam-method').forEach(pane => {
    pane.style.display = pane.id === methodId ? '' : 'none';
  });

  // Ensure the accordion is open
  const body = document.getElementById('obsPanelBody');
  if (body) body.style.display = 'block';
}

/* ─── Init ───────────────────────────────────────────────────── */
log('AKOOL Livestream Faceswap loaded. Follow steps 1 → 2 → 3.', 'info');
checkAuthStatus();
initQualitySelector();
_startRelayLogPoller();
