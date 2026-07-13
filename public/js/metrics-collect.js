/* ─── Metrics data collection & AI detection ──────────────────── */
/* Face metrics polling lives in face-metrics-poller.js.          */

let _cachedStreamFps = 0;

function startMetrics() {
  // Reset face poller state and stop any previous intervals
  _stopFaceMetricsPoller();
  clearInterval(_metricsInterval);
  clearInterval(_timerInterval);
  _metricsInterval = null;
  _timerInterval   = null;

  _sessionStart = Date.now();
  _hist.fps = []; _hist.latency = []; _hist.faceLock = []; _hist.faceMatch = [];
  _peak.fps = 0; _peak.latency = Infinity; _peak.faceLock = 0; _peak.faceMatch = 0;

  document.getElementById('metricsPanel').style.display = 'block';
  document.getElementById('validationRow').style.display = 'flex';

  // Auto-enable face lock — detection always runs server-side, so show it by default
  if (!_faceApiEnabled) {
    _faceApiEnabled = true;
    const toggle = document.getElementById('faceLockToggle');
    if (toggle) toggle.checked = true;
    setModelStatus('faceLock', 'ready', 'Active');
    // Re-sync runs in session.js before _faceApiEnabled was set — send toggle now
    if (session?._id) {
      fetch('/api/bg/toggle/face_lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: session._id }),
      }).catch(() => {});
    }
  }

  log('Face Lock: server-side detection active (MediaPipe)', 'info');

  if (_faceMatchEnabled) {
    log('Face Match: server-side similarity active (MediaPipe)', 'info');
  }

  // Check BlazeFace detector status ~5s after session start
  setTimeout(async () => {
    try {
      const res = await fetch('/api/face-detector/status');
      if (!res.ok) return;
      const { mp_available, model_exists, detector_ready } = await res.json();
      if (!mp_available)      log('Face Lock: MediaPipe not installed on server — detection unavailable', 'error');
      else if (!model_exists) log('Face Lock: BlazeFace model file missing on server — detection unavailable', 'error');
      else if (!detector_ready) log('Face Lock: BlazeFace model found but detector not yet initialized', 'warn');
      else                    log('Face Lock: BlazeFace detector confirmed ready on server', 'success');
    } catch {}
  }, 5000);

  _startFaceMetricsPoller();
  _metricsInterval = setInterval(_collectMetrics, 1000);
  _timerInterval   = setInterval(_tickTimer, 1000);
}

function stopMetrics() {
  clearInterval(_metricsInterval);
  clearInterval(_timerInterval);
  _metricsInterval = _timerInterval = null;
  _stopFaceMetricsPoller();
  _cachedFaceLock  = 0;
  _cachedFaceMatch = 0;
  document.getElementById('metricsPanel').style.display = 'none';

  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const endTime     = new Date();
  const startTime   = _sessionStart ? new Date(_sessionStart) : null;
  const durationSec = _sessionStart ? Math.floor((Date.now() - _sessionStart) / 1000) : 0;
  const mins = String(Math.floor(durationSec / 60)).padStart(2, '0');
  const secs = String(durationSec % 60).padStart(2, '0');

  const summary = {
    duration_sec:     durationSec,
    avg_fps:          avg(_hist.fps),
    peak_fps:         _peak.fps || null,
    avg_latency_ms:   avg(_hist.latency),
    peak_latency_ms:  isFinite(_peak.latency) ? _peak.latency : null,
    avg_face_lock:    avg(_hist.faceLock),
    peak_face_lock:   _peak.faceLock || null,
    avg_face_match:   _faceMatchEnabled ? avg(_hist.faceMatch) : null,
    peak_face_match:  _faceMatchEnabled ? (_peak.faceMatch || null) : null,
    samples:          _hist.fps.length,
  };

  const lastFps       = _hist.fps.at(-1)       ?? null;
  const lastLatency   = _hist.latency.at(-1)   ?? null;
  const lastFaceLock  = _hist.faceLock.at(-1)  ?? null;
  const lastFaceMatch = _hist.faceMatch.at(-1) ?? null;

  log(`Stream ended: ${endTime.toLocaleString()}`, 'info');
  log('─── Session Performance Summary ───────────────', 'info');
  log(`Started: ${startTime ? startTime.toLocaleString() : '—'}  ·  Ended: ${endTime.toLocaleString()}`, 'info');
  log(`Duration: ${mins}:${secs}  ·  Samples: ${summary.samples}`, 'info');
  const gt = (gradeFn, v) => v !== null ? _GRADE_LOG[gradeFn(v)] : 'info';
  logMetric('FPS', [
    { text: `Last: ${lastFps ?? '—'} fps`,          type: gt(_fpsGrade, lastFps) },
    { text: `Best: ${summary.peak_fps ?? '—'} fps`, type: gt(_fpsGrade, summary.peak_fps) },
    { text: `Avg: ${summary.avg_fps ?? '—'} fps`,   type: gt(_fpsGrade, summary.avg_fps) },
  ]);
  if (summary.avg_latency_ms !== null)
    logMetric('Latency', [
      { text: `Last: ${lastLatency ?? '—'} ms`,             type: gt(_latencyGrade, lastLatency) },
      { text: `Best: ${summary.peak_latency_ms ?? '—'} ms`, type: gt(_latencyGrade, summary.peak_latency_ms) },
      { text: `Avg: ${summary.avg_latency_ms ?? '—'} ms`,   type: gt(_latencyGrade, summary.avg_latency_ms) },
    ]);
  else
    log('Latency: — (Agora stats unavailable)', 'info');
  logMetric('Face Lock', [
    { text: `Last: ${lastFaceLock ?? '—'} %`,           type: gt(_faceLockGrade, lastFaceLock) },
    { text: `Best: ${summary.peak_face_lock ?? '—'} %`, type: gt(_faceLockGrade, summary.peak_face_lock) },
    { text: `Avg: ${summary.avg_face_lock ?? '—'} %`,   type: gt(_faceLockGrade, summary.avg_face_lock) },
  ]);
  if (_faceMatchEnabled)
    logMetric('Face Match', [
      { text: `Last: ${lastFaceMatch ?? '—'} %`,            type: gt(_faceMatchGrade, lastFaceMatch) },
      { text: `Best: ${summary.peak_face_match ?? '—'} %`,  type: gt(_faceMatchGrade, summary.peak_face_match) },
      { text: `Avg: ${summary.avg_face_match ?? '—'} %`,    type: gt(_faceMatchGrade, summary.avg_face_match) },
    ]);
  if (_lastFaceData) {
    const runs  = _lastFaceData._runs        ?? 0;
    const hits  = _lastFaceData._hits        ?? 0;
    const mRuns = _lastFaceData._match_runs  ?? 0;
    const mHits = _lastFaceData._match_hits  ?? 0;
    log(`Face Lock: ${hits}/${runs} detections  ·  Face Match: ${mHits}/${mRuns} matches`, 'info');
  }
  const pd = getPipelineLast();
  if (pd) {
    log('─── Pipeline Totals ───────────────────────────', 'info');
    log(`Cam input    — ${pd.tot_cam_fps} fps avg  ·  Dropped: ${pd.tot_cam_drop}`, 'info');
    if (pd.tot_bg_active)
      log(`BG process   — ${pd.tot_bg_fps} fps avg  ·  ${pd.tot_bg_avg_ms} ms avg  ·  Dropped: ${pd.tot_bg_drop}`, 'info');
    const rttSuffix = pd.tot_akool_avg_rtt_ms > 0 ? `  ·  RTT: ${pd.tot_akool_avg_rtt_ms} ms avg` : '';
    log(`AKOOL in/out — ${pd.tot_akool_in_fps} / ${pd.tot_akool_out_fps} fps avg${rttSuffix}  ·  Stale discards: ${pd.tot_akool_stale}`, 'info');
    log(`Viewer feed  — Dropped: ${pd.tot_viewer_drop}`, 'info');
  }
  const ps = getPipelineStats();
  const _PIPELINE_LAT = [
    // [key, label, unit, higherIsBetter]
    ['ws_upload_ms',      'Upload (browser→server)   ', 'ms',  false],
    ['agora_frames_ms',   'Agora in (server→chrome)  ', 'ms',  false],
    ['stream_out_avg_ms', 'Stream-out (chrome→server)', 'ms',  false],
    ['agora_trans_ms',    'Agora transit             ', 'ms',  false],
    ['agora_jitter_ms',   'Agora jitter              ', 'ms',  false],
    ['agora_decode_ms',   'Agora decode              ', 'ms',  false],
    ['agora_e2e_ms',      'Agora e2e                 ', 'ms',  false],
    ['stream_in_ms',      'Stream-in latency         ', 'ms',  false],
    ['stream_in_fps',     'Stream-in fps             ', 'fps', true],
    ['display_lag_ms',    'Display lag               ', 'ms',  false],
    ['display_fps',       'Display fps               ', 'fps', true],
    ['content_fps',       'Content fps (new frames)  ', 'fps', true],
    ['freeze_count',      'Freeze events (per 20s)   ', '',    false],
    ['max_frame_gap_ms',  'Worst freeze gap          ', 'ms',  false],
  ];
  if (_PIPELINE_LAT.some(([k]) => ps[k])) {
    log('─── Latency Breakdown (session totals) ────────', 'info');
    for (const [key, label, unit, higherIsBetter] of _PIPELINE_LAT) {
      const s = ps[key];
      if (!s) continue;
      const best  = higherIsBetter ? s.max : s.min;
      const worst = higherIsBetter ? s.min : s.max;
      log(`${label} — First:${s.first}${unit}  Last:${s.last}${unit}  Best:${best}${unit}  Worst:${worst}${unit}  Avg:${s.avg}${unit}`, 'info');
    }
  }
  log('───────────────────────────────────────────────', 'info');

  return summary;
}

/* ── Timer ─────────────────────────────────────────────────── */

function _tickTimer() {
  const elapsed = Math.floor((Date.now() - _sessionStart) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('sessionTimer').textContent = `${m}:${s}`;
}

/* ── Main collect loop ──────────────────────────────────────── */

function _collectMetrics() {
  const fps     = _cachedStreamFps;
  const latency = _cachedLatency;

  const faceLock  = _sampleFaceLock();
  const faceMatch = _sampleFaceMatch();

  const push = (arr, val) => { arr.push(val); if (arr.length > 600) arr.shift(); };
  if (fps > 0) push(_hist.fps, fps);
  if (latency > 0) push(_hist.latency, latency);
  if (faceLock > 0) push(_hist.faceLock,  faceLock);
  if (faceMatch > 0) push(_hist.faceMatch, faceMatch);

  if (fps > _peak.fps)                         _peak.fps       = fps;
  if (latency > 0 && latency < _peak.latency)  _peak.latency   = latency;
  if (faceLock > _peak.faceLock)               _peak.faceLock  = faceLock;
  if (faceMatch > _peak.faceMatch)             _peak.faceMatch = faceMatch;

  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  _renderMetrics({
    fps,        avgFps:      avg(_hist.fps),
    latency,    avgLatency:  avg(_hist.latency),
    faceLock,   avgFaceLock: avg(_hist.faceLock),
    faceMatch,  avgFaceMatch: avg(_hist.faceMatch),
  });
}

/* ── Face Lock — server-side (polled by face-metrics-poller.js) ─ */

function _sampleFaceLock() {
  if (!_faceApiEnabled) return 0;
  return _cachedFaceLock;
}
