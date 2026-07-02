/* ─── Camera conflict helpers ─────────────────────────────────────────────── */

function _showCameraConflict() {
  log('Webcam is in use by another app/website.', 'error');
  log('Go to app/website → change camera to OBS Virtual Camera', 'warn');
  document.getElementById('cameraConflictNotice').style.display = 'block';
  // If a session is already running keep Stop reachable; only reset to idle when no session exists
  if (session) {
    document.getElementById('btnStart').disabled = true;
    document.getElementById('btnStop').disabled  = false;
  } else {
    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnStop').disabled  = true;
  }
}

async function retryCamera() {
  document.getElementById('cameraConflictNotice').style.display = 'none';
  document.getElementById('btnStart').disabled = true;
  log('Retrying camera access…');
  try {
    await connectCamera();
    document.getElementById('localPlaceholder').classList.add('hidden');
    document.getElementById('btnStop').disabled  = false;
    document.getElementById('btnStart').disabled = true;
  } catch (camErr) {
    const msg = camErr.message || '';
    if (camErr.name === 'NotReadableError' || msg.includes('Device in use')) {
      _showCameraConflict();
    } else {
      log(`Camera error: ${camErr.message}`, 'error');
      // Session is active during retryCamera — keep Stop reachable, not Start
      document.getElementById('btnStop').disabled  = false;
      document.getElementById('btnStart').disabled = true;
    }
  }
}
