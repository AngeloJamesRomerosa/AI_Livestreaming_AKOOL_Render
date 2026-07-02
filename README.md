# AKOOL Livestream Faceswap

Real-time AI face swap during a live stream using the [AKOOL Live Faceswap API](https://docs.akool.com/ai-tools-suite/live-faceswap). Deployable on Render's free tier — all heavy processing runs in the browser, the server is a thin relay + AKOOL session manager.

---

## How It Works

```
Your Camera
    │
    ▼  Agora Web SDK (browser)
AKOOL cloud ── faceswap processing
    │
    ▼  Agora channel → browser receives output
MediaPipe SelfieSegmentation (browser canvas)
    │
    ▼  obs.js Web Worker timer
POST binary JPEG ──► /ws/stream-out (server relay)
    │
    ├── /ws/stream-in   ◄── OBS Browser Source
    └── /stream.mjpeg   ◄── OBS Media Source / Pop Out Window
```

The browser handles all heavy lifting: Agora camera publish, faceswap receive, MediaPipe background removal, and OBS frame relay. The server only manages AKOOL sessions and relays JPEG frames to OBS viewers.

---

## Setup

**Local dev:**
```bash
pip install -r requirements.txt
python app.py
# Open http://localhost:8000
```

**Docker local:**
```bash
docker compose up --build
```

**Required environment variables:**

| Variable | Description |
|---|---|
| `AKOOL_API_KEY` | Your AKOOL API key |
| `AKOOL_CLIENT_ID` | AKOOL Client ID (alternative to API key) |
| `AKOOL_CLIENT_SECRET` | AKOOL Client Secret (used with Client ID) |
| `PUBLIC_BASE_URL` | Public URL of your deployment (e.g. `https://your-app.onrender.com`) — required so AKOOL can fetch uploaded face images |

Set either `AKOOL_API_KEY` **or** `AKOOL_CLIENT_ID` + `AKOOL_CLIENT_SECRET`.

---

## Deploying to Render

1. Fork this repo and create a **Web Service** on [Render](https://render.com) pointing to it.
2. Set **Runtime** to Docker.
3. Add the environment variables above under **Environment**.
4. Deploy — the free tier (512 MB RAM) works because there is no server-side Playwright or MediaPipe.

---

## Usage

Follow the four steps in the UI:

**Step 1 — AI Model**
Select the active provider (AKOOL / Agora).

**Step 2 — Authenticate**
Enter your API key or Client ID + Secret, click **Authenticate**.

**Step 3 — Source Face Image**
Paste a public image URL and click **Detect Faces**, or click **Upload** to use a local file.
> Tips: front-facing, well-lit, no sunglasses · JPG/PNG · min 300×300 px

**Step 4 — Start / Stop**
Select stream quality, optionally pick a background, click **Start Faceswap**.
The **Virtual Camera Output** panel appears — choose your OBS output method.
Click **Stop Session** when done.

---

## Background Removal

Select a preset before or during a session. Background removal runs entirely in the browser via MediaPipe SelfieSegmentation (WebAssembly — no server GPU needed).

| Preset | Effect |
|--------|--------|
| None | Off |
| Blur | Gaussian blur (Zoom-style) |
| Black | Solid black |
| Classroom | Virtual classroom background |
| Gym | Virtual gym background |
| White Room | Virtual white room background |
| Pink Wall | Virtual pink wall background |
| Beach | Virtual beach background |
| + Image | Upload your own background |

**Two modes:**
- **Output** — BG applied to the faceswapped output seen by OBS
- **Input** — BG applied to your camera feed before it enters AKOOL

**Preview Camera (BG Test)** — opens your camera and applies the selected background preset in real time before starting a session. No AKOOL credits used.

---

## OBS Output

### Browser Source
1. Start a faceswap session — the **Virtual Camera Output** panel appears.
2. Copy the viewer URL.
3. OBS → Sources → **+** → **Browser Source** → paste URL → set resolution → OK.

### Pop Out Window
1. Click **Open Pop Out Window** — a borderless popup appears.
2. OBS → Sources → **+** → **Window Capture** → select the popup → OK.

### MJPEG Media Source
Use the MJPEG URL directly as an OBS **Media Source** for lowest latency.

### Go Live (RTMP)
Streams directly to YouTube Live, Twitch, etc. via server-side ffmpeg.

---

## Stream Quality

Configure resolution, frame rate, and bitrate in the **Stream Quality** accordion before starting a session. Applied to the Agora camera track at session start.

| Resolution | Dimensions |
|------------|-----------|
| Auto | 640×360 |
| 1080p | 1920×1080 |
| 720p | 1280×720 |
| 480p | 848×480 |
| 360p | 640×360 |
| 240p | 424×240 |
| 144p | 256×144 |

Frame rates: **15 / 25 / 30 fps**. Bitrate tiers: **Auto / Low / Standard / High**.

---

## Troubleshooting

**Camera not showing** — camera access requires HTTPS or `localhost`.

**OBS Browser Source black screen** — confirm faceswap is active and the URL contains `?key=…`. Right-click → **Refresh** in OBS if needed.

**Uploaded image not reaching AKOOL** — ensure `PUBLIC_BASE_URL` is set to your deployment's public URL. `localhost` is unreachable by AKOOL's servers.

**Session code 1101** — token expired, click **Authenticate** again.

**Session code 1104** — quota exceeded, check your AKOOL plan.

**Background always black** — select a preset after clicking the **Background Removal** accordion to expand it. The model loads automatically on first use.

---

## References

- [AKOOL Live Faceswap API](https://docs.akool.com/ai-tools-suite/live-faceswap)
- [OBS Studio](https://obsproject.com/)
- [MediaPipe SelfieSegmentation](https://ai.google.dev/edge/mediapipe/solutions/guide)
- [Agora Web SDK](https://docs.agora.io/en/video-calling/get-started/get-started-sdk)
- [FastAPI](https://fastapi.tiangolo.com/)
