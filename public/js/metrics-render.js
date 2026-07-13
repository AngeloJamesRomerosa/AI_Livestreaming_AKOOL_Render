/* ─── Metrics UI rendering ────────────────────────────────────── */

function _renderMetrics({ fps, avgFps, latency, avgLatency, faceLock, avgFaceLock, faceMatch, avgFaceMatch }) {
  _setVal('mFps',    fps    > 0 ? `${fps} fps`    : '— fps',    fps    > 0 ? _fpsGrade(fps)    : 'light-warn');
  _setVal('mAvgFps', avgFps > 0 ? `${avgFps} fps` : '— fps',    avgFps > 0 ? _fpsGrade(avgFps) : 'light-warn');

  _setVal('mLatency',    latency    > 0 ? `${latency} ms`    : '— ms', latency    > 0 ? _latencyGrade(latency)    : 'light-warn');
  _setVal('mAvgLatency', avgLatency > 0 ? `${avgLatency} ms` : '— ms', avgLatency > 0 ? _latencyGrade(avgLatency) : 'light-warn');

  _setVal('mFaceLock',    `${faceLock} %`,    _faceLockGrade(faceLock));
  _setVal('mAvgFaceLock', `${avgFaceLock} %`, _faceLockGrade(avgFaceLock));

  const bar = document.getElementById('faceLockBar');
  bar.style.width      = `${Math.min(faceLock, 100)}%`;
  bar.style.background = _GRADE_COLOR[_faceLockGrade(faceLock)];
  document.getElementById('faceLockPct').textContent = `${faceLock} %`;

  const showMatch = _faceMatchEnabled;
  ['mFaceMatchRow0','mFaceMatch','mFaceMatchAvg','mFaceMatchRow3'].forEach(id => {
    document.getElementById(id).style.display = showMatch ? '' : 'none';
  });
  if (showMatch) {
    _setVal('mFaceMatch',    `${faceMatch} %`,    _faceMatchGrade(faceMatch));
    _setVal('mFaceMatchAvg', `${avgFaceMatch} %`, _faceMatchGrade(avgFaceMatch));
  }


  _setValidation('valFps',      avgFps > 0 ? _fpsGrade(avgFps) : 'light-warn', avgFps > 0 ? `FPS ${avgFps}` : 'FPS —');
  _setValidation('valLatency',  avgLatency > 0 ? _latencyGrade(avgLatency) : 'light-warn', avgLatency > 0 ? `Latency ${avgLatency}ms` : 'Latency —');
  _setValidation('valFaceLock', _faceLockGrade(avgFaceLock), `Lock ${avgFaceLock}%`);
  const matchBadge = document.getElementById('valFaceMatch');
  if (showMatch) {
    _setValidation('valFaceMatch', _faceMatchGrade(avgFaceMatch), `Match ${avgFaceMatch}%`);
    matchBadge.style.display = '';
  } else {
    matchBadge.style.display = 'none';
  }

  const allPass = avgFps >= 25 && avgFaceLock >= 75 && (avgLatency === 0 || avgLatency <= 400);
  const anyFail = (avgFps > 0 && avgFps <= 7) || avgFaceLock < 25 || (avgLatency > 0 && avgLatency > 800);
  document.getElementById('overallDot').className     = `dot ${allPass ? 'active' : anyFail ? 'error' : 'warn'}`;
  document.getElementById('overallLabel').textContent = allPass ? 'All targets met' : anyFail ? 'Below targets' : 'Approaching targets';
}

function _setVal(id, text, grade) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className   = `mg-val ${grade}`;
}

function _setValidation(id, grade, label) {
  const el = document.getElementById(id);
  el.textContent = grade === 'good' ? `✓ ${label}` : `✗ ${label}`;
  const cls = { good: 'pass', 'light-warn': 'light-warn', warn: 'warn', bad: 'fail' }[grade] ?? 'fail';
  el.className = `val-item ${cls}`;
}
