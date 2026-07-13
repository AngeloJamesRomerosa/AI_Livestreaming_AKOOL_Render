"""
routes/schemas.py
-----------------
Pydantic response models for all API endpoints.

════════════════════════════════════════════════════════════════════════════════
SECTION 1 — PRIMARY ENDPOINTS
Endpoints the dashboard developer calls to build features.
════════════════════════════════════════════════════════════════════════════════
  OkResponse, OkErrorResponse
  TokenResponse, AuthStatusResponse
  SessionData, SessionCreateResponse, ViewerUrlResponse, AkoolApiResponse
  UploadImageResponse, DetectFacesResponse
  BgPreset, BgPresetsResponse, BgToggles, BgStatusResponse,
  BgPresetSetResponse, BgModeResponse, BgToggleResponse,
  BgFpsResponse, BgOutlineResponse
  FpsOption, StreamProfile, CreditResponse
  ProviderInfo, ProviderSelectResponse

════════════════════════════════════════════════════════════════════════════════
SECTION 2 — SECONDARY ENDPOINTS (metrics, debug, internal)
Not needed for day-to-day dashboard use.
════════════════════════════════════════════════════════════════════════════════
  StreamMetricsResponse, TimeSyncResponse
  FaceMetricsResponse, GpuStatusResponse, BgBenchmarkDetail,
  BgBenchmarkPair, GpuToggleResponse, FaceDetectorStatusResponse,
  BgStatusInternalResponse
  PipelineMetricsResponse
  RelayLogEntry, AgoraLogEntry
  RtmpStatusResponse, RtmpStartResponse
  ProviderLabels, ProviderConfigResponse
"""
from __future__ import annotations
from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — PRIMARY ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

# ── Shared ────────────────────────────────────────────────────────────────────

class OkResponse(BaseModel):
    ok: bool


class OkErrorResponse(BaseModel):
    ok: bool
    error: str | None = None


# ── Authentication ─────────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    ok: bool
    expire: int | None = None


class AuthStatusResponse(BaseModel):
    hasApiKey: bool
    hasClientId: bool
    hasClientSecret: bool


# ── Session ────────────────────────────────────────────────────────────────────

class SessionData(BaseModel):
    id: str = Field(alias="_id")
    status: int
    stream_path: str
    app_id: str | None = None
    channel_id: str | None = None
    front_user_id: str | None = None
    front_rtc_token: str | None = None

    model_config = {"populate_by_name": True}


class SessionCreateResponse(BaseModel):
    code: int
    data: SessionData


class ViewerUrlResponse(BaseModel):
    viewer_url: str
    mjpeg_url: str


class AkoolApiResponse(BaseModel):
    """Generic AKOOL API passthrough response — returned by session/close and similar calls."""
    code: int
    msg: str
    data: dict | None = None


# ── Faces ───────────────────────────────────────────────────────────────────────

class UploadImageResponse(BaseModel):
    url: str
    filename: str
    reachable_by_provider: bool


class DetectFacesResponse(BaseModel):
    opts: str
    face_url: str


# ── Background ─────────────────────────────────────────────────────────────────

class BgPreset(BaseModel):
    id: str
    label: str
    image_path: str | None = None
    image_url: str | None = None


class BgPresetsResponse(BaseModel):
    presets: list[BgPreset]


class BgToggles(BaseModel):
    pose: bool
    hand: bool
    face: bool
    outline: bool
    gpu: bool
    face_lock: bool


class BgStatusResponse(BaseModel):
    preset: str
    available: bool
    hasImage: bool
    bg_mode: str
    toggles: BgToggles


class BgPresetSetResponse(BaseModel):
    ok: bool
    preset: str


class BgModeResponse(BaseModel):
    ok: bool
    mode: str


class BgToggleResponse(BaseModel):
    ok: bool
    feature: str
    enabled: bool


class BgFpsResponse(BaseModel):
    ok: bool
    fps: int


class BgOutlineResponse(BaseModel):
    ok: bool
    enabled: bool
    strength: float


# ── Streaming / Profiles ────────────────────────────────────────────────────────

class FpsOption(BaseModel):
    auto: int
    low: int
    standard: int
    high: int


class StreamProfile(BaseModel):
    label: str
    width: int
    height: int
    hd: bool
    faceswap_quality: int
    fps_options: dict[str, FpsOption]


class CreditResponse(BaseModel):
    credit: float


# ── Provider ────────────────────────────────────────────────────────────────────

class ProviderInfo(BaseModel):
    id: str
    name: str


class ProviderSelectResponse(BaseModel):
    ok: bool
    provider: str


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — SECONDARY ENDPOINTS (metrics, debug, internal)
# ══════════════════════════════════════════════════════════════════════════════

# ── Stream metrics ─────────────────────────────────────────────────────────────

class StreamMetricsResponse(BaseModel):
    fps: int
    latency: int


class TimeSyncResponse(BaseModel):
    t2: float
    t3: float


# ── Face / BG debug ────────────────────────────────────────────────────────────

class FaceMetricsResponse(BaseModel):
    face_lock: int
    face_match: int
    source_face_ready: bool
    runs: int = Field(alias="_runs")
    hits: int = Field(alias="_hits")
    match_runs: int = Field(alias="_match_runs")
    match_hits: int = Field(alias="_match_hits")

    model_config = {"populate_by_name": True}


class GpuStatusResponse(BaseModel):
    available: bool


class BgBenchmarkDetail(BaseModel):
    available: bool
    mode: str | None = None
    runs: list[float] | None = None
    avg: float | None = None


class BgBenchmarkPair(BaseModel):
    before: BgBenchmarkDetail
    after: BgBenchmarkDetail


class GpuToggleResponse(BaseModel):
    ok: bool
    enabled: bool
    available: bool
    benchmark: BgBenchmarkPair


class FaceDetectorStatusResponse(BaseModel):
    mp_available: bool
    model_exists: bool
    detector_ready: bool


class BgStatusInternalResponse(BaseModel):
    """Full bg/status response including internal diagnostic counters (excluded from BgStatusResponse)."""
    preset: str
    available: bool
    hasImage: bool
    bg_mode: str
    toggles: BgToggles
    bg_apply_count: int = Field(alias="_bg_apply_count")
    bg_mask_avg: float = Field(alias="_bg_mask_avg")

    model_config = {"populate_by_name": True}


# ── Pipeline metrics ────────────────────────────────────────────────────────────

class PipelineMetricsResponse(BaseModel):
    # Interval snapshot
    cam_fps: float
    cam_drop: int
    bg_fps: float
    bg_avg_ms: float
    bg_drop: int
    bg_active: bool
    akool_in_fps: float
    akool_out_fps: float
    akool_stale: int
    akool_avg_rtt_ms: float
    viewer_drop: int
    stream_out_avg_ms: float
    throttle_fps: int
    throttle_dir: str
    throttle_downs: int
    throttle_ups: int
    tot_throttle_downs: int
    tot_throttle_ups: int
    akool_throttle_fps: int
    akool_throttle_dir: str
    akool_throttle_downs: int
    akool_throttle_ups: int
    tot_akool_throttle_downs: int
    tot_akool_throttle_ups: int
    agora_jitter_throttle_fps: int
    agora_jitter_throttle_dir: str
    agora_jitter_throttle_downs: int
    agora_jitter_throttle_ups: int
    tot_agora_jitter_throttle_downs: int
    tot_agora_jitter_throttle_ups: int
    interval_sec: float
    # Cumulative totals
    tot_cam_fps: float
    tot_cam_drop: int
    tot_bg_fps: float
    tot_bg_avg_ms: float
    tot_bg_drop: int
    tot_bg_active: bool
    tot_akool_in_fps: float
    tot_akool_out_fps: float
    tot_akool_stale: int
    tot_akool_avg_rtt_ms: float
    tot_viewer_drop: int
    tot_stream_out_avg_ms: float
    # SDK publish metrics (populated when AGORA_NATIVE=2)
    sdk_pub_fps: float
    sdk_drop: int
    sdk_avg_push_ms: float
    tot_sdk_pub_fps: float
    tot_sdk_drop: int
    tot_sdk_avg_push_ms: float
    # Repeat-frame counts
    cam_repeat: int
    akool_out_repeat: int
    tot_cam_repeat: int
    tot_akool_out_repeat: int
    # Server memory
    mem_rss_mb: int
    mem_sys_used_mb: int
    mem_sys_total_mb: int
    mem_sys_pct: float
    # Client-side stream metrics (appended in pipeline_metrics.py)
    agora_fps: int
    agora_e2e_ms: int
    agora_trans_ms: int
    agora_jitter_ms: int
    agora_decode_ms: int
    agora_frames_ms: int
    stream_in_ms: int
    stream_in_fps: int
    ws_upload_ms: int
    display_lag_ms: int
    display_fps: int
    freeze_count: int
    max_frame_gap_ms: int
    content_fps: int


# ── Logging ─────────────────────────────────────────────────────────────────────

class RelayLogEntry(BaseModel):
    msg: str
    level: str


class AgoraLogEntry(BaseModel):
    msg: str
    level: str
    sid: str | None = None


# ── RTMP ───────────────────────────────────────────────────────────────────────

class RtmpStatusResponse(BaseModel):
    running: bool
    error: str


class RtmpStartResponse(BaseModel):
    ok: bool
    error: str | None = None


# ── Provider config ─────────────────────────────────────────────────────────────

class ProviderLabels(BaseModel):
    session_starting: str
    session_closed: str
    authenticated: str


class ProviderConfigResponse(BaseModel):
    error_codes: dict[str, str]
    log_poll_endpoint: str
    labels: ProviderLabels
