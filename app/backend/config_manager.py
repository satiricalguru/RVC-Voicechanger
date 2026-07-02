import os
import json
import threading
from pathlib import Path
from typing import Optional

CONFIG_DIR = Path.home() / ".aivoicechanger"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_CONFIG = {
    "selected_voice": "original",
    "input_device": None,
    "output_device": None,
    "monitor_device": None,
    # Frontend volume levels (stored here so they survive restarts)
    "input_volume": 100,
    "output_volume": 100,
    "monitor_mix": 35,
    "pitch_semitones": 0,
    "reverb_room": 0.1,
    "reverb_damping": 0.5,
    "noise_gate_db": -40,
    "compressor_ratio": 4.0,
    "index_rate": 0.75,
    "protect": 0.33,
    "filter_radius": 3,
    "hear_myself": False,
    "voice_changer_enabled": True,
    "sample_rate": 48000,
    "buffer_size": 512,
    "favorites": [],
    "theme": "dark",
    "accent": "purple",
    "custom_models_dir": "",
    "rvc_f0_method": "fcpe",
    "rvc_mode": "dsp",
    "rvc_chunk_ms": 256,
    "onboarding_completed": False,
    "version": "1.0.0"
}


class ConfigManager:
    def __init__(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self._config = {}
        self._save_timer: Optional[threading.Timer] = None
        self._save_lock = threading.Lock()
        self.load()

    def load(self):
        needs_save = False
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r") as f:
                    saved = json.load(f)
                self._config = {**DEFAULT_CONFIG, **saved}
            except Exception:
                self._config = dict(DEFAULT_CONFIG)
        else:
            self._config = dict(DEFAULT_CONFIG)
        if int(self._config.get("rvc_chunk_ms", 256) or 256) < 256:
            self._config["rvc_chunk_ms"] = 256
            needs_save = True
        if self._config.get("rvc_f0_method") == "harvest":
            self._config["rvc_f0_method"] = "fcpe"
            needs_save = True
        if needs_save:
            self.save()
        return self._config

    def save(self):
        """Write config to disk immediately (used at startup/migrations)."""
        with open(CONFIG_FILE, "w") as f:
            json.dump(self._config, f, indent=2)

    def _schedule_save(self):
        """Debounced save — coalesces rapid changes (e.g. slider drags) into a
        single disk write 500 ms after the last update.  Prevents hammering the
        SSD when the user drags a knob quickly."""
        with self._save_lock:
            if self._save_timer is not None:
                self._save_timer.cancel()
            timer = threading.Timer(0.5, self._flush_save)
            timer.daemon = True
            timer.start()
            self._save_timer = timer

    def _flush_save(self):
        with self._save_lock:
            self._save_timer = None
        self.save()

    def get(self, key, default=None):
        return self._config.get(key, default)

    def set(self, key, value):
        self._config[key] = value
        self._schedule_save()

    def update(self, data: dict):
        self._config.update(data)
        self._schedule_save()

    def all(self):
        return dict(self._config)

    def add_favorite(self, voice_id: str):
        favs = self._config.get("favorites", [])
        if voice_id not in favs:
            favs.append(voice_id)
            self._config["favorites"] = favs
            self.save()

    def remove_favorite(self, voice_id: str):
        favs = self._config.get("favorites", [])
        if voice_id in favs:
            favs.remove(voice_id)
            self._config["favorites"] = favs
            self.save()

    def is_favorite(self, voice_id: str) -> bool:
        return voice_id in self._config.get("favorites", [])
