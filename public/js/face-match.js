/* ─── Face Match — server-side similarity via bg_processor.py ─── */
// Score is polled from /api/metrics/face every second and stored in
// _cachedFaceMatch by metrics-collect.js. Nothing runs in the browser.

function _sampleFaceMatch() {
  if (!_faceMatchEnabled) return 0;
  return _cachedFaceMatch;
}
