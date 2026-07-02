/* ─── iOS / Firefox main-thread camera capture ──────────────────────────────── */
/*
   Fallback for browsers without MediaStreamTrackProcessor (iOS Safari, Firefox).

   Two-tier approach:
   1. Frame capture  — main thread (camera access requires it)
        • requestVideoFrameCallback  if available (iOS 15.4+) — synced to actual frames
        • setInterval fallback for older iOS / Firefox
   2. Encoding + WebSocket — Worker if OffscreenCanvas available (iOS 16.4+)
        • Decouples network layer from main-thread throttling
        • Falls back to main-thread canvas.toBlob if Worker/OffscreenCanvas unavailable
*/

function _startMainThreadCapture(stream, wsUrl, frameRate) {
  const video    = document.querySelector('#local-video video');
  const canvas   = document.createElement('canvas');
  const ctx      = canvas.getContext('2d');
  const interval = Math.round(1000 / frameRate);

  const _useWorker = typeof OffscreenCanvas !== 'undefined';

  let _ws          = null;
  let _worker      = null;
  let _captureRvfc = null;
  let _captureIval = null;
  let _sending     = false;
  let _workerReady = false;

  function _onReady() {
    log('Camera: WebSocket connected — frames flowing to server', 'success');
    _setVidLog('cam', 'active', 'Sending frames to server');
    startMetrics();
    document.getElementById('remotePlaceholder').classList.add('hidden');
  }

  function _onClosed() {
    _setVidLog('cam', 'warn', 'Relay disconnected — reconnecting…');
    _cameraWorker = null;
    if (session) {
      log('Camera: relay WebSocket closed — reconnecting…', 'warn');
      setTimeout(connectCamera, 2000);
    }
  }

  // ── Encoding Worker (iOS 16.4+ / OffscreenCanvas) ──────────────────────────
  if (_useWorker) {
    const src = `
      let ws = null, canvas = null, sending = false;
      self.onmessage = async ({ data }) => {
        if (data.type === 'init') {
          ws = new WebSocket(data.wsUrl);
          ws.onopen  = () => self.postMessage('ready');
          ws.onclose = () => self.postMessage('closed');
          ws.onerror = () => self.postMessage('error');
          return;
        }
        if (data.type !== 'frame' || !ws || ws.readyState !== 1 || sending) {
          data.bitmap?.close(); return;
        }
        sending = true;
        const bmp = data.bitmap;
        if (!canvas || canvas.width !== bmp.width || canvas.height !== bmp.height)
          canvas = new OffscreenCanvas(bmp.width, bmp.height);
        canvas.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        try {
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.90 });
          if (ws.readyState === 1) ws.send(blob);
        } catch(_) {}
        sending = false;
      };
    `;
    const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    _worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);
    _worker.onmessage = ({ data }) => {
      if (data === 'ready')       { _workerReady = true; _onReady(); }
      else if (data === 'closed') _onClosed();
      else if (data === 'error')  { log('iOS camera WebSocket error — reconnecting…', 'warn'); _onClosed(); }
    };
    _worker.postMessage({ type: 'init', wsUrl });
    log('iOS: Worker encoding active (OffscreenCanvas)', 'info');
  } else {
    // ── Main-thread WebSocket fallback (older iOS / Firefox) ─────────────────
    _ws = new WebSocket(wsUrl);
    _ws.onopen  = _onReady;
    _ws.onclose = _onClosed;
    _ws.onerror = () => _setVidLog('cam', 'error', 'WebSocket error');
    log('iOS: main-thread capture (OffscreenCanvas unavailable)', 'info');
  }

  // ── Frame capture ───────────────────────────────────────────────────────────
  function _captureFrame() {
    if (!video || video.readyState < 2) return;
    if (canvas.width  !== video.videoWidth)  canvas.width  = video.videoWidth  || 640;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight || 360;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (_useWorker && _worker && _workerReady) {
      createImageBitmap(canvas).then(bmp =>
        _worker.postMessage({ type: 'frame', bitmap: bmp }, [bmp])
      );
    } else if (!_useWorker && _ws && _ws.readyState === 1 && !_sending) {
      _sending = true;
      canvas.toBlob(blob => {
        if (blob && _ws?.readyState === 1) _ws.send(blob);
        _sending = false;
      }, 'image/jpeg', 0.85);
    }
  }

  // requestVideoFrameCallback fires in sync with actual camera frames (iOS 15.4+)
  // setInterval fallback for older iOS / Firefox
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const _rvfcLoop = () => {
      _captureFrame();
      _captureRvfc = video.requestVideoFrameCallback(_rvfcLoop);
    };
    _captureRvfc = video.requestVideoFrameCallback(_rvfcLoop);
    log('iOS: requestVideoFrameCallback active', 'info');
  } else {
    _captureIval = setInterval(_captureFrame, interval);
    log('iOS: setInterval capture (requestVideoFrameCallback unavailable)', 'info');
  }

  // Fake worker object — compatible with connectCamera's terminate() call
  _cameraWorker = {
    onmessage: null,
    terminate() {
      if (_captureRvfc) { video.cancelVideoFrameCallback(_captureRvfc); _captureRvfc = null; }
      clearInterval(_captureIval);
      if (_worker) { _worker.terminate(); _worker = null; }
      if (_ws)     { _ws.onclose = null; _ws.close(); _ws = null; }
    },
  };
}
