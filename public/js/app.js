/* ─── Shared state ───────────────────────────────────────────── */
let _authenticated = false; // true once server confirms auth — token stays server-side
let detectedFace = null;   // { path, opts } ready for session create
let session = null;        // { _id, status, stream_path } — Agora creds stay server-side
let localVideoTrack = null; // active MediaStream from getUserMedia (for cleanup on stop)
let _cameraWorker = null;  // Web Worker — capture→encode→send pipeline, immune to main-thread throttling

function toggleAccordion(arg) {
  if (typeof arg === 'string') {
    const body    = document.getElementById(arg + 'Body');
    const chevron = document.getElementById(arg + 'Chevron');
    if (!body) return;
    const opening = body.style.display === 'none';
    body.style.display = opening ? '' : 'none';
    if (chevron) chevron.classList.toggle('open', opening);
  } else {
    arg.parentElement.classList.toggle('open');
  }
}

/* ─── Logging ────────────────────────────────────────────────── */
function log(msg, type = 'info') {
  const el = document.getElementById('log');
  const line = document.createElement('div');
  line.className = `log-${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function clearLog() {
  document.getElementById('log').innerHTML = '';
}

function logMetric(label, parts) {
  const el   = document.getElementById('log');
  const line = document.createElement('div');
  line.className = 'log-info';
  const time = new Date().toLocaleTimeString();
  const html = parts.map(({ text, type }) =>
    `<span class="log-${type}">${text}</span>`
  ).join(' · ');
  line.innerHTML = `[${time}] ${label} — ${html}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

/* ─── Tabs ───────────────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const group = tab.parentElement;
    group.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const paneId = `tab-${tab.dataset.tab}`;
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById(paneId)?.classList.add('active');
  });
});

/* ─── Video panel activity log ───────────────────────────────── */
function _setVidLog(id, state, text) {
  const el = document.getElementById(id + 'Log');
  if (!el) return;
  el.className = 'vid-log' + (state ? ' ' + state : '');
  const t = el.querySelector('.vid-log-text');
  if (t) t.textContent = text;
}

/* ─── Helper: model loading status indicators ────────────────── */
function setModelStatus(id, state, text) {
  const row = document.getElementById('msr-' + id);
  if (!row) return;
  const dot = row.querySelector('.msr-dot');
  dot.className = 'msr-dot ' + state;

  // Services rows use a single .msr-status span
  const statusEl = row.querySelector('.msr-status');
  if (statusEl) {
    statusEl.className   = 'msr-status ' + state;
    statusEl.textContent = text;
    return;
  }

  // AI Model rows use dual Ready / Active badges
  const readyBadge  = row.querySelector('.msr-ready-badge');
  const activeBadge = row.querySelector('.msr-active-badge');
  if (!readyBadge || !activeBadge) return;
  readyBadge.className  = 'msr-badge msr-ready-badge'  + (state === 'loaded' || state === 'ready' ? ' on' : '');
  activeBadge.className = 'msr-badge msr-active-badge' + (state === 'ready' ? ' on' : '');
}

/* ─── Helper: set auth dot state ─────────────────────────────── */
function setAuthState(state, message) {
  const dot = document.getElementById('authDot');
  const status = document.getElementById('authStatus');
  dot.className = `dot ${state}`;
  status.textContent = message;
}

/* ─── Helper: API fetch wrapper ──────────────────────────────── */
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const detail = data.detail;
    const msg = typeof detail === 'object'
      ? `[${detail.code}] ${detail.message}`
      : (detail || data.error || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return data;
}

/* ─── Metrics shared state ───────────────────────────────────── */
const _hist = { fps: [], latency: [], faceLock: [], faceMatch: [] };
const _peak = { fps: 0, latency: 0, faceLock: 0, faceMatch: 0 };

let _metricsInterval = null;
let _timerInterval   = null;
let _sessionStart    = null;


/* ─── Server-side AI shared state ────────────────────────────── */
let _faceApiEnabled = false;
let _cachedFaceLock = 0;
let _cachedLatency  = 0;

let _faceMatchEnabled = false;
let _cachedFaceMatch  = 0;

/* ─── Grade helpers ──────────────────────────────────────────── */
function _fpsGrade(v)       { return v >= 25 ? 'good' : v >= 15 ? 'light-warn' : v >= 8 ? 'warn' : 'bad'; }
function _latencyGrade(v)   { return v <= 400 ? 'good' : v <= 600 ? 'light-warn' : v <= 800 ? 'warn' : 'bad'; }
function _faceLockGrade(v)  { return v >= 75 ? 'good' : v >= 50 ? 'light-warn' : v >= 25 ? 'warn' : 'bad'; }
// Cosine similarity: ≥ 0.9 excellent, ≥ 0.7 good, ≥ 0.6 acceptable threshold, < 0.6 poor
function _faceMatchGrade(v) { return v >= 90 ? 'good' : v >= 70 ? 'light-warn' : v >= 60 ? 'warn' : 'bad'; }

const _GRADE_COLOR = { good: 'var(--success)', 'light-warn': 'var(--light-warn)', warn: 'var(--warn)', bad: 'var(--danger)' };
const _GRADE_LOG   = { good: 'success', 'light-warn': 'light-warn', warn: 'warn', bad: 'error' };


/* ─── Accordion helpers ──────────────────────────────────────── */
function openVcamPanel() {
  const body    = document.getElementById('obsPanelBody');
  const chevron = document.getElementById('obsPanelChevron');
  if (!body || body.style.display !== 'none') return;
  body.style.display = '';
  if (chevron) chevron.classList.add('open');
}

/* ─── Agora client state ─────────────────────────────────────── */
let agoraClient    = null;
let localAudioTrack = null;

/* ─── Relay log poller ───────────────────────────────────────── */
function _startRelayLogPoller() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/relay-log');
      if (!res.ok) return;
      const messages = await res.json();
      messages.forEach(({ msg, level }) => log(msg, level || 'warn'));
    } catch {}
  }, 3000);
}
_startRelayLogPoller();

/* ─── Cleanup on tab/browser close ──────────────────────────── */
window.addEventListener('beforeunload', () => {
  if (session?._id) {
    fetch('/api/session/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: session._id }),
      keepalive: true,
    });
  }
});

