/* ─── Pipeline diagnostics poller ─────────────────────────────── */

let _pipelineInterval = null;
let _pipelineLast     = null;  // latest poll response (cumulative totals for summary)
let _pipelineStats    = {};    // per-metric first/last/min/max/sum/count across session
let _pollCount        = 0;     // number of successful polls this session (for per-interval averages)
let _agoraSlow        = false; // true while Agora is in a degraded state; gates the slow/recovered log lines

const _LATENCY_KEYS = [
  'ws_upload_ms',
  'agora_frames_ms',
  'stream_out_avg_ms',
  'agora_trans_ms',
  'agora_jitter_ms',
  'agora_decode_ms',
  'agora_e2e_ms',
  'stream_in_ms',
  'stream_in_fps',
  'display_lag_ms',
  'display_fps',
  'freeze_count',
  'max_frame_gap_ms',
  'content_fps',
];

function startPipelinePoller() {
  _pipelineLast  = null;
  _pipelineStats = {};
  _pollCount     = 0;
  _agoraSlow     = false;
  clearInterval(_pipelineInterval);
  _pipelineInterval = setInterval(_pollPipeline, 20000);
}

async function stopPipelinePoller(sid) {
  clearInterval(_pipelineInterval);
  _pipelineInterval = null;
  if (sid) await _logPipelineTotal(sid);
}

async function _logPipelineTotal(sid) {
  try {
    const r = await fetch(`/api/metrics/pipeline?sid=${sid}`);
    if (!r.ok) return;
    const d = await r.json();
    if (!d || !Object.keys(d).length) return;
    const n   = Math.max(_pollCount, 1);
    const avg = (v) => (v / n).toFixed(1);
    const rtt = d.tot_akool_avg_rtt_ms > 0 ? `·${d.tot_akool_avg_rtt_ms}ms rtt` : '';

    if (d.tot_bg_active) {
      log(
        `[Pipeline · TOTAL] ` +
        `Cam avg:${d.tot_cam_fps}fps drop avg:${avg(d.tot_cam_drop)} total:${d.tot_cam_drop} | ` +
        `BG avg:${d.tot_bg_fps}fps·avg:${d.tot_bg_avg_ms}ms drop avg:${avg(d.tot_bg_drop)} total:${d.tot_bg_drop} | ` +
        `AKOOL avg:${d.tot_akool_in_fps}→avg:${d.tot_akool_out_fps}fps${rtt} stale:${d.tot_akool_stale} | ` +
        `Viewer drop avg:${avg(d.tot_viewer_drop)} total:${d.tot_viewer_drop}`,
        'info'
      );
      const tdn    = d.tot_throttle_downs ?? 0;
      const tup    = d.tot_throttle_ups   ?? 0;
      const fpsEnd = d.throttle_fps       ?? 30;
      const fpsAvg = getPipelineStats().throttle_fps?.avg ?? 30;
      log(
        `[BG Throttle · TOTAL] avg:${fpsAvg}fps·avg:${d.tot_bg_avg_ms}ms ended:${fpsEnd}fps·ended:${d.bg_avg_ms}ms | ` +
        `↓ avg:${avg(tdn)} total:${tdn} ` +
        `↑ avg:${avg(tup)} total:${tup}`,
        'info'
      );
    } else {
      log(
        `[Pipeline · TOTAL] ` +
        `Cam avg:${d.tot_cam_fps}fps drop avg:${avg(d.tot_cam_drop)} total:${d.tot_cam_drop} | ` +
        `AKOOL avg:${d.tot_akool_in_fps}→avg:${d.tot_akool_out_fps}fps${rtt} stale:${d.tot_akool_stale} | ` +
        `Viewer drop avg:${avg(d.tot_viewer_drop)} total:${d.tot_viewer_drop}`,
        'info'
      );
    }

    const atdn    = d.tot_akool_throttle_downs ?? 0;
    const atup    = d.tot_akool_throttle_ups   ?? 0;
    const atFpsEnd = d.akool_throttle_fps      ?? 30;
    const atFpsAvg = getPipelineStats().akool_throttle_fps?.avg ?? 30;
    if (atdn > 0 || atup > 0 || atFpsEnd < 30) {
      log(
        `[AKOOL Throttle · TOTAL] avg:${atFpsAvg}fps ended:${atFpsEnd}fps | ` +
        `↓ avg:${avg(atdn)} total:${atdn} ` +
        `↑ avg:${avg(atup)} total:${atup}`,
        'info'
      );
    }

    // Agora + stream metrics from client-side stats tracker
    const ps = getPipelineStats();
    if (ps.agora_e2e_ms) {
      const e2e        = ps.agora_e2e_ms;
      const trans      = ps.agora_trans_ms;
      const transAvail = trans?.avg > 0;
      const hopLine    = transAvail
        ? ` | transit avg:${trans.avg}ms jitter+decode avg:${Math.round(e2e.avg - trans.avg)}ms (${Math.round(e2e.first - trans.first)}ms→${Math.round(e2e.last - trans.last)}ms)`
        : '';
      log(
        `[Pipeline · TOTAL Agora] e2e avg:${e2e.avg}ms (${e2e.first}ms→${e2e.last}ms)${hopLine}`,
        'info'
      );
      if (e2e.avg > 300) {
        const jd = transAvail ? Math.round(e2e.avg - trans.avg) : null;
        const causes = [];
        if (jd !== null && jd > 150) causes.push(`jitter+decode avg:${jd}ms`);
        if (transAvail && trans.avg > 100) causes.push(`network transit avg:${trans.avg}ms`);
        log(`[Agora · TOTAL] High e2e — caused by: ${causes.join(' · ') || 'unknown'}`, 'warn');
      }
    }
    if (ps.stream_out_avg_ms || ps.stream_in_ms) {
      log(
        `[Pipeline · TOTAL Stream] out avg:${ps.stream_out_avg_ms?.avg ?? 0}ms | ` +
        `in avg:${ps.stream_in_ms?.avg ?? 0}ms · ${ps.stream_in_fps?.avg ?? 0}fps`,
        'info'
      );
    }
    if (d.tot_sdk_pub_fps > 0 || d.tot_sdk_drop > 0) {
      log(
        `[Pipeline · TOTAL SDK] python→agora avg:${d.tot_sdk_pub_fps}fps·avg:${d.tot_sdk_avg_push_ms}ms ` +
        `drop total:${d.tot_sdk_drop}`,
        'info'
      );
    }
    if (ps.ws_upload_ms) {
      log(`[Pipeline · TOTAL Upload] browser→server avg:${ps.ws_upload_ms.avg}ms`, 'info');
    }
    if (typeof getClockOffset === 'function') {
      const off    = Math.round(getClockOffset());
      const absOff = Math.abs(off);
      const dir    = off < 0 ? `browser ${-off}ms ahead of server` : `browser ${off}ms behind server`;
      const status = absOff < 50
        ? `in sync (±${absOff}ms)`
        : `out of sync — ${dir} · stream-in adjusted`;
      log(`[Device Clock] ${status}`, absOff >= 200 ? 'warn' : 'info');
    }
    const memPs = getPipelineStats();
    if (memPs.mem_rss_mb) {
      const rssAvg  = memPs.mem_rss_mb?.avg      ?? 0;
      const rssMin  = memPs.mem_rss_mb?.min      ?? 0;
      const rssMax  = memPs.mem_rss_mb?.max      ?? 0;
      const rssLast = memPs.mem_rss_mb?.last     ?? 0;
      const sysAvg  = memPs.mem_sys_used_mb?.avg ?? 0;
      const sysLast = memPs.mem_sys_used_mb?.last ?? 0;
      const pctAvg  = memPs.mem_sys_pct?.avg     ?? 0;
      const pctLast = memPs.mem_sys_pct?.last    ?? 0;
      const total   = d.mem_sys_total_mb         ?? 0;
      log(
        `[Pipeline · TOTAL] Server mem — process avg:${rssAvg}MB min:${rssMin}MB max:${rssMax}MB · ` +
        `system avg:${sysAvg}MB/${total}MB (${pctAvg}%)`,
        'info'
      );
      log(
        `[Pipeline · Current End of Session] Server mem — process:${rssLast}MB · ` +
        `system:${sysLast}MB/${total}MB (${pctLast}%)`,
        'info'
      );
    }
  } catch {}
}

function getPipelineLast() {
  return _pipelineLast;
}

function getPipelineStats() {
  const out = {};
  for (const [key, s] of Object.entries(_pipelineStats)) {
    out[key] = {
      first: s.first,
      last:  s.last,
      min:   s.min,
      max:   s.max,
      avg:   Math.round(s.sum / s.count),
    };
  }
  return out;
}

function _updateStats(key, value) {
  if (!value || value <= 0) return;
  if (!_pipelineStats[key]) {
    _pipelineStats[key] = { first: value, last: value, min: value, max: value, sum: value, count: 1 };
  } else {
    const s = _pipelineStats[key];
    s.last  = value;
    s.min   = Math.min(s.min, value);
    s.max   = Math.max(s.max, value);
    s.sum  += value;
    s.count++;
  }
}

async function _pollPipeline() {
  if (!session?._id) return;
  try {
    const r = await fetch(`/api/metrics/pipeline?sid=${session._id}`);
    if (!r.ok) return;
    const d = await r.json();
    if (!d || !Object.keys(d).length) return;
    _pipelineLast = d;
    _pollCount++;
    for (const key of _LATENCY_KEYS) _updateStats(key, d[key]);
    _updateStats('throttle_fps',       d.throttle_fps       ?? 30);
    _updateStats('akool_throttle_fps', d.akool_throttle_fps ?? 30);
    _updateStats('mem_rss_mb',         d.mem_rss_mb         ?? 0);
    _updateStats('mem_sys_used_mb',    d.mem_sys_used_mb    ?? 0);
    _updateStats('mem_sys_pct',        d.mem_sys_pct        ?? 0);
    _logPipelineSnapshot(d);
  } catch {}
}

function _logPipelineSnapshot(d) {
  const bg  = d.bg_active;
  const rtt = d.akool_avg_rtt_ms > 0 ? `·${d.akool_avg_rtt_ms}ms rtt` : '';
  let line;
  if (bg) {
    line =
      `[20s] Pipeline — ` +
      `Cam:${d.cam_fps}fps drop:${d.cam_drop} | ` +
      `BG:${d.bg_fps}fps·${d.bg_avg_ms}ms drop:${d.bg_drop} | ` +
      `AKOOL:${d.akool_in_fps}→${d.akool_out_fps}fps${rtt} stale:${d.akool_stale} | ` +
      `Viewer drop:${d.viewer_drop}`;
  } else {
    line =
      `[20s] Pipeline — ` +
      `Cam:${d.cam_fps}fps drop:${d.cam_drop} | ` +
      `AKOOL:${d.akool_in_fps}→${d.akool_out_fps}fps${rtt} stale:${d.akool_stale} | ` +
      `Viewer drop:${d.viewer_drop}`;
  }
  log(line, 'info');

  if (d.ws_upload_ms > 0)
    log(`[20s] Upload    — browser→server:${d.ws_upload_ms}ms`, 'info');
  if (d.stream_out_avg_ms > 0)
    log(`[20s] Stream-out — chrome→server:${d.stream_out_avg_ms}ms`, 'info');
  if (d.agora_e2e_ms > 0) {
    const transAvail = d.agora_trans_ms > 0;
    const hopLine = transAvail
      ? `transit:${d.agora_trans_ms}ms jitter+decode:${d.agora_e2e_ms - d.agora_trans_ms}ms | `
      : '';
    log(`[20s] Agora out — fps:${d.agora_fps} | ${hopLine}e2e:${d.agora_e2e_ms}ms`, 'info');
    if (d.agora_e2e_ms > 300) {
      const jd = transAvail ? d.agora_e2e_ms - d.agora_trans_ms : null;
      const causes = [];
      if (jd !== null && jd > 150) causes.push(`jitter+decode:${jd}ms`);
      if (d.agora_trans_ms > 100)  causes.push(`network transit:${d.agora_trans_ms}ms`);
      if (d.agora_fps > 0 && d.agora_fps < 20) causes.push(`low delivery:${d.agora_fps}fps`);
      if (causes.length && !_agoraSlow) {
        _agoraSlow = true;
        log(`[Agora] Slow — ${causes.join(' · ')}`, 'warn');
      }
    } else if (_agoraSlow) {
      _agoraSlow = false;
      log(`[Agora] Recovered — e2e back to ${d.agora_e2e_ms}ms`, 'info');
    }
  }
  if (d.sdk_pub_fps > 0 || d.sdk_drop > 0)
    log(`[20s] SDK pub   — python→agora:${d.sdk_pub_fps}fps·${d.sdk_avg_push_ms}ms drop:${d.sdk_drop}`, 'info');
  if (d.stream_in_ms > 0 || d.stream_in_fps > 0)
    log(`[20s] Stream-in  — server→browser:${d.stream_in_ms}ms · ${d.stream_in_fps}fps`, 'info');
  if (d.display_lag_ms > 0 || d.display_fps > 0 || d.content_fps > 0) {
    const cSuffix = d.content_fps > 0 ? ` · content:${d.content_fps}fps` : '';
    log(`[20s] Display    — browser render:${d.display_lag_ms}ms · display:${d.display_fps}fps${cSuffix}`, 'info');
  }
  if (d.freeze_count > 0 || d.max_frame_gap_ms > 0)
    log(`[20s] Freezes    — count:${d.freeze_count} worst_gap:${d.max_frame_gap_ms}ms`, 'warn');
  if (d.cam_repeat > 0 || d.akool_out_repeat > 0)
    log(`[20s] Repeats    — [A] cam→AKOOL:${d.cam_repeat} [B] AKOOL→relay:${d.akool_out_repeat}`, 'warn');
  if (d.mem_rss_mb > 0)
    log(`[20s] Server mem — process:${d.mem_rss_mb}MB · system:${d.mem_sys_used_mb}MB/${d.mem_sys_total_mb}MB (${d.mem_sys_pct}%)`, 'info');
}
