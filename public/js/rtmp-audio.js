/* ─── RTMP Audio capture ──────────────────────────────────────────────────── */

let _audioCtx    = null;
let _audioSource = null;
let _audioProc   = null;
let _audioWs     = null;
let _audioStream = null;

async function _startAudio() {
  _audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

  _audioCtx    = new AudioContext({ sampleRate: 48000 });
  _audioSource = _audioCtx.createMediaStreamSource(_audioStream);
  _audioProc   = _audioCtx.createScriptProcessor(4096, 1, 1);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  _audioWs = new WebSocket(`${proto}://${location.host}/ws/audio-out?sid=${session?._id || ''}`);
  _audioWs.binaryType = 'arraybuffer';

  _audioProc.onaudioprocess = (e) => {
    if (!_audioWs || _audioWs.readyState !== WebSocket.OPEN) return;
    const float32 = e.inputBuffer.getChannelData(0);
    const int16   = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    _audioWs.send(int16.buffer);
  };

  _audioSource.connect(_audioProc);
  _audioProc.connect(_audioCtx.destination);
}

function stopRtmpAudio() {
  if (_audioProc)   { try { _audioProc.disconnect(); } catch (_) {} _audioProc = null; }
  if (_audioSource) { try { _audioSource.disconnect(); } catch (_) {} _audioSource = null; }
  if (_audioCtx)    { try { _audioCtx.close(); } catch (_) {} _audioCtx = null; }
  if (_audioWs)     { try { _audioWs.close(); } catch (_) {} _audioWs = null; }
  if (_audioStream) {
    _audioStream.getTracks().forEach(t => t.stop());
    _audioStream = null;
  }
}
