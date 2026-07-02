/**
 * rtmp.js
 * -------
 * Browser-side Go Live (RTMP) module.
 *
 * When a faceswap session is active, video comes from the OBS relay (AI output).
 * When no session is active (test mode), a local camera fallback is used instead
 * so the stream can be tested without spending AKOOL credits.
 */

/* ── State ─────────────────────────────────────────────────────────────────── */

let _rtmpActive    = false;
let _startAborted  = false;
let _statusPoller  = null;
let _lastLoggedErr = '';

/* ── Public API ────────────────────────────────────────────────────────────── */

async function startRtmp() {
  _startAborted = false;
  const url = document.getElementById('rtmpUrl')?.value?.trim();
  const key = document.getElementById('rtmpKey')?.value?.trim();

  if (!url || !key) {
    setRtmpStatus('error', 'Enter RTMP URL and stream key.');
    return;
  }

  log('Go Live: requesting microphone access…', 'info');
  setRtmpState('connecting');

  try {
    await _startAudio();
    log('Go Live: microphone ready — connecting to RTMP server…', 'info');
  } catch (err) {
    log(`Go Live: mic error — ${err.message}`, 'error');
    setRtmpStatus('error', `Mic error: ${err.message}`);
    setRtmpState('idle');
    return;
  }

  // If no faceswap session is active, start the local camera fallback so
  // frames still flow to ffmpeg — useful for testing without AKOOL credits.
  const hasSession = typeof session !== 'undefined' && session && session._id;
  if (!hasSession) {
    log('Go Live: no active session — using local camera (test mode)', 'info');
    try {
      await _startCameraFallback();
    } catch (err) {
      log(`Go Live: camera fallback failed — ${err.message}`, 'warn');
      // Non-fatal: stream may still work if OBS relay starts later
    }
  } else {
    log('Go Live: using faceswap output — server-side relay active', 'info');
  }

  try {
    const sid = session?._id || '';
    const res = await fetch(`/api/rtmp/start?sid=${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rtmp_url: url, stream_key: key }),
    });
    if (_startAborted) return;
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Server error');
  } catch (err) {
    if (_startAborted) return;
    log(`Go Live: failed to connect — ${err.message}`, 'error');
    _stopCameraFallback();
    stopRtmpAudio();
    setRtmpStatus('error', err.message);
    setRtmpState('idle');
    return;
  }

  if (_startAborted) return;
  _rtmpActive    = true;
  _lastLoggedErr = '';
  setRtmpState('live');
  log(`Go Live: streaming live to ${url}${hasSession ? '' : ' (camera test mode)'}`, 'success');
  _startStatusPoller();
  _startWakeLock();
}

async function stopRtmp() {
  _startAborted = true;
  _rtmpActive = false;
  _stopStatusPoller();
  _stopCameraFallback();
  stopRtmpAudio();
  _releaseWakeLock();

  // Update UI immediately — don't block on the server response
  setRtmpState('idle');
  log('Go Live: stream stopped.', 'info');

  try {
    await fetch(`/api/rtmp/stop?sid=${session?._id || ''}`, { method: 'POST' });
  } catch (_) {}
}

/* ── Status poller — detects ffmpeg errors / unexpected exit ───────────────── */

function _startStatusPoller() {
  _stopStatusPoller();
  _statusPoller = setInterval(async () => {
    try {
      const res  = await fetch(`/api/rtmp/status?sid=${session?._id || ''}`);
      const data = await res.json();

      if (!data.running && _rtmpActive) {
        _rtmpActive = false;
        _stopStatusPoller();
        _stopCameraFallback();
        stopRtmpAudio();
        const msg = data.error
          ? `Stream stopped — ${data.error}`
          : 'Stream stopped unexpectedly. Check your RTMP URL and stream key.';
        setRtmpState('idle');
        setRtmpStatus('error', msg);
        log(`Go Live: ${msg}`, 'error');
      } else if (data.running && data.error && data.error !== _lastLoggedErr) {
        _lastLoggedErr = data.error;
        log(`Go Live: ${data.error}`, 'warn');
      }
    } catch (_) {}
  }, 2000);
}

function _stopStatusPoller() {
  if (_statusPoller) { clearInterval(_statusPoller); _statusPoller = null; }
}

/* ── UI helpers ────────────────────────────────────────────────────────────── */

function setRtmpState(state) {
  const dot    = document.getElementById('rtmpDot');
  const btn    = document.getElementById('rtmpBtn');
  const status = document.getElementById('rtmpStatus');
  if (!dot || !btn) return;

  if (state === 'idle') {
    dot.className    = 'dot';
    btn.textContent  = 'Go Live';
    btn.disabled     = false;
    btn.onclick      = startRtmp;
    btn.className    = 'btn-primary';
    if (status) { status.textContent = 'Not streaming'; status.className = ''; }
  } else if (state === 'connecting') {
    dot.className    = 'dot warn';
    btn.textContent  = 'Stop';
    btn.disabled     = false;
    btn.onclick      = stopRtmp;
    btn.className    = 'btn-danger';
    if (status) { status.textContent = 'Connecting…'; status.className = ''; }
  } else if (state === 'live') {
    dot.className    = 'dot active';
    btn.textContent  = 'Stop Streaming';
    btn.disabled     = false;
    btn.onclick      = stopRtmp;
    btn.className    = 'btn-danger';
    if (status) { status.textContent = 'Live'; status.className = 'msr-status ready'; }
  }
}

function setRtmpStatus(level, msg) {
  const status = document.getElementById('rtmpStatus');
  if (!status) return;
  status.textContent = msg;
  status.className   = level === 'error' ? 'msr-status error' : '';
}

/* ── Screen Wake Lock ──────────────────────────────────────────────────────── */

async function _startWakeLock() {
  if (!('wakeLock' in navigator) || _wakeLock) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => {
      if (_rtmpActive) _startWakeLock(); // re-acquire if user returns to tab
    });
    log('Screen Wake Lock active — screen will stay on while streaming', 'info');
  } catch (e) {
    log('Wake Lock unavailable — screen may dim during stream', 'warn');
  }
}

/* ── Cleanup on tab/browser close ──────────────────────────────────────────── */
window.addEventListener('beforeunload', () => {
  if (_rtmpActive) {
    _stopStatusPoller();
    _stopCameraFallback();
    stopRtmpAudio();
    _releaseWakeLock();
    navigator.sendBeacon(`/api/rtmp/stop?sid=${session?._id || ''}`);
  }
});
