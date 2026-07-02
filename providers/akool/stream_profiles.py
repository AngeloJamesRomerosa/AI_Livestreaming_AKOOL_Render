"""
providers/akool/stream_profiles.py
-----------------------------------
Agora RTC video profile configuration — resolutions, supported frame rates,
and bitrate tiers (Auto / Low / Standard / High) for the live-broadcast
channel profile.

Reference:
  https://docs.agora.io/en/cloud-recording/develop/recording-video-profile
"""

# (base_kbps, live_kbps) per resolution and frame rate
_PROFILES: dict[str, dict[int, tuple[int, int]]] = {
    '1920x1080': {
        15: (2365, 4730),
        25: (2875, 5825),
        30: (3150, 6300),
        60: (4780, 6500),
    },
    '1280x720': {
        15: (1130, 2260),
        25: (1527, 3053),
        30: (1710, 3420),
    },
    '848x480': {
        15: ( 500, 1000),
        25: ( 667, 1333),
        30: ( 750, 1500),
    },
    '640x360': {
        15: ( 400,  800),
        25: ( 533, 1067),
        30: ( 600, 1200),
    },
    '424x240': {
        15: ( 200,  400),
        25: ( 267,  533),
    },
    '256x144': {
        15: ( 100,  200),
    },
}

_RESOLUTIONS: dict[str, dict] = {
    'auto':  {'label': 'Auto',  'width': 640,  'height': 360,  'faceswap_quality': 2, 'hd': False, 'profile_key': '640x360'},
    '1080p': {'label': '1080p', 'width': 1920, 'height': 1080, 'faceswap_quality': 3, 'hd': True,  'profile_key': '1920x1080'},
    '720p':  {'label': '720p',  'width': 1280, 'height': 720,  'faceswap_quality': 3, 'hd': True,  'profile_key': '1280x720'},
    '480p':  {'label': '480p',  'width': 848,  'height': 480,  'faceswap_quality': 2, 'hd': False, 'profile_key': '848x480'},
    '360p':  {'label': '360p',  'width': 640,  'height': 360,  'faceswap_quality': 1, 'hd': False, 'profile_key': '640x360'},
    '240p':  {'label': '240p',  'width': 424,  'height': 240,  'faceswap_quality': 1, 'hd': False, 'profile_key': '424x240'},
    '144p':  {'label': '144p',  'width': 256,  'height': 144,  'faceswap_quality': 1, 'hd': False, 'profile_key': '256x144'},
}


def get_profiles() -> dict:
    """Build the full resolution + fps + bitrate table for the stream quality UI."""
    result = {}
    for res_key, res in _RESOLUTIONS.items():
        fps_options = {}
        for fps, (base, live) in _PROFILES.get(res['profile_key'], {}).items():
            high = min(6500, round(live * 1.2))
            fps_options[fps] = {
                'auto':     0,
                'low':      base,
                'standard': live,
                'high':     high,
            }
        result[res_key] = {
            'label':            res['label'],
            'width':            res['width'],
            'height':           res['height'],
            'hd':               res['hd'],
            'faceswap_quality': res['faceswap_quality'],
            'fps_options':      fps_options,
        }
    return result
