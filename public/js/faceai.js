/* ─── Face AI toggles ─────────────────────────────────────────── */
// Face Lock and Face Match both run server-side (bg_processor.py).
// This file is purely UI toggle handlers.

function toggleFaceLock(enabled) {
  _faceApiEnabled = enabled;
  // Tell the server to start/stop the BlazeFace background thread
  fetch('/api/bg/toggle/face_lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: session?._id || '' }),
  }).catch(() => {});
  if (enabled) {
    setModelStatus('faceLock', 'ready', 'Active');
    log('Face Lock: server-side BlazeFace active (3 fps background thread)', 'success');
  } else {
    _cachedFaceLock = 0;
    setModelStatus('faceLock', 'loaded', 'Ready');
    log('Face Lock: disabled', 'info');
  }
}

function toggleFaceMatch(enabled) {
  _faceMatchEnabled = enabled;
  if (enabled) {
    setModelStatus('faceMatch', 'ready', 'Active');
    log('Face Match: server-side similarity active', 'success');
  } else {
    _cachedFaceMatch = 0;
    setModelStatus('faceMatch', 'loaded', 'Ready');
    log('Face Match: disabled', 'info');
  }
}

// Mark both as ready on page load (toggles stay off by default)
setModelStatus('faceLock', 'loaded', 'Ready');
setModelStatus('faceMatch', 'loaded', 'Ready');
