"""
engine.py — low-latency audio engine with DSP and chunked AI voice conversion.
"""

import logging
import queue
import threading
import time
from typing import Callable, Optional

import numpy as np
import sounddevice as sd
from pedalboard import Compressor, HighpassFilter, NoiseGate, Pedalboard, PitchShift, Reverb

logger = logging.getLogger("engine")


class AudioEngine:
    def __init__(self, rvc_pipeline=None):
        self.sample_rate = 44100
        self.buffer_size = 1024
        self.channels = 1
        self.input_device_idx: Optional[int] = None
        self.output_device_idx: Optional[int] = None
        self.is_running = False
        self.hear_myself = False
        self.voice_changer_enabled = True
        self.rvc_enabled = False
        self.rvc_mode = "dsp"
        self.rvc = rvc_pipeline
        self.selected_voice_id = "original"
        self.loading_voice_id: Optional[str] = None
        self.loaded_voice_id: Optional[str] = "original"
        self.voice_load_error: Optional[str] = None
        self._voice_generation = 0

        # Volume controls (0-150 % range stored as floats; divide by 100 before use)
        self.input_volume: float = 1.0    # applied to mic input
        self.output_volume: float = 1.0   # applied to main output
        self.monitor_mix: float = 0.35    # level for monitor (headphone) stream

        # Dedicated monitor device for "Hear Myself" (headphones output)
        self.monitor_device_idx: Optional[int] = None
        self._monitor_stream: Optional[sd.OutputStream] = None
        self._monitor_lock = threading.Lock()
        self._monitor_queue: queue.Queue = queue.Queue(maxsize=4)
        self._monitor_thread: Optional[threading.Thread] = None

        self._pitch_node = PitchShift(semitones=0)
        self._reverb_node = Reverb(room_size=0.1, damping=0.5, wet_level=0.15)
        self._noise_gate = NoiseGate(threshold_db=-40, ratio=10)
        self._compressor = Compressor(threshold_db=-20, ratio=4.0)
        self._highpass = HighpassFilter(cutoff_frequency_hz=80)
        self.board = Pedalboard([
            self._highpass,
            self._noise_gate,
            self._compressor,
            self._pitch_node,
            self._reverb_node,
        ])
        # _cleanup_board runs on EVERY audio callback in AI mode (~90×/sec).
        # It MUST use its own dedicated plugin instances — NOT the same objects
        # as self.board.  Pedalboard plugins hold internal IIR filter state in
        # C++.  Sharing an instance between two Pedalboard chains means calling
        # _cleanup_board() mutates the filter state that self.board() later reads,
        # causing the highpass to resonate and produce a growing buzz artefact.
        self._cleanup_highpass   = HighpassFilter(cutoff_frequency_hz=80)
        self._cleanup_noise_gate = NoiseGate(threshold_db=-40, ratio=10)
        self._cleanup_board = Pedalboard([self._cleanup_highpass, self._cleanup_noise_gate])

        self._stream: Optional[sd.Stream] = None
        self._stream_lock = threading.Lock()
        self._rvc_thread: Optional[threading.Thread] = None
        self._rvc_input_q: queue.Queue = queue.Queue(maxsize=8)
        self._rvc_output_q: queue.Queue = queue.Queue(maxsize=8)
        self._ai_input_buffer = np.zeros(0, dtype=np.float32)
        self._ai_output_buffer = np.zeros(0, dtype=np.float32)
        self._last_ai_frame = np.zeros(self.buffer_size, dtype=np.float32)
        self._last_output_frame = np.zeros(self.buffer_size, dtype=np.float32)
        self._chunk_samples = self._chunk_size_for_rate(self.sample_rate)
        self._crossfade_samples = max(1, int(self.sample_rate * 0.02))
        self._vad_silence_count: int = 0   # consecutive sub-threshold chunk counter
        self._last_callback_time = None
        self._latency_ms = 0.0
        self._last_rvc_latency_ms = 0.0
        self._drops = 0
        self.vu_in = 0.0
        self.vu_out = 0.0
        self.on_meter_update: Optional[Callable] = None

    def _chunk_size_for_rate(self, rate: int) -> int:
        chunk_ms = getattr(self.rvc, "chunk_ms", 256) if self.rvc else 256
        return max(self.buffer_size, int(rate * chunk_ms / 1000))

    def _reset_ai_buffers(self):
        self._chunk_samples = self._chunk_size_for_rate(self.sample_rate)
        self._crossfade_samples = max(1, int(self.sample_rate * 0.035))
        self._ai_input_buffer = np.zeros(0, dtype=np.float32)
        self._ai_output_buffer = np.zeros(0, dtype=np.float32)
        self._last_ai_frame = np.zeros(self.buffer_size, dtype=np.float32)
        self._last_output_frame = np.zeros(self.buffer_size, dtype=np.float32)
        self._vad_silence_count = 0
        # Also flush the RVC pipeline's tail cache — prevents stale 750 Hz
        # synthesizer artifacts from the previous session bleeding into the next.
        if self.rvc and hasattr(self.rvc, "clear_tail"):
            self.rvc.clear_tail()
        while not self._rvc_input_q.empty():
            try:
                self._rvc_input_q.get_nowait()
            except queue.Empty:
                break
        while not self._rvc_output_q.empty():
            try:
                self._rvc_output_q.get_nowait()
            except queue.Empty:
                break

    def _query_device(self, index: Optional[int], direction: str) -> Optional[dict]:
        try:
            device_index = index
            if device_index is None:
                default = sd.default.device
                device_index = default[0] if direction == "input" else default[1]
            if device_index is None or device_index < 0:
                return None
            return sd.query_devices(device_index)
        except Exception:
            return None

    def _is_bluetooth_device(self, device_info: Optional[dict]) -> bool:
        if not device_info:
            return False
        label = str(device_info.get("name", "")).lower()
        return any(token in label for token in ("airpods", "bluetooth", "buds", "headset"))

    def _candidate_sample_rates(self, requested_rate: int, input_info: Optional[dict], output_info: Optional[dict]) -> list[int]:
        candidates: list[int] = []
        for value in [requested_rate, input_info and input_info.get("default_samplerate"), output_info and output_info.get("default_samplerate"), 48000, 44100, 32000, 24000, 22050, 16000]:
            try:
                rate = int(round(float(value)))
            except Exception:
                continue
            if rate > 0 and rate not in candidates:
                candidates.append(rate)
        return candidates

    def _stream_settings_supported(self, samplerate: int, input_device: Optional[int], output_device: Optional[int]) -> bool:
        try:
            sd.check_input_settings(device=input_device, channels=self.channels, dtype=np.float32, samplerate=samplerate)
            sd.check_output_settings(device=output_device, channels=self.channels, dtype=np.float32, samplerate=samplerate)
            return True
        except Exception:
            return False

    def _resolve_stream_config(self) -> tuple[int, int, str]:
        input_info = self._query_device(self.input_device_idx, "input")
        output_info = self._query_device(self.output_device_idx, "output")
        bluetooth = self._is_bluetooth_device(input_info) or self._is_bluetooth_device(output_info)
        resolved_buffer = max(self.buffer_size, 2048 if bluetooth else 512)
        latency = "high" if bluetooth else "low"
        for candidate in self._candidate_sample_rates(self.sample_rate, input_info, output_info):
            if self._stream_settings_supported(candidate, self.input_device_idx, self.output_device_idx):
                return candidate, resolved_buffer, latency
        fallback = int(round((output_info or input_info or {}).get("default_samplerate", self.sample_rate)))
        return fallback, resolved_buffer, "high" if bluetooth else "low"

    def get_devices(self):
        devices = []
        try:
            for index, device in enumerate(sd.query_devices()):
                devices.append({
                    "index": index,
                    "name": device["name"],
                    "maxInputChannels": device["max_input_channels"],
                    "maxOutputChannels": device["max_output_channels"],
                    "defaultSampleRate": device["default_samplerate"],
                    "hostApi": device["hostapi"],
                })
        except Exception as exc:
            logger.error("get_devices error: %s", exc)
        return devices

    def set_input_device(self, index: Optional[int]):
        self.input_device_idx = None if index in ("", None) else int(index)
        if self.is_running:
            self._restart_stream()

    def set_output_device(self, index: Optional[int]):
        self.output_device_idx = None if index in ("", None) else int(index)
        if self.is_running:
            self._restart_stream()

    def set_monitor_device(self, index: Optional[int]):
        self.monitor_device_idx = None if index in ("", None) else int(index)
        if self.hear_myself and self.is_running:
            self._start_monitor_stream()

    def set_pitch(self, semitones: float):
        self._pitch_node.semitones = float(semitones)
        if self.rvc:
            self.rvc.pitch_semitones = int(semitones)

    def set_reverb(self, room_size: float, damping: float = 0.5):
        self._reverb_node.room_size = float(room_size)
        self._reverb_node.damping = float(damping)

    def set_noise_gate(self, threshold_db: float):
        self._noise_gate.threshold_db = float(threshold_db)
        # Keep the cleanup board's dedicated gate in sync with the user setting
        self._cleanup_noise_gate.threshold_db = float(threshold_db)

    def set_compressor(self, ratio: float, threshold_db: float = -20):
        self._compressor.ratio = float(ratio)
        self._compressor.threshold_db = float(threshold_db)

    def set_input_volume(self, percent: float):
        self.input_volume = float(percent) / 100.0

    def set_output_volume(self, percent: float):
        self.output_volume = float(percent) / 100.0

    def set_monitor_mix(self, percent: float):
        self.monitor_mix = float(percent) / 100.0

    def set_hear_myself(self, enabled: bool):
        self.hear_myself = bool(enabled)
        if enabled:
            # Auto-start the engine so the audio callback fires and monitoring works
            if not self.is_running:
                try:
                    self.start()
                    logger.info("Engine auto-started for hear_myself monitoring")
                except Exception as exc:
                    logger.warning("Auto-start for hear_myself failed: %s", exc)
            # Open dedicated monitor stream if a separate monitor device is configured
            self._start_monitor_stream()
        else:
            self._stop_monitor_stream()

    def _start_monitor_stream(self):
        """Open a dedicated OutputStream on the monitor device for headphone monitoring."""
        self._stop_monitor_stream()

        # Decide which device to use for monitoring
        device = self.monitor_device_idx
        if device is None:
            # No dedicated monitor device — outdata (main stream) handles monitoring already
            return
        # If monitor == output and main stream is running, outdata already covers it
        if device == self.output_device_idx and self.is_running:
            return

        try:
            stream = sd.OutputStream(
                device=device,
                samplerate=self.sample_rate,
                channels=1,
                dtype=np.float32,
                latency="low",
                blocksize=self.buffer_size,
            )
            stream.start()
            with self._monitor_lock:
                self._monitor_stream = stream
            # Drain any stale frames before starting the worker
            while not self._monitor_queue.empty():
                try:
                    self._monitor_queue.get_nowait()
                except queue.Empty:
                    break
            self._monitor_thread = threading.Thread(
                target=self._monitor_worker, daemon=True, name="monitor-worker"
            )
            self._monitor_thread.start()
            logger.info("Monitor stream started on device index %s", device)
        except Exception as exc:
            logger.error("Monitor stream start error: %s", exc)
            self._monitor_stream = None

    def _stop_monitor_stream(self):
        with self._monitor_lock:
            if self._monitor_stream:
                try:
                    self._monitor_stream.stop()
                    self._monitor_stream.close()
                except Exception:
                    pass
                self._monitor_stream = None
        # Drain the queue so the worker thread exits cleanly
        while not self._monitor_queue.empty():
            try:
                self._monitor_queue.get_nowait()
            except queue.Empty:
                break

    def _monitor_worker(self):
        """Drain monitor_queue and write frames to the monitor OutputStream."""
        while self.hear_myself:
            try:
                frame = self._monitor_queue.get(timeout=0.05)
            except queue.Empty:
                continue
            with self._monitor_lock:
                stream = self._monitor_stream
            if stream and stream.active:
                try:
                    stream.write(frame.reshape(-1, 1))
                except Exception as exc:
                    logger.debug("Monitor write error: %s", exc)
                    break
            else:
                break

    def set_voice_changer(self, enabled: bool):
        self.voice_changer_enabled = bool(enabled)

    def set_rvc_enabled(self, enabled: bool):
        self.rvc_enabled = bool(enabled and self.rvc and self.rvc.realtime_ready)
        self.rvc_mode = "ai" if self.rvc_enabled else "dsp"
        self._reset_ai_buffers()

    def set_rvc_mode(self, mode: str):
        self.rvc_mode = "ai" if mode == "ai" else "dsp"
        self.rvc_enabled = self.rvc_mode == "ai" and bool(self.rvc and self.rvc.realtime_ready)
        self._reset_ai_buffers()

    def select_voice(self, voice_id: str, voice_data: dict = None, preferred_mode: Optional[str] = None):
        voice_data = voice_data or {}
        source = voice_data.get("source", "system")
        self._voice_generation += 1
        generation = self._voice_generation
        self.selected_voice_id = voice_id
        self.loading_voice_id = None
        self.voice_load_error = None
        if preferred_mode in {"ai", "dsp"}:
            self.rvc_mode = preferred_mode

        if voice_id == "original":
            self.set_pitch(0)
            self.set_reverb(0.05, 0.5)
            self.set_rvc_mode("dsp")
            self.loaded_voice_id = "original"
            if self.rvc:
                self.rvc.unload_model()
            return

        if source in {"rvc", "custom"} and self.rvc:
            # Use bridge_pitch stored in model metadata (set from APPLIO_META or
            # defaulting to 4).  This replaces the previous fragile name-matching
            # heuristic.
            bridge_pitch = int(voice_data.get("bridge_pitch", 4))
            self.set_pitch(bridge_pitch)
            self.set_reverb(0.1, 0.4)
            self.rvc_enabled = False
            self.loading_voice_id = voice_id
            if self.rvc_mode != "ai":
                self.rvc_mode = "dsp"

            def _load():
                try:
                    ok = self.rvc.load_model(voice_data.get("path"), voice_data.get("index"))
                    if generation != self._voice_generation:
                        return
                    self.loading_voice_id = None
                    if ok:
                        self.loaded_voice_id = voice_id
                        self.rvc_enabled = self.rvc_mode == "ai" and self.rvc.realtime_ready
                    else:
                        self.loaded_voice_id = None
                        self.rvc_enabled = False
                        self.voice_load_error = getattr(self.rvc, "backend_reason", "Model load failed")
                    self._reset_ai_buffers()
                except Exception as exc:
                    if generation == self._voice_generation:
                        self.loading_voice_id = None
                        self.loaded_voice_id = None
                        self.rvc_enabled = False
                        self.voice_load_error = str(exc)

            threading.Thread(target=_load, daemon=True, name="rvc-load").start()
            return

        self.loaded_voice_id = voice_id

    def _rvc_worker(self):
        consecutive_errors = 0
        while self.is_running:
            try:
                payload = self._rvc_input_q.get(timeout=0.05)
            except queue.Empty:
                continue
            if payload is None:
                continue
            chunk, queued_at = payload
            try:
                if self.rvc and self.rvc_enabled and self.rvc.is_loaded:
                    converted = self.rvc.infer_chunk(chunk, sr=self.sample_rate)
                else:
                    converted = chunk
                consecutive_errors = 0  # reset on success
                latency = (time.perf_counter() - queued_at) * 1000
                try:
                    self._rvc_output_q.put_nowait((converted, latency))
                except queue.Full:
                    try:
                        self._rvc_output_q.get_nowait()
                    except queue.Empty:
                        pass
                    self._rvc_output_q.put_nowait((converted, latency))
            except Exception as exc:
                consecutive_errors += 1
                logger.error("RVC worker error (%d consecutive): %s", consecutive_errors, exc, exc_info=True)
                # After 5 straight failures disable AI mode and surface the error.
                # This prevents log-spam and eliminates silent audio corruption.
                if consecutive_errors >= 5:
                    logger.error(
                        "RVC worker: %d consecutive failures — disabling AI mode automatically.",
                        consecutive_errors,
                    )
                    self.rvc_enabled = False
                    self.rvc_mode = "dsp"
                    self.voice_load_error = f"AI disabled after repeated errors: {exc}"
                    consecutive_errors = 0

    def _mix_crossfade(self, previous: np.ndarray, current: np.ndarray) -> np.ndarray:
        if previous.size == 0 or current.size == 0:
            return current
        overlap = min(len(previous), len(current), self._crossfade_samples)
        if overlap <= 1:
            return current
        fade = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
        current[:overlap] = previous[-overlap:] * (1.0 - fade) + current[:overlap] * fade
        return current

    # RMS level below which a chunk is treated as silence and skipped by RVC.
    # -50 dBFS ≈ 0.00316.  Do NOT tighten below -50 dBFS: if the threshold is
    # set to -55 dBFS (0.00178) the growing buzz reaches the threshold and
    # starts being fed INTO the RVC model, where it gets amplified into a
    # runaway feedback loop. -50 dBFS is the correct operating point.
    _VAD_RMS_THRESHOLD: float = 0.00316

    # How many consecutive sub-threshold chunks before we declare "silence" and
    # flush all accumulated audio state (tail cache, last-frame crossfade buffer).
    # At 512 ms chunks: 3 chunks = 1.5 s of silence before flush.
    _VAD_SILENCE_FLUSH_CHUNKS: int = 3

    def _prepare_ai_chunk(self, processed: np.ndarray):
        self._ai_input_buffer = np.concatenate([self._ai_input_buffer, processed.astype(np.float32, copy=False)])
        while len(self._ai_input_buffer) >= self._chunk_samples:
            chunk = self._ai_input_buffer[:self._chunk_samples].copy()
            self._ai_input_buffer = self._ai_input_buffer[self._chunk_samples:]

            rms = float(np.sqrt(np.mean(chunk ** 2)))
            if rms < self._VAD_RMS_THRESHOLD:
                # ── Silence detected ─────────────────────────────────────────
                self._vad_silence_count += 1

                # Clear SOLA buffer and crossfade state on the FIRST silence
                # frame — matching Applio core.py process_audio():
                #   "if is_silence: self.sola_buffer.zero_()"
                #
                # Waiting 3 chunks (old behaviour, 1.5 s) meant voiced synthesis
                # artifacts bled through the sola_buffer into silence output and
                # were audible as a faint harmonic buzz.  Clearing immediately
                # ensures the next voiced onset gets is_onset=True (sola_buffer
                # all-zero) and the proper sin² fade-in is applied.
                if self._vad_silence_count == 1:
                    self._last_ai_frame = np.zeros_like(self._last_ai_frame)
                    self._last_output_frame = np.zeros_like(self._last_output_frame)
                    if self.rvc and hasattr(self.rvc, "clear_tail"):
                        self.rvc.clear_tail()
                    logger.debug("VAD silence: SOLA + tail cache cleared immediately")

                # Route silence directly to output (no RVC processing)
                try:
                    self._rvc_output_q.put_nowait((chunk, 0.0))
                except queue.Full:
                    try:
                        self._rvc_output_q.get_nowait()
                    except queue.Empty:
                        pass
                    self._rvc_output_q.put_nowait((chunk, 0.0))
                continue

            # ── Voiced chunk ──────────────────────────────────────────────────
            self._vad_silence_count = 0   # reset silence counter on voice activity
            try:
                self._rvc_input_q.put_nowait((chunk, time.perf_counter()))
            except queue.Full:
                self._drops += 1
                break

    def _drain_ai_output(self):
        updated = False
        while True:
            try:
                converted, latency = self._rvc_output_q.get_nowait()
            except queue.Empty:
                break
            converted = self._mix_crossfade(self._last_ai_frame, converted)
            self._ai_output_buffer = np.concatenate([self._ai_output_buffer, converted.astype(np.float32, copy=False)])
            self._last_ai_frame = converted[-self._crossfade_samples:].copy()
            self._last_rvc_latency_ms = latency
            updated = True
        return updated

    def _audio_callback(self, indata, outdata, frames, time_info, status):
        if status:
            logger.debug("Stream status: %s", status)
            # Count hardware xruns as drops
            if status.input_overflow or status.output_underflow:
                self._drops += 1

        now = time.perf_counter()
        if self._last_callback_time is not None:
            callback_ms = (now - self._last_callback_time) * 1000
            self._latency_ms = 0.8 * self._latency_ms + 0.2 * callback_ms
        self._last_callback_time = now

        audio_in = indata[:, 0].copy()
        # Apply input volume scaling
        audio_in = (audio_in * self.input_volume).astype(np.float32)
        self.vu_in = float(np.sqrt(np.mean(audio_in ** 2))) * 10

        processed = audio_in
        if self.voice_changer_enabled:
            try:
                if self.rvc_enabled and self.rvc and self.rvc.is_loaded:
                    processed = self._apply_cleanup(audio_in, frames)
                else:
                    processed = self._apply_dsp(audio_in, frames)
            except Exception as exc:
                logger.debug("DSP error: %s", exc)
                processed = audio_in

            if self.rvc_enabled and self.rvc and self.rvc.is_loaded:
                self._prepare_ai_chunk(processed)
                self._drain_ai_output()
                if len(self._ai_output_buffer) >= frames:
                    ai_frame = self._ai_output_buffer[:frames].copy()
                    self._ai_output_buffer = self._ai_output_buffer[frames:]
                    if len(self._last_output_frame) >= frames:
                        overlap = min(frames, self._crossfade_samples)
                        fade = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
                        ai_frame[:overlap] = self._last_output_frame[-overlap:] * (1.0 - fade) + ai_frame[:overlap] * fade
                    processed = ai_frame
                else:
                    # AI output buffer starved — the RVC worker hasn't finished
                    # yet.  Use the last good output frame (repeated/faded) rather
                    # than outputting silence, to avoid audible gaps and clicks.
                    self._drops += 1
                    if len(self._last_output_frame) == frames:
                        # Fade out gently so a repeating tail doesn't drone
                        fade_out = np.linspace(1.0, 0.0, frames, dtype=np.float32)
                        processed = (self._last_output_frame * fade_out).astype(np.float32)
                    # If no last frame exists, processed stays as the DSP-cleaned
                    # audio already computed above (better than silence).

        self.vu_out = float(np.sqrt(np.mean(processed ** 2))) * 10

        # Apply output volume + soft clip; clamp length to frames
        n = min(len(processed), frames)
        safe = np.tanh(processed[:n] * self.output_volume * 0.95).astype(np.float32)
        self._last_output_frame = safe.copy()

        # Always zero ALL channels first to prevent noise on stereo output devices
        outdata[:] = 0.0

        # Determine if a separate monitor device is configured
        has_dedicated_monitor = (
            self.monitor_device_idx is not None
            and self.monitor_device_idx != self.output_device_idx
        )

        if has_dedicated_monitor:
            # Main output (virtual cable) always receives processed audio when engine runs
            outdata[:n, 0] = safe
            # Route to dedicated monitor stream when hear_myself is on
            if self.hear_myself:
                monitor_frame = (safe * self.monitor_mix).astype(np.float32)
                try:
                    self._monitor_queue.put_nowait(monitor_frame)
                except queue.Full:
                    pass
        else:
            # No separate monitor device.
            # ALWAYS write processed audio to outdata so a virtual cable (Discord,
            # OBS, VB-Audio) receives it regardless of hear_myself.
            # When hear_myself=True, scale by monitor_mix to avoid full-volume echo.
            if self.hear_myself:
                outdata[:n, 0] = (safe * self.monitor_mix).astype(np.float32)
            else:
                outdata[:n, 0] = safe

    def _apply_dsp(self, audio_in: np.ndarray, frames: int) -> np.ndarray:
        if self.selected_voice_id == "original":
            return audio_in[:frames].astype(np.float32, copy=False)

        # Always run the full board so noise gate + compressor run on every DSP
        # frame.  Previously the board was skipped when pitch ≈ 0 and reverb_room
        # < 0.12, letting background noise pass through unfiltered in "Original"
        # mode.  The noise gate is cheap — skipping it saved negligible CPU at
        # the cost of audible bleed.
        processed = self.board(audio_in, self.sample_rate)
        if processed.ndim > 1:
            processed = processed[:, 0]
        if len(processed) < frames:
            processed = np.pad(processed, (0, frames - len(processed)))
        return processed[:frames].astype(np.float32, copy=False)

    def _apply_cleanup(self, audio_in: np.ndarray, frames: int) -> np.ndarray:
        """Pre-process mic audio before it enters the RVC queue.

        Runs the pedalboard noise gate + highpass so that floor noise is
        suppressed *before* reaching the model — this is the primary defence
        against idle buzzing.  The tanh soft-clip then keeps transients safe.
        Uses the pre-built self._cleanup_board to avoid per-callback allocation.
        """
        processed = audio_in.astype(np.float32, copy=True)
        processed = processed - np.mean(processed)          # DC remove
        try:
            processed = self._cleanup_board(processed, self.sample_rate)
            if processed.ndim > 1:
                processed = processed[:, 0]
        except Exception:
            pass  # fall back to raw DC-removed audio
        processed = np.tanh(processed * 0.9)
        if len(processed) < frames:
            processed = np.pad(processed, (0, frames - len(processed)))
        return processed[:frames].astype(np.float32, copy=False)

    def start(self):
        if self.is_running:
            return
        resolved_rate, resolved_buffer, resolved_latency = self._resolve_stream_config()
        with self._stream_lock:
            self._stream = sd.Stream(
                samplerate=resolved_rate,
                blocksize=resolved_buffer,
                channels=self.channels,
                dtype=np.float32,
                device=(self.input_device_idx, self.output_device_idx),
                callback=self._audio_callback,
                latency=resolved_latency,
            )
            self._stream.start()
            self.sample_rate = resolved_rate
            self.buffer_size = resolved_buffer
            self._reset_ai_buffers()
            self.is_running = True
            self._rvc_thread = threading.Thread(target=self._rvc_worker, daemon=True, name="rvc-worker")
            self._rvc_thread.start()
        # Start monitor stream if hear_myself is already enabled
        if self.hear_myself:
            self._start_monitor_stream()

    def stop(self):
        self.is_running = False
        # Stop monitor stream first
        self._stop_monitor_stream()
        with self._stream_lock:
            if self._stream:
                try:
                    self._stream.stop()
                    self._stream.close()
                except Exception:
                    pass
                self._stream = None
        self.vu_in = 0.0
        self.vu_out = 0.0
        self._last_callback_time = None
        self._latency_ms = 0.0
        self._last_rvc_latency_ms = 0.0
        self._reset_ai_buffers()
        # Recreate cleanup board plugin instances so their IIR filter state is
        # cleared.  A running highpass or noise gate left in a partially-settled
        # state carries ringing energy into the next session, manifesting as the
        # growing buzz the user hears after stopping and restarting.
        self._cleanup_highpass   = HighpassFilter(cutoff_frequency_hz=80)
        self._cleanup_noise_gate = NoiseGate(
            threshold_db=self._noise_gate.threshold_db, ratio=10
        )
        self._cleanup_board = Pedalboard([self._cleanup_highpass, self._cleanup_noise_gate])

    def _restart_stream(self):
        was_running = self.is_running
        self.stop()
        if was_running:
            time.sleep(0.08)
            self.start()

    def get_status(self) -> dict:
        combined_latency = self._latency_ms + (self._last_rvc_latency_ms if self.rvc_enabled else 0.0)
        return {
            "is_running": self.is_running,
            "voice_changer_enabled": self.voice_changer_enabled,
            "rvc_enabled": self.rvc_enabled,
            "rvc_mode": self.rvc_mode,
            "hear_myself": self.hear_myself,
            "vu_in": round(min(100, self.vu_in * 100), 1),
            "vu_out": round(min(100, self.vu_out * 100), 1),
            "sample_rate": self.sample_rate,
            "buffer_size": self.buffer_size,
            "latency_ms": round(combined_latency, 1),
            "backend_mode": getattr(self.rvc, "backend_mode", "dsp_bridge_only") if self.rvc else "dsp_bridge_only",
            "backend_reason": getattr(self.rvc, "backend_reason", "") if self.rvc else "",
            "chunk_ms": getattr(self.rvc, "chunk_ms", 256) if self.rvc else 256,
            "rvc_infer_ms": round(getattr(self.rvc, "last_infer_ms", 0.0), 1) if self.rvc else 0.0,
            "queue_drops": self._drops,
            "selected_voice_id": self.selected_voice_id,
            "loaded_voice_id": self.loaded_voice_id,
            "loading_voice_id": self.loading_voice_id,
            "voice_load_error": self.voice_load_error,
        }

    def set_buffer_size(self, size: int):
        self.buffer_size = int(size)
        self._reset_ai_buffers()
        if self.is_running:
            self._restart_stream()

    def set_sample_rate(self, rate: int):
        self.sample_rate = int(rate)
        self._reset_ai_buffers()
        if self.is_running:
            self._restart_stream()
