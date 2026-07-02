/* ─── Image resize helper ────────────────────────────────────── */

function _resizeImageToBlob(file, maxPx) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', 1.0);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ─── Step 1: Authenticate ───────────────────────────────────── */

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/authStatus');
    const cfg = await res.json();

    if (cfg.hasApiKey) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="apikey"]').classList.add('active');
      document.getElementById('tab-apikey').classList.add('active');
      document.getElementById('apiKey').placeholder = '(loaded from .env — no need to type)';
      log('API key detected in .env — click Authenticate to continue', 'success');
    } else if (cfg.hasClientId && cfg.hasClientSecret) {
      log('Client credentials detected in .env — click Authenticate to continue', 'success');
    } else {
      log('No credentials found in .env — enter them manually in Step 1', 'warn');
    }
  } catch {
    // Server not ready yet — ignore silently
  }
}

async function handleAuth() {
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;

  setAuthState('warn', 'Authenticating…');
  document.getElementById('btnAuth').disabled = true;

  try {
    if (activeTab === 'apikey') {
      const key = document.getElementById('apiKey').value.trim();
      // Send key to server for storage — server never echoes it back
      await api('/api/auth/apikey', key ? { apiKey: key } : {});
      log('Authenticated via API key', 'success');
    } else {
      const clientId     = document.getElementById('clientId').value.trim();
      const clientSecret = document.getElementById('clientSecret').value.trim();
      if (!clientId || !clientSecret) throw new Error('Enter both Client ID and Secret');

      // Server exchanges credentials for token and stores it — browser gets only expiry
      const data = await api('/api/getToken', { clientId, clientSecret });
      log(`Token obtained (expires in ${data.expire || '?'}s)`, 'success');
    }

    _authenticated = true;
    setAuthState('active', 'Authenticated');
    setModelStatus(_activeProviderId, 'ready', _providerConfig.labels?.authenticated ?? 'Authenticated');
    document.getElementById('btnStart').disabled = !detectedFace;
    log('Authentication successful', 'success');
    document.getElementById('creditCard').style.display = '';
  } catch (err) {
    _authenticated = false;
    setAuthState('error', 'Auth failed');
    setModelStatus(_activeProviderId, 'error', 'Auth failed');
    log(`Auth error: ${err.message}`, 'error');
  } finally {
    document.getElementById('btnAuth').disabled = false;
  }
}

/* ─── Credit balance ─────────────────────────────────────────── */
async function fetchCredit() {
  try {
    const res  = await fetch('/api/credit');
    const data = await res.json();
    if (data.credit !== undefined) {
      document.getElementById('creditBalance').textContent = data.credit.toLocaleString();
      document.getElementById('creditCard').style.display = '';
    }
  } catch {}
}

/* ─── File upload ────────────────────────────────────────────── */
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const allowed = ['image/jpeg', 'image/png'];
  if (!allowed.includes(file.type)) {
    log('Only PNG, JPG, and JPEG files are accepted.', 'error');
    return;
  }

  log(`Uploading ${file.name} (${(file.size / 1024).toFixed(1)} KB)…`);

  let uploadBlob;
  try {
    uploadBlob = await _resizeImageToBlob(file, 1024);
    log(`Resized to ${(uploadBlob.size / 1024).toFixed(1)} KB before upload`, 'info');
  } catch {
    uploadBlob = file;
  }

  const previewUrl = URL.createObjectURL(uploadBlob);
  const img = document.getElementById('facePreview');
  img.src = previewUrl;
  img.classList.add('visible');

  try {
    const form = new FormData();
    form.append('file', uploadBlob, 'image.jpg');

    const res  = await fetch('/api/uploadImage', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || 'Upload failed');

    document.getElementById('sourceImageUrl').value = data.url;

    if (data.reachable_by_provider) {
      document.getElementById('uploadWarning').style.display = 'none';
      log(`Uploaded — URL: ${data.url}`, 'success');
    } else {
      document.getElementById('uploadWarning').style.display = 'block';
      log(`Uploaded locally — set PUBLIC_BASE_URL in .env (see warning) for AKOOL to reach it`, 'warn');
    }

    event.target.value = '';
  } catch (err) {
    log(`Upload error: ${err.message}`, 'error');
  }
}

/* ─── Step 2: Detect faces ───────────────────────────────────── */
async function handleDetectFaces() {
  const url = document.getElementById('sourceImageUrl').value.trim();
  if (!url) { log('Enter a source image URL first', 'warn'); return; }
  if (!_authenticated) { log('Authenticate first', 'warn'); return; }

  log(`Detecting faces in: ${url}`);

  try {
    // Server parses AKOOL response and returns {opts, face_url} — no parsing needed here
    const data = await api('/api/detectFaces', { url });

    detectedFace = { path: url, opts: data.opts };
    log(`Face detected — opts: ${data.opts}`, 'success');

    if (data.face_url) {
      const img = document.getElementById('facePreview');
      img.src = data.face_url;
      img.classList.add('visible');
    }

    document.getElementById('btnClearFace').style.display = '';
    if (_authenticated) document.getElementById('btnStart').disabled = false;
  } catch (err) {
    log(`Face detection error: ${err.message}`, 'error');
  }
}

function clearDetectedFace() {
  detectedFace = null;
  const img = document.getElementById('facePreview');
  img.src = '';
  img.classList.remove('visible');
  document.getElementById('btnClearFace').style.display = 'none';
  document.getElementById('sourceImageUrl').value = '';
  document.getElementById('btnStart').disabled = true;
  log('Face cleared.', 'info');
}
