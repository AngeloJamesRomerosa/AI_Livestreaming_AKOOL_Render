export default [
  {
    files: ["public/js/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly",
        location: "readonly", fetch: "readonly", WebSocket: "readonly",
        Worker: "readonly", URL: "readonly", Blob: "readonly",
        setInterval: "readonly", clearInterval: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly",
        MediaStreamTrackProcessor: "readonly",
        AudioContext: "readonly", webkitAudioContext: "readonly",
        // app globals exposed across files
        session: "writable", log: "readonly", _setVidLog: "readonly",
        _cameraWorker: "writable", localVideoTrack: "writable",
        startMetrics: "readonly", getPreset: "readonly",
        connectCamera: "readonly", _wakeLock: "writable",
        _releaseWakeLock: "readonly", _requestWakeLock: "readonly",
        stopRtmpAudio: "readonly", _startAudio: "readonly",
        setRtmpState: "readonly", setRtmpStatus: "readonly",
        _startCameraFallback: "readonly", _stopCameraFallback: "readonly",
        _startStatusPoller: "readonly", _stopStatusPoller: "readonly",
        _startWakeLock: "readonly", _startAudioKeepalive: "readonly",
        _stopAudioKeepalive: "readonly", _showCameraConflict: "readonly",
        _startMainThreadCapture: "readonly",
        _streamProfiles: "writable", _selectedRes: "writable",
        _selectedFps: "writable", _selectedBTier: "writable",
        _selectedPreset: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-redeclare": "error",
    },
  },
];
