"""
config.py
---------
Central configuration loaded from the .env file.
All routes and helpers import constants from here rather than calling
os.getenv() inline, so every setting is easy to find and change in one place.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Directory where uploaded face images are saved and served as static files.
# Created automatically if it does not exist yet.
UPLOAD_DIR = Path("public/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Accepted MIME types and file extensions for source-face image uploads
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}

# Server port — override in .env if 8000 is already in use
PORT = int(os.getenv("PORT", 8000))

# Optional public base URL used when building uploaded-image URLs.
# AKOOL's servers must be able to fetch the source face image, so a localhost
# URL will not work. Set this to your ngrok / tunnel / deployed URL so that
# uploaded images are reachable by AKOOL.
#
# Example:  PUBLIC_BASE_URL=https://abc123.ngrok-free.app
# Leave empty to use the request's own host (works only on public deployments).
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")

# Redis URL for horizontal scaling shared state.
# Falls back to single-node in-memory mode when Redis is unavailable.
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
