/* ─── Step 3: Start faceswap session + Agora ─────────────────── */
async function handleStart() {
  if (!_authenticated) { log('Authenticate first', 'warn'); return; }
  if (!detectedFace) { log('Detect a face image first', 'warn'); return; }

  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnStop').disabled = false;
  document.getElementById('qualitySelector').style.pointerEvents = 'none';
  document.getElementById('qualitySelector').style.opacity = '0.5';
  bgCameraPreviewSyncSession(true);

  try {
    log('Creating live faceswap session — waiting for AKOOL to be ready…');
    const createRes = await api('/api/session/create', {
      sourceImage: [detectedFace],
      faceswapQuality: getPreset().faceswapQuality,
    });

    assertProvider(createRes, 'Session creation failed');

    session = createRes.data;
    log(`Session ready: ${session._id}`, 'success');
    updateSessionInfo();

    log('Connecting to Agora RTC channel…');
    await connectAgora();

    log('Live faceswap is active!', 'success');
    setModelStatus('akool', 'ready', 'Session active');
    document.getElementById('localPlaceholder').classList.add('hidden');
    showObsPanel();
    openVcamPanel();
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnStop').disabled = true;
  }
}

/* Connect to Agora using session credentials */
async function connectAgora() {
  const { app_id, channel_id, front_user_id, front_rtc_token } = session;

  if (!app_id || !channel_id) {
    throw new Error(
      `Missing Agora credentials in session response. ` +
      `Got: ${JSON.stringify({ app_id, channel_id, front_user_id })}`
    );
  }

  agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'h264' });

  let _streamArrived = false;
  agoraClient.on('user-published', async (user, mediaType) => {
    await agoraClient.subscribe(user, mediaType);
    if (mediaType === 'video') {
      _streamArrived = true;
      user.videoTrack.play('remote-video');
      document.getElementById('remotePlaceholder').classList.add('hidden');
      log('Receiving AI face-swapped video stream', 'success');
      startMetrics();
    }
    if (mediaType === 'audio') {
      user.audioTrack.play();
    }
  });

  setTimeout(() => {
    if (!_streamArrived && agoraClient) {
      log('No AI stream received after 20 s — AKOOL is not sending a face-swapped video.', 'warn');
      log('Possible reasons:', 'warn');
      log('  1. Free quota / credits exhausted — check akool.com → account → live faceswap', 'warn');
      log('  2. Session status returned "Not Found" — AKOOL did not register this session', 'warn');
      log('  3. Source face image was rejected — no face detected or low quality image', 'warn');
      log('  4. AKOOL server is overloaded — try stopping and starting a new session', 'warn');
      log('  5. Network issue between AKOOL and the Agora channel', 'warn');
    }
  }, 20000);

  agoraClient.on('user-unpublished', (user, mediaType) => {
    if (mediaType === 'video') {
      document.getElementById('remotePlaceholder').classList.remove('hidden');
      log('Remote stream paused', 'warn');
    }
  });

  agoraClient.on('connection-state-change', (curr, prev) => {
    log(`Agora connection: ${prev} → ${curr}`);
  });

  await agoraClient.join(app_id, channel_id, front_rtc_token, parseInt(front_user_id, 10));
  log(`Joined Agora channel: ${channel_id}`, 'success');

  const preset = getPreset();
  try {
    [localAudioTrack, localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
      {},
      { encoderConfig: preset.camera, optimizationMode: preset.optimizationMode }
    );
  } catch (camErr) {
    const msg = camErr.message || '';
    if (camErr.code === 'NOT_READABLE' || msg.includes('NotReadable') || msg.includes('Device in use')) {
      _showCameraConflict();
      return;
    }
    throw camErr;
  }
  log(`Camera: ${preset.camera.width}×${preset.camera.height} @ ${preset.camera.frameRate}fps (${_selectedPreset} preset)`);

  localVideoTrack.play('local-video');

  // Option A background removal — publish composited canvas instead of raw camera
  let _publishVideoTrack = localVideoTrack;
  if (isBgOptionA()) {
    const bgTrack = await bgStartOptionA(localVideoTrack);
    if (bgTrack) {
      _publishVideoTrack = bgTrack;
      // Show the composited (blurred) canvas in the local panel so the user
      // can see the effect immediately without waiting for AKOOL output.
      const panel = document.getElementById('local-video');
      const rawVid = panel.querySelector('video');
      if (rawVid) rawVid.style.opacity = '0';
      if (_optionACanvas) {
        _optionACanvas.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;';
        panel.appendChild(_optionACanvas);
      }
    }
  }

  await agoraClient.publish([localAudioTrack, _publishVideoTrack]);
  log('Local camera published to channel', 'success');
}

/* ─── Step 4: Stop ───────────────────────────────────────────── */
async function handleStop() {
  document.getElementById('btnStop').disabled = true;

  try {
    if (_vcamWs) stopVirtualCamera();
    stopObsStream();
    bgStopOptionA();
    bgReset();
    const metricsSummary = stopMetrics();

    if (localVideoTrack) { localVideoTrack.stop(); localVideoTrack.close(); localVideoTrack = null; }
    if (localAudioTrack) { localAudioTrack.stop(); localAudioTrack.close(); localAudioTrack = null; }

    if (agoraClient) {
      await agoraClient.leave();
      agoraClient = null;
      log('Left Agora channel');
    }

    if (session?._id) {
      const res = await api('/api/session/close', { _id: session._id });
      if (res.code === 1000) {
        log('AKOOL session closed', 'success');
      } else {
        const msg = _providerConfig.error_codes?.[res.code] || res.msg || 'Close failed';
        log(`[${res.code}] ${msg}`, 'warn');
      }
      session = null;
    }

    if (metricsSummary && metricsSummary.samples > 0) {
      fetch('/api/metrics/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metricsSummary),
      }).catch(() => {});
    }

    document.getElementById('localPlaceholder').classList.remove('hidden');
    document.getElementById('remotePlaceholder').classList.remove('hidden');
    document.getElementById('sessionInfo').textContent = 'No active session.';
    document.getElementById('btnStart').disabled = false;
    document.getElementById('qualitySelector').style.pointerEvents = '';
    document.getElementById('qualitySelector').style.opacity = '';
    bgCameraPreviewSyncSession(false);
    setModelStatus('akool', 'ready', 'Authenticated');
    log('Stopped.', 'info');
  } catch (err) {
    log(`Stop error: ${err.message}`, 'error');
    document.getElementById('btnStop').disabled = false;
  }
}

/* ─── Camera conflict helpers ────────────────────────────────── */
function _showCameraConflict() {
  log('Webcam is in use by another app/website.', 'error');
  log('Go to app/website → change camera to OBS Virtual Camera', 'warn');
  document.getElementById('cameraConflictNotice').style.display = 'block';
  document.getElementById('btnStart').disabled = false;
  document.getElementById('btnStop').disabled  = true;
}

async function retryCamera() {
  document.getElementById('cameraConflictNotice').style.display = 'none';
  document.getElementById('btnStart').disabled = true;
  log('Retrying camera access…');

  const preset = getPreset();
  try {
    [localAudioTrack, localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
      {},
      { encoderConfig: preset.camera, optimizationMode: preset.optimizationMode }
    );
    localVideoTrack.play('local-video');
    await agoraClient.publish([localAudioTrack, localVideoTrack]);
    document.getElementById('localPlaceholder').classList.add('hidden');
    document.getElementById('btnStop').disabled  = false;
    document.getElementById('btnStart').disabled = true;
    log(`Camera: ${preset.camera.width}×${preset.camera.height} @ ${preset.camera.frameRate}fps (${_selectedPreset} preset)`);
    log('Local camera published — live faceswap is active!', 'success');
  } catch (camErr) {
    const msg = camErr.message || '';
    if (camErr.code === 'NOT_READABLE' || msg.includes('NotReadable') || msg.includes('Device in use')) {
      _showCameraConflict();
    } else {
      log(`Camera error: ${camErr.message}`, 'error');
      document.getElementById('btnStart').disabled = false;
    }
  }
}

/* ─── UI helpers ─────────────────────────────────────────────── */
function updateSessionInfo() {
  if (!session) return;
  document.getElementById('sessionInfo').innerHTML =
    `<strong>ID:</strong> ${session._id}<br>` +
    `<strong>Status:</strong> ${statusLabel(session.status)}<br>` +
    `<strong>Channel:</strong> ${session.channel_id || '—'}`;
}

function statusLabel(s) {
  return { 1: 'Queued', 2: 'Processing (ready)', 3: 'Completed', 4: 'Failed' }[s] || `Unknown (${s})`;
}
