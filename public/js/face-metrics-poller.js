/* ─── Server-side face metrics poller ──────────────────────────────────────── */
/* Polls /api/metrics/face every second and fires one-time diagnostics.
   Public API: _startFaceMetricsPoller() / _stopFaceMetricsPoller()            */

let _faceMetricsPoller     = null;
let _faceRunsDiagDone      = false;
let _faceMatchDiagDone     = false;
let _sourceFaceReadyLogged = false;
let _lastFaceData          = null;
let _periodic30sTimer      = null;

function _stopFaceMetricsPoller() {
  clearInterval(_faceMetricsPoller);
  clearInterval(_periodic30sTimer);
  _faceMetricsPoller     = null;
  _periodic30sTimer      = null;
  _faceRunsDiagDone      = false;
  _faceMatchDiagDone     = false;
  _sourceFaceReadyLogged = false;
  _lastFaceData          = null;
}

function _startFaceMetricsPoller() {
  if (_faceMetricsPoller) return;
  _faceMetricsPoller = setInterval(async () => {
    try {
      const [faceRes, streamRes] = await Promise.all([
        fetch(`/api/metrics/face?sid=${session?._id || ''}`),
        fetch(`/api/metrics/stream?sid=${session?._id || ''}`),
      ]);
      if (faceRes.ok) {
        const faceData = await faceRes.json();
        _cachedFaceLock  = faceData.face_lock  ?? 0;
        _cachedFaceMatch = faceData.face_match ?? 0;
        _lastFaceData    = faceData;

        // One-time diagnostic: face lock detection status
        if (!_faceRunsDiagDone && (faceData._runs ?? 0) > 0) {
          _faceRunsDiagDone = true;
          const runs = faceData._runs;
          const hits = faceData._hits ?? 0;
          if (hits > 0) {
            log(`Face Lock: detection running — ${hits}/${runs} samples with face`, 'success');
          } else {
            log(`Face Lock: detection running (${runs} samples) but no face found in stream`, 'warn');
          }
        } else if (!_faceRunsDiagDone && Date.now() - _sessionStart > 20000 && (faceData._runs ?? 0) === 0) {
          _faceRunsDiagDone = true;
          log('Face Lock: server detection not receiving frames — check stream relay', 'warn');
        }

        // One-time diagnostic: source face embedding
        if (!_sourceFaceReadyLogged && faceData.source_face_ready) {
          _sourceFaceReadyLogged = true;
          log('Face Match: source face embedding ready — similarity tracking active', 'success');
        } else if (!_sourceFaceReadyLogged && Date.now() - _sessionStart > 15000 && !faceData.source_face_ready) {
          _sourceFaceReadyLogged = true;
          log('Face Match: source face not embedded after 15s — check source image or face detector', 'warn');
        }

        // One-time diagnostic: face match runs/hits
        if (!_faceMatchDiagDone && faceData.source_face_ready && (faceData._match_runs ?? 0) > 0) {
          _faceMatchDiagDone = true;
          const mRuns = faceData._match_runs;
          const mHits = faceData._match_hits ?? 0;
          if (mHits > 0) {
            log(`Face Match: running — ${mHits}/${mRuns} samples matched`, 'success');
          } else {
            log(`Face Match: running (${mRuns} samples) but similarity score is very low`, 'warn');
          }
        } else if (!_faceMatchDiagDone && faceData.source_face_ready && Date.now() - _sessionStart > 30000 && (faceData._match_runs ?? 0) === 0) {
          _faceMatchDiagDone = true;
          log('Face Match: source face ready but no match runs after 30s — check stream frames', 'warn');
        }

        // Start periodic 30s score log (once, lives until _stopFaceMetricsPoller)
        if (!_periodic30sTimer) {
          _periodic30sTimer = setInterval(() => {
            if (_faceApiEnabled) {
              log(`[30s] Face Lock: ${_cachedFaceLock}%  ·  Face Match: ${_cachedFaceMatch}%`, 'info');
            }
          }, 30000);
        }
      }
      if (streamRes.ok) {
        const { fps, latency } = await streamRes.json();
        _cachedStreamFps = fps ?? 0;
        _cachedLatency   = latency ?? 0;
      }
    } catch {}
  }, 1000);
}
