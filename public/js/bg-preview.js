/* ─── Background camera preview — browser-side BG test ─────────── */
/* Opens the camera, runs MediaPipe segmentation on each frame,
   and draws the composited result to bgPreviewCanvas in real time. */

let _camPreviewStream  = null;
let _camPreviewVideoEl = null;
let _camPreviewRaf     = null;

async function toggleCameraPreview() {
  if (_camPreviewStream) { _stopCameraPreview(); return; }
  await _startCameraPreview();
}

async function _startCameraPreview() {
  const btn = document.getElementById('btnCameraPreview');
  btn.disabled = true;

  try {
    _camPreviewStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 } },
      audio: false,
    });

    _camPreviewVideoEl = document.createElement('video');
    _camPreviewVideoEl.srcObject = _camPreviewStream;
    _camPreviewVideoEl.muted     = true;
    _camPreviewVideoEl.autoplay  = true;
    await _camPreviewVideoEl.play();

    if (!_segReady) {
      log('Initializing background removal model…', 'info');
      await _initSegmentation();
    }

    document.getElementById('bgPreviewPanel').style.display = 'block';

    const previewCanvas  = document.getElementById('bgPreviewCanvas');
    const landmarkCanvas = document.getElementById('bgLandmarkCanvas');

    const loop = async () => {
      if (!_camPreviewVideoEl) return;
      const vid = _camPreviewVideoEl;
      const w   = vid.videoWidth  || 640;
      const h   = vid.videoHeight || 360;

      if (previewCanvas.width !== w || previewCanvas.height !== h) {
        previewCanvas.width = w; previewCanvas.height = h;
      }
      if (landmarkCanvas.width !== w || landmarkCanvas.height !== h) {
        landmarkCanvas.width = w; landmarkCanvas.height = h;
      }

      const ctx = previewCanvas.getContext('2d');
      if (isBgActive() && _segReady && !_segProcessing) {
        _segProcessing = true;
        try   { await _compositeFrame(previewCanvas, ctx, w, h, vid); }
        catch { ctx.drawImage(vid, 0, 0, w, h); }
        finally { _segProcessing = false; }
      } else {
        ctx.drawImage(vid, 0, 0, w, h);
      }

      // Landmark canvas shows raw camera feed (debug reference)
      landmarkCanvas.getContext('2d').drawImage(vid, 0, 0, w, h);

      _camPreviewRaf = requestAnimationFrame(loop);
    };
    _camPreviewRaf = requestAnimationFrame(loop);

    btn.textContent = 'Stop Preview (BG Test)';
    btn.disabled    = false;
    log('Camera preview started — select a BG preset to see it applied in real time', 'success');

    // Start the OBS relay so this preview can be streamed via Go Live / RTMP
    if (typeof startPreviewStream === 'function') startPreviewStream();
  } catch (e) {
    log(`Camera preview failed: ${e.message}`, 'error');
    btn.disabled = false;
    _stopCameraPreview();
  }
}

function _stopCameraPreview() {
  if (_camPreviewRaf) { cancelAnimationFrame(_camPreviewRaf); _camPreviewRaf = null; }
  if (_camPreviewStream) {
    _camPreviewStream.getTracks().forEach(t => t.stop());
    _camPreviewStream = null;
  }
  _camPreviewVideoEl = null;
  setBgPreset('none');
  if (typeof bgReset === 'function') bgReset();
  document.getElementById('bgPreviewPanel').style.display = 'none';
  const btn = document.getElementById('btnCameraPreview');
  if (btn) { btn.textContent = 'Preview Camera (BG Test)'; btn.disabled = false; }
  log('Camera preview stopped', 'info');

  // Stop the relay only if no faceswap session is running
  if (!session?._id && typeof stopObsStream === 'function') stopObsStream();
}

// Called from session.js handleStart / handleStop
function bgCameraPreviewSyncSession(active) {
  const btn = document.getElementById('btnCameraPreview');
  if (!btn) return;
  if (active) {
    // Session starting — stop preview (camera can't be shared with Agora)
    if (_camPreviewStream) _stopCameraPreview();
    btn.disabled = true;
  } else {
    // Session stopped — re-enable preview button
    btn.disabled = false;
    // If preview was running before, restart the relay now that session is gone
    if (_camPreviewStream && typeof startPreviewStream === 'function') {
      startPreviewStream();
    }
  }
}
