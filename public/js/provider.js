/**
 * provider.js
 * -----------
 * Provider registry and client config — client-side glue.
 *
 * Owns:
 *   _providerConfig         — active provider config fetched from /api/provider/config
 *   assertProvider()        — generic response code handler using provider error map
 *   _startProviderLogPoller — polls provider-declared log endpoint (if any)
 *   Provider selector UI    — custom styled dropdown in Step 1
 */

/* ─── Active provider config (populated on load and provider switch) ─── */

let _providerConfig = {
  error_codes:      {},
  log_poll_endpoint: null,
  labels: {
    session_starting: 'Creating live session…',
    session_closed:   'Session closed',
    authenticated:    'Authenticated',
    session_active:   'Session active',
  },
};
let _activeProviderId   = null;
let _logPollerInterval  = null;

async function _fetchProviderConfig(id) {
  try {
    const url = id ? `/api/provider/config?provider=${encodeURIComponent(id)}` : '/api/provider/config';
    const res  = await fetch(url);
    if (res.ok) _providerConfig = await res.json();
  } catch {}
}

function _startProviderLogPoller() {
  if (_logPollerInterval) { clearInterval(_logPollerInterval); _logPollerInterval = null; }
  const endpoint = _providerConfig.log_poll_endpoint;
  if (!endpoint) return;
  _logPollerInterval = setInterval(async () => {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) return;
      const messages = await res.json();
      messages.forEach(({ msg, level }) => log(`[Provider] ${msg}`, level || 'info'));
    } catch {}
  }, 3000);
}

/* ─── Generic response code handler ─────────────────────────────── */

function assertProvider(data, fallback = 'Request failed') {
  if (data.code === 1000) return;
  const known = _providerConfig.error_codes?.[data.code];
  throw new Error(known ? `[${data.code}] ${known}` : `[${data.code}] ${data.msg || fallback}`);
}

/* ─── Provider custom dropdown ───────────────────────────────────── */

function toggleProviderDropdown() {
  const dd = document.getElementById('providerDropdown');
  if (dd) dd.classList.toggle('open');
}

function _closeProviderDropdown() {
  const dd = document.getElementById('providerDropdown');
  if (dd) dd.classList.remove('open');
}

document.addEventListener('click', e => {
  const dd = document.getElementById('providerDropdown');
  if (dd && !dd.contains(e.target)) _closeProviderDropdown();
});

(async function initProviderSelector() {
  const selected = document.getElementById('providerSelected');
  const options  = document.getElementById('providerOptions');
  const hint     = document.getElementById('providerHint');
  if (!options) return;

  try {
    const resp      = await fetch('/api/provider/list');
    const providers = await resp.json();

    options.innerHTML = '';
    providers.forEach((p, i) => {
      const btn       = document.createElement('button');
      btn.className   = 'provider-opt' + (i === 0 ? ' active' : '');
      btn.textContent = p.name;
      btn.dataset.id  = p.id;
      btn.onclick     = () => selectProvider(p.id);
      options.appendChild(btn);
    });

    if (providers.length) {
      _activeProviderId = providers[0].id;
      if (selected) selected.textContent = providers[0].name;
      await _fetchProviderConfig(_activeProviderId);
      _startProviderLogPoller();
      _showProviderSettings(_activeProviderId);
      setModelStatus(_activeProviderId, 'ready', 'Server-side');
    }

    if (hint) hint.textContent = providers.length
      ? 'Active provider for all new sessions.'
      : 'No providers registered.';
  } catch (err) {
    if (hint) hint.textContent = 'Could not load providers.';
    if (selected) selected.textContent = 'Error';
    console.warn('[provider] load failed:', err);
  }
})();

async function selectProvider(id) {
  const hint     = document.getElementById('providerHint');
  const selected = document.getElementById('providerSelected');
  _closeProviderDropdown();

  document.querySelectorAll('.provider-opt').forEach(btn => {
    const isActive = btn.dataset.id === id;
    btn.classList.toggle('active', isActive);
    if (isActive && selected) selected.textContent = btn.textContent;
  });

  _activeProviderId = id;
  await _fetchProviderConfig(id);
  _startProviderLogPoller();
  _showProviderSettings(id);

  try {
    await fetch('/api/provider/select', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ provider: id }),
    });
    if (hint) hint.textContent = `Active: ${id}`;
  } catch (err) {
    if (hint) hint.textContent = 'Failed to switch provider.';
    console.warn('[provider] select failed:', err);
  }
}

function _showProviderSettings(id) {
  document.querySelectorAll('.provider-settings').forEach(el => {
    el.classList.toggle('visible', el.dataset.provider === id);
  });
}

/* ─── Init ───────────────────────────────────────────────────────── */
// setModelStatus for the provider is called inside initProviderSelector after config loads
