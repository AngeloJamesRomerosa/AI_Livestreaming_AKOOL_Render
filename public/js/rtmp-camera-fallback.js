/* ─── RTMP camera fallback — test mode (no active faceswap session) ──────── */

let _camFbWs      = null;
let _camFbTimer   = null;
let _camFbCanvas  = null;
let _camFbStream  = null;
let _camFbSending = false;

async function _startCameraFallback() {
  // Use the existing local camera preview if a session is active, else open a new one
  let videoEl = document.querySelector('#local-video video');

  if (!videoEl || videoEl.readyState < 2) {
    _camFbStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoEl = document.createElement('video');
    videoEl.srcObject = _camFbStream;
    videoEl.muted     = true;
    await videoEl.play();
  }

  _camFbCanvas        = document.createElement('canvas');
  _camFbCanvas.width  = videoEl.videoWidth  || 640;
  _camFbCanvas.height = videoEl.videoHeight || 480;
  const ctx = _camFbCanvas.getContext('2d');

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  _camFbWs = new WebSocket(`${proto}://${location.host}/ws/stream-out?sid=${session?._id || '__preview__'}`);

  _camFbWs.onopen = () => {
    _camFbSending = false;
    _camFbTimer = setInterval(() => {
      if (_camFbSending) return;
      if (!_camFbWs || _camFbWs.readyState !== WebSocket.OPEN) return;
      if (!videoEl || videoEl.readyState < 2) return;
      _camFbSending = true;
      ctx.drawImage(videoEl, 0, 0, _camFbCanvas.width, _camFbCanvas.height);
      _camFbCanvas.toBlob(blob => {
        if (blob && _camFbWs?.readyState === WebSocket.OPEN) {
          if (_camFbWs.bufferedAmount < 240000) _camFbWs.send(blob);
        }
        _camFbSending = false;
      }, 'image/jpeg', 0.85);
    }, 1000 / 25);
  };

  _camFbWs.onclose = () => { _camFbTimer && clearInterval(_camFbTimer); _camFbTimer = null; };
}

function _stopCameraFallback() {
  if (_camFbTimer)  { clearInterval(_camFbTimer); _camFbTimer = null; }
  if (_camFbWs)     { try { _camFbWs.close(); } catch (_) {} _camFbWs = null; }
  if (_camFbCanvas) { _camFbCanvas = null; }
  if (_camFbStream) { _camFbStream.getTracks().forEach(t => t.stop()); _camFbStream = null; }
}
