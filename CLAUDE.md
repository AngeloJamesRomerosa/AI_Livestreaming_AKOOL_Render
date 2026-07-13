# AI Livestreaming Render — Project Guide

Render-deployable fork of `AKOOL_AI_LiveStreaming` (the production GCP project). All heavy server-side processing (headless Chrome, BG removal, Agora publisher) has been moved to the browser. The server is a thin relay + AKOOL session manager that fits in Render's free tier (512MB RAM).

---

## Frame Flow

```
Camera
  └─► Browser Agora Web SDK ──► AKOOL cloud (faceswap)
                                      └─► Agora channel ──► Browser receives output
                                                                  │
                                              MediaPipe BG composite (canvas)
                                                                  │
                                              obs.js Web Worker timer
                                                                  │
                                              POST binary JPEG ──► /ws/stream-out (server)
                                                                  │
                                              Fan out to viewer queues
                                                                  │
                               /ws/stream-in ◄── OBS Browser Source
                               /stream.mjpeg ◄── OBS Media Source / pop-out
```

---

## Server vs Browser split

### Server handles (FastAPI / Python)
| What | Where |
|---|---|
| AKOOL session create/update/close | `routes/session.py` → `providers/akool/provider.py` |
| Auth (API key / token exchange) | `routes/auth.py` → `providers/akool/auth_state.py` |
| Face image upload + resize | `routes/faces.py` (uses Pillow) |
| Face detection (AKOOL API call) | `providers/akool/faces.py` → `/api/detectFaces` |
| Receive frames from obs.js | `providers/akool/routes_stream.py` → `/ws/stream-out` |
| Relay frames to viewers | `routes/stream.py` → `/ws/stream-in` |
| MJPEG stream for OBS | `routes/stream_mjpeg.py` → `/stream.mjpeg` |
| RTMP via ffmpeg | `routes/rtmp.py` + `routes/rtmp_ffmpeg.py` |
| Stream metrics (latency logging) | `routes/stream_metrics.py` |
| Credit balance, stream profiles | `providers/akool/routes_meta.py` |

### Browser handles (JS in `public/js/`)
| What | File |
|---|---|
| Agora channel join + camera publish | `session.js` |
| Receive AKOOL faceswapped video | `session.js` (`user-published` handler) |
| MediaPipe SelfieSegmentation BG removal | `bg-engine.js` |
| BG preset UI (blur, color, image, etc.) | `bg-ui.js` + `bg-toggles.js` + `bg-presets.js` |
| OBS relay — canvas → `/ws/stream-out` | `obs.js` |
| Pipeline metrics display (20s polls) | `pipeline-poller.js` |
| Face Lock / Face Match AI | `faceai.js` + `face-metrics-poller.js` |
| RTMP audio capture | `rtmp-audio.js` |
| Quality / resolution selector | `quality-selector.js` |

---

## Key Python files

```
app.py                          — FastAPI app, middleware, router registration
config.py                       — All env vars (PORT, UPLOAD_DIR, PUBLIC_BASE_URL, REDIS_URL)
redis_client.py                 — Redis connection with in-memory fallback

routes/
  auth.py                       — POST /api/auth/apikey, POST /api/getToken
  faces.py                      — POST /api/uploadImage
  session.py                    — POST /api/session/create, /close; GET /api/session/viewer-url
  stream.py                     — WS /ws/stream-in (viewer receives frames)
  stream_mjpeg.py               — GET /stream.mjpeg (OBS Media Source)
  stream_metrics.py             — POST /api/metrics/latency, GET /api/relay-log, GET /api/time-sync
  state.py                      — In-process session state (sid ↔ secret key)
  rtmp.py                       — POST /api/rtmp/start, /stop, /status; WS /ws/audio-out
  rtmp_ffmpeg.py                — ffmpeg process management
  schemas.py                    — All Pydantic response models

providers/akool/
  provider.py                   — AkoolProvider: authenticate, create/update/close session
  session_helpers.py            — _poll_until_ready() (polls AKOOL until status=2)
  auth_state.py                 — Stores API key / bearer token in memory
  client.py                     — AKOOL_BASE URL, parse_akool_response, require_fields
  faces.py                      — detect_faces() AKOOL API call
  routes.py                     — Assembles routes_stream + routes_meta into one router
  routes_stream.py              — WS /ws/stream-out (receives JPEG frames from obs.js, fans to viewers)
  routes_meta.py                — GET /api/agora-log (stub), /api/stream-profiles, /api/detectFaces, /api/credit
  stream_profiles.py            — Resolution/fps/bitrate quality table
  routes_utils.py               — _is_localhost() helper
```

---

## DELETED — do not import these

These files existed in the production project but were removed here. Any import of them will cause a startup crash:

```
routes/pipeline_stats.py        — server-side throttle state (no throttling in Render version)
routes/pipeline_metrics.py      — GET /api/metrics/pipeline (no server-side pipeline)
routes/background.py            — server-side BG routes
routes/camera_input.py          — server-side camera WebSocket input
routes/bg_processor.py          — frame-by-frame BG compositing
routes/bg_session.py            — per-session BG state
routes/bg_*.py                  — all other BG pipeline modules
routes/face_metrics.py          — server-side face lock metrics
providers/akool/agora_publisher.py  — headless Chrome Agora publisher
providers/akool/routes_frames.py    — per-frame AKOOL throttle gate
internal/                           — agora_publisher.html (deleted)
```

---

## Conventions

**JS cache busting:** Every `<script>` and `<link>` in `public/index.html` uses `?v=N`. Increment N for that file whenever you edit it. All versions start at 1 in this project (reset on fork).

**No server-side adaptive throttles:** The production project has 3 adaptive throttles (BG fps, AKOOL RTT, Agora jitter+decode). None of these exist here — throttling is irrelevant without a server-side publisher.

**Redis is optional:** `redis_client.py` falls back to in-memory if Redis is unavailable. Render free tier can run without Redis; add a Redis add-on if you need multi-instance session sharing.

---

## Deployment (Render)

- **Runtime:** Docker (see `Dockerfile`)
- **Plan:** Free tier (512MB RAM — works because no Playwright)
- **Config:** `render.yaml` at project root
- **Required env vars on Render:**
  - `AKOOL_API_KEY` or `AKOOL_CLIENT_ID` + `AKOOL_CLIENT_SECRET`
  - `PUBLIC_BASE_URL` — set to your Render service URL (e.g. `https://your-app.onrender.com`) so AKOOL can fetch uploaded face images
- **Optional:** `REDIS_URL` if you add a Redis instance

**Local dev:**
```
pip install -r requirements.txt
python app.py
```

**Docker local:**
```
docker compose up --build
```

---

## Production project

The GCP production version is a separate local project. It has server-side Agora (headless Chrome), server-side BG removal (MediaPipe + OpenCV), and 3 adaptive throttles. Changes made there are NOT automatically reflected here.
