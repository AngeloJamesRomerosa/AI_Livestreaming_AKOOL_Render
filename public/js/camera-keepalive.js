/* ─── iOS background keepalive — wake lock + silent audio ───────────────────── */

let _wakeLock       = null;
let _keepAliveAudio = null;

async function _requestWakeLock() {
  if (!('wakeLock' in navigator) || _wakeLock) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (e) {}
}

function _releaseWakeLock() {
  if (_wakeLock) { try { _wakeLock.release(); } catch (_) {} _wakeLock = null; }
}

// Must be called synchronously inside a user-gesture handler (button click) so iOS
// allows the AudioContext to start. iOS keeps pages with an active AudioContext alive
// longer when backgrounded, reducing main-thread throttling during streaming.
function _startAudioKeepalive() {
  if (_keepAliveAudio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); // 1 s silent buffer
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;
    src.connect(ctx.destination);
    src.start();
    ctx.resume().catch(() => {});
    _keepAliveAudio = { ctx, src };
  } catch (e) {}
}

function _stopAudioKeepalive() {
  if (!_keepAliveAudio) return;
  try { _keepAliveAudio.src.stop(); _keepAliveAudio.ctx.close(); } catch (e) {}
  _keepAliveAudio = null;
}

// When the app returns to foreground: re-request wake lock (iOS releases it on hide)
// and reconnect camera if it dropped while backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !session) return;
  _requestWakeLock();
  if (!_cameraWorker) {
    log('Resuming from background — reconnecting camera…', 'info');
    connectCamera();
  }
});
