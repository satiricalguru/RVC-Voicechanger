"""
rvc_pipeline.py — Real RVC v2 neural voice conversion pipeline.

Uses the actual SynthesizerTrnMs768NSFsid model (Applio/IAHispano architecture)
with HuBERT phone features + RMVPE F0.  Replaces the previous fake DSP path
that caused constant buzzing artefacts.
"""

import io
import logging
import os
import sys
import threading
import time
import urllib.request
import warnings
from contextlib import redirect_stdout
from pathlib import Path
from typing import Optional

# ── OpenMP / libomp duplicate-runtime guard ───────────────────────────────────
# faiss-cpu, PyTorch, and scikit-learn each ship their own libomp.dylib.
# On macOS ARM64 this causes __kmp_suspend_initialize_thread to SIGSEGV
# (crash at address 0x580 — a field offset into a NULL kmp_info* struct)
# the instant FAISS spawns OpenMP worker threads for an index search.
#
# Mitigation 1 — KMP_DUPLICATE_LIB_OK=TRUE:
#   Tells the Intel KMP runtime to tolerate the duplicate instead of aborting.
#   Must be set *before* any libomp is dlopen()ed, i.e. before "import faiss".
#
# Mitigation 2 — OMP_NUM_THREADS=1 / MKL_NUM_THREADS=1:
#   Pins FAISS (and MKL) to a single thread so the parallel barrier code path
#   (__kmp_fork_barrier → __kmp_hyper_barrier_release → crash) is never entered.
#   Real-time RVC chunk sizes are small enough that single-threaded FAISS is
#   indistinguishable in latency from multi-threaded FAISS.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS",       "1")
os.environ.setdefault("MKL_NUM_THREADS",       "1")

import numpy as np
import torch
import torch.nn.functional as F

warnings.filterwarnings("ignore", category=UserWarning)

# ── make the bundled rvc/ sub-package importable ─────────────────────────────
_BACKEND_DIR = Path(__file__).parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

logger = logging.getLogger("rvc_pipeline")

ASSETS_DIR = Path.home() / ".aivoicechanger" / "assets"
RMVPE_PATH = ASSETS_DIR / "rmvpe.onnx"

HUBERT_URL  = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt"
RMVPE_URL   = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.onnx"

# FAISS 1.13 uses OpenBLAS internally which is not thread-safe on macOS.
# All calls to index.search() must hold this lock to prevent SIGSEGV.
_FAISS_LOCK = threading.Lock()


def _strip_parametrizations(module: torch.nn.Module):
    """Remove weight_g/weight_v weight-norm parametrizations from all submodules.

    Ported from Applio realtime/pipeline.py strip_parametrizations().
    Weight norm left in place forces the synthesizer to recompute normalised
    weights at every infer() call, distorting the spectral envelope and
    producing tonal artefacts at chunk boundaries.
    """
    import torch.nn.utils.parametrize as P
    for submodule in module.modules():
        if hasattr(submodule, "parametrizations"):
            for pname in list(submodule.parametrizations.keys()):
                try:
                    P.remove_parametrizations(submodule, pname, leave_parametrized=True)
                except Exception:
                    pass


def _get_device() -> torch.device:
    """Compute device for all inference.

    MPS (Apple Silicon GPU) is intentionally excluded even though it is
    faster for individual ops.  The audio backend calls load_model() and
    infer_chunk() from worker threads (rvc-load, rvc-worker, asyncio pool).
    PyTorch's MPS backend requires **all GPU operations to happen on the
    thread that created the Metal device context** — violating this causes
    a silent SIGSEGV that kills the Python process.

    CUDA is thread-safe and is used when available.
    On Apple M-series, CPU handles a 320 ms chunk (with 0.5 s of left-context
    for HuBERT/vocoder stability) in ~240 ms — leaves real-time headroom, but
    isn't so fast it can be treated as free; keep the extra-context window as
    small as quality allows.
    """
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _get_synth_device() -> torch.device:
    """Same device as _get_device() — kept for backwards compatibility."""
    return _get_device()


# ─────────────────────────────────────────────────────────────────────────────
#  F0 helpers
# ─────────────────────────────────────────────────────────────────────────────

# Mel-scale bins for coarse F0 (RVC standard: 256 bins, 50–1100 Hz)
_F0_MEL_MIN = 1127.0 * np.log(1.0 + 50.0  / 700.0)
_F0_MEL_MAX = 1127.0 * np.log(1.0 + 1100.0 / 700.0)


def f0_to_coarse_fine(f0: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Convert raw F0 Hz array → (coarse int [0-255], fine float) for RVC.

    Voiced frames are bucketed into [1, 255] (matching Applio reference).
    Unvoiced frames (f0 == 0) are explicitly set to 0 after bucketing.
    """
    f0_mel = 1127.0 * np.log(1.0 + np.where(f0 > 0, f0, 1.0) / 700.0)
    f0_mel = np.where(f0 > 0, f0_mel, 0.0)
    # Clip to [1, 255] for voiced frames — matches Applio's torch.clip(..., 1, 255)
    coarse = np.clip(
        np.round((f0_mel - _F0_MEL_MIN) * 254.0 / (_F0_MEL_MAX - _F0_MEL_MIN) + 1.0),
        1, 255,
    ).astype(np.int64)
    coarse = np.where(f0 > 0, coarse, 0)
    return coarse, f0.astype(np.float32)


# ─────────────────────────────────────────────────────────────────────────────
#  RVCPipeline
# ─────────────────────────────────────────────────────────────────────────────

class RVCPipeline:
    def __init__(self):
        self.device = _get_device()
        self.index = None
        self.index_rate = 0.75
        self.protect = 0.33
        self.filter_radius = 3
        self.pitch_semitones = 0
        self.model_sr = 40000  # overridden per-model on load
        self.chunk_ms = 320
        self.crossfade_ms = 36
        # Left-context (seconds) fed to HuBERT/F0/vocoder ahead of the new chunk.
        # Was hardcoded to 1.5s ("for HuBERT stability"), but profiling shows the
        # vocoder + HuBERT cost scales with this window and 1.5s ate 95-98% of a
        # 320ms real-time budget on CPU (measured: ~307ms/320ms), leaving almost
        # no headroom for audio-thread/GIL contention — the moment anything else
        # briefly delays the RVC worker thread, the output queue starves and the
        # engine falls back to repeating/fading the last frame (heard as robotic/
        # glitchy audio) or the chunk simply arrives late (heard as latency).
        # Applio's own realtime UI defaults extra_convert_size to 0.5s and gets
        # the same HuBERT stability from it, so match that here.
        self.extra_context_s = 0.5
        self.f0_method = "rmvpe"
        self._lock = threading.Lock()
        self._loaded_pth = None
        self._hubert_model = None
        self._rmvpe = None
        self._net_g = None
        self._big_npy = None
        self._model_name = ""
        self._input_tail_cache = np.zeros(0, dtype=np.float32)  # raw INPUT context for HuBERT (NOT converted output)
        self._sola_buffer = np.zeros(0, dtype=np.float32)  # Applio SOLA overlap buffer
        self._warm = False
        self._last_infer_ms = 0.0
        self.backend_mode = "dsp_bridge_only"
        self.backend_reason = "No model loaded"
        ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    # ── public props ──────────────────────────────────────────────────────────

    @property
    def is_loaded(self) -> bool:
        return self._loaded_pth is not None

    @property
    def realtime_ready(self) -> bool:
        return self.backend_mode == "realtime_rvc"

    @property
    def last_infer_ms(self) -> float:
        return self._last_infer_ms

    def set_chunk_ms(self, chunk_ms: int):
        self.chunk_ms = int(max(128, min(512, chunk_ms)))

    def set_f0_method(self, method: str):
        if method in {"harvest", "rmvpe", "fcpe"}:
            self.f0_method = method

    # ── asset management ──────────────────────────────────────────────────────

    def _download_if_missing(self, path: Path, url: str, label: str) -> bool:
        if path.exists():
            return True
        try:
            logger.info("Downloading %s → %s", label, path)
            tmp = path.with_suffix(".tmp")
            urllib.request.urlretrieve(url, tmp)
            tmp.rename(path)
            logger.info("%s downloaded OK (%s MB)", label, path.stat().st_size // 1_000_000)
            return True
        except Exception as exc:
            logger.error("Failed to download %s: %s", label, exc)
            return False

    def download_rmvpe(self):
        self._download_if_missing(RMVPE_PATH, RMVPE_URL, "RMVPE")
        return str(RMVPE_PATH)

    # ── HuBERT ────────────────────────────────────────────────────────────────

    def _ensure_hubert(self) -> bool:
        """Load HuBERT as a transformers HubertModel.

        On first run we download the fairseq checkpoint and convert it once to
        a plain state-dict (hubert_base_hf_sd.pt).  Subsequent runs load the
        converted file directly.
        """
        if self._hubert_model is not None:
            return True

        hf_sd_path    = ASSETS_DIR / "hubert_base_hf_sd.pt"
        fairseq_path  = ASSETS_DIR / "hubert_base.pt"

        try:
            import re, types
            import torch.nn.utils.parametrize as P
            from transformers import HubertModel, HubertConfig

            HF_CONFIG = HubertConfig(
                hidden_size=768, num_hidden_layers=12, num_attention_heads=12,
                intermediate_size=3072,
                conv_dim=(512,512,512,512,512,512,512),
                conv_stride=(5,2,2,2,2,2,2),
                conv_kernel=(10,3,3,3,3,2,2),
                conv_bias=False, feat_extract_norm="group",
            )

            def _build_model(sd: dict) -> HubertModel:
                model = HubertModel(HF_CONFIG)
                conv = model.encoder.pos_conv_embed.conv
                if P.is_parametrized(conv):
                    P.remove_parametrizations(conv, "weight", leave_parametrized=True)
                model.load_state_dict(sd, strict=False)
                model.eval()
                return model

            # ── Fast path: already converted ─────────────────────────────────
            if hf_sd_path.exists():
                ckpt = torch.load(str(hf_sd_path), map_location="cpu", weights_only=True)
                sd   = ckpt["state_dict"] if isinstance(ckpt, dict) and "state_dict" in ckpt else ckpt
                self._hubert_model = _build_model(sd).to(self.device)
                logger.info("HuBERT loaded (converted) on %s", self.device)
                return True

            # ── Slow path: download fairseq .pt + convert on-the-fly ─────────
            if not fairseq_path.exists():
                logger.info("Downloading HuBERT fairseq checkpoint (≈365 MB) …")
                if not self._download_if_missing(fairseq_path, HUBERT_URL, "HuBERT"):
                    return False

            # Stub fairseq so torch.load can unpickle the checkpoint
            STUB_MODS = [
                "fairseq","fairseq.models","fairseq.data","fairseq.data.dictionary",
                "fairseq.models.hubert","fairseq.models.hubert.hubert",
                "fairseq.models.hubert.hubert_pretraining","fairseq.tasks",
                "fairseq.tasks.hubert_pretraining","fairseq.criterions","fairseq.logging",
            ]
            import sys
            for mod in STUB_MODS:
                if mod not in sys.modules:
                    sys.modules[mod] = types.ModuleType(mod)
            class _Dict: pass
            sys.modules["fairseq.data.dictionary"].Dictionary = _Dict

            fs_ckpt = torch.load(str(fairseq_path), map_location="cpu", weights_only=False)
            fs      = fs_ckpt["model"]

            SKIP = {"mask_emb","label_embs","final_proj","quantizer","label_embs_concat","proj."}
            def _remap(src):
                out = {}
                for k, v in src.items():
                    if any(k.startswith(p) for p in SKIP): continue
                    nk = k
                    nk = re.sub(r"(feature_extractor\.conv_layers\.\d+)\.0\.weight$", r"\1.conv.weight", nk)
                    nk = re.sub(r"(feature_extractor\.conv_layers\.\d+)\.2\.(weight|bias)$", r"\1.layer_norm.\2", nk)
                    nk = re.sub(r"^post_extract_proj\.(weight|bias)$", r"feature_projection.projection.\1", nk)
                    if re.match(r"^layer_norm\.(weight|bias)$", nk): nk = "feature_projection." + nk
                    nk = re.sub(r"^encoder\.pos_conv\.0\.(.*)", r"encoder.pos_conv_embed.conv.\1", nk)
                    nk = nk.replace(".self_attn.", ".attention.")
                    nk = nk.replace(".self_attn_layer_norm.", ".layer_norm.")
                    nk = nk.replace(".fc1.", ".feed_forward.intermediate_dense.")
                    nk = nk.replace(".fc2.", ".feed_forward.output_dense.")
                    out[nk] = v
                return out

            hf_sd = _remap(fs)
            wg = hf_sd.pop("encoder.pos_conv_embed.conv.weight_g")
            wv = hf_sd.pop("encoder.pos_conv_embed.conv.weight_v")
            hf_sd["encoder.pos_conv_embed.conv.weight"] = (
                wg * (wv / wv.norm(dim=[1,2], keepdim=True).clamp(min=1e-8))
            )

            # Cache for next launch
            try:
                torch.save({"state_dict": hf_sd}, str(hf_sd_path))
                logger.info("HuBERT converted state dict saved → %s", hf_sd_path)
            except Exception as e:
                logger.warning("Could not cache converted HuBERT: %s", e)

            self._hubert_model = _build_model(hf_sd).to(self.device)
            logger.info("HuBERT loaded (freshly converted) on %s", self.device)
            return True

        except Exception as exc:
            logger.error("HuBERT load error: %s", exc, exc_info=True)
            return False

    def _extract_hubert_features(self, audio_16k: np.ndarray) -> torch.Tensor:
        """Return HuBERT last_hidden_state [1, T, 768] on self.device."""
        if self._hubert_model is None:
            # Lazy init guard: should not happen after load_model, but be safe
            if not self._ensure_hubert():
                raise RuntimeError("HuBERT model not available")
        feats = torch.from_numpy(audio_16k).float().unsqueeze(0).to(self.device)
        with torch.no_grad():
            out = self._hubert_model(feats)
            if hasattr(out, "last_hidden_state"):
                feats_out = out.last_hidden_state   # transformers output
            elif isinstance(out, dict):
                feats_out = out["last_hidden_state"]
            elif isinstance(out, (tuple, list)):
                feats_out = out[0]
            else:
                feats_out = out
        return feats_out  # [1, T', 768]

    # ── FAISS index ───────────────────────────────────────────────────────────

    def _load_faiss(self, index_path: Optional[str]):
        self.index = None
        self._big_npy = None
        if not index_path or not os.path.exists(index_path):
            return
        try:
            import faiss
            # Pin FAISS to 1 OpenMP thread at the C++ level.  This is the
            # definitive fix: even if KMP_DUPLICATE_LIB_OK is somehow ignored
            # (e.g. the env var arrived after dlopen), single-threaded FAISS
            # never enters __kmp_fork_barrier so the libomp SIGSEGV cannot fire.
            try:
                faiss.omp_set_num_threads(1)
            except Exception:
                pass  # older faiss builds may not expose this symbol
            self.index = faiss.read_index(index_path)
            if self.index.is_trained:
                self._big_npy = self.index.reconstruct_n(0, self.index.ntotal)
            logger.info("FAISS index loaded: %d vectors", self.index.ntotal)
        except Exception as exc:
            logger.warning("FAISS index load failed: %s", exc)

    def _apply_index(self, feats: torch.Tensor) -> torch.Tensor:
        """Blend features with FAISS-retrieved speaker embeddings."""
        if self.index is None or self._big_npy is None or self.index_rate <= 0:
            return feats
        try:
            npy = feats[0].cpu().numpy()  # [T, 768]
            # FAISS 1.13 / OpenBLAS is not thread-safe on macOS.
            # Acquire the global lock before every search() call.
            with _FAISS_LOCK:
                score, ix = self.index.search(npy, k=8)
            weight = np.square(1.0 / (score + 1e-8))
            weight /= weight.sum(axis=1, keepdims=True)
            retrieved = np.sum(self._big_npy[ix] * weight[:, :, np.newaxis], axis=1)
            blended = torch.from_numpy(retrieved).unsqueeze(0).to(self.device)
            feats = feats * (1 - self.index_rate) + blended * self.index_rate
        except Exception as exc:
            logger.debug("Index apply failed: %s", exc)
        return feats.to(feats.dtype)

    # ── Model load / unload ───────────────────────────────────────────────────

    def load_model(self, pth_path: str, index_path: Optional[str] = None) -> bool:
        try:
            with self._lock:
                from rvc.lib.algorithm.synthesizers import Synthesizer

                cpt = torch.load(pth_path, map_location="cpu", weights_only=False)
                cfg   = cpt["config"]
                use_f0 = bool(cpt.get("f0", 1))
                # Fix speaker embedding dimension to match checkpoint weight.
                # The stored config[-3] (spk_embed_dim) can be mismatched with the
                # actual embedding table shape (Applio realtime/pipeline.py fix).
                cfg[-3] = cpt["weight"]["emb_g.weight"].shape[0]
                # text_enc_hidden_dim: 768 for v2, 256 for v1
                version = cpt.get("version", "v2")
                enc_dim = 768 if version == "v2" else 256
                vocoder = cpt.get("vocoder", "HiFi-GAN")

                # cfg: [spec_ch, seg_sz, inter_ch, hidden_ch, filter_ch,
                #        n_heads, n_layers, k_size, dropout, resblock,
                #        resblock_kernels, resblock_dilations,
                #        upsample_rates, up_init_ch, up_kernels,
                #        spk_embed_dim, gin_channels, sr]
                with redirect_stdout(io.StringIO()):  # suppress "Using HiFi-GAN" print
                    net_g = Synthesizer(
                        *cfg,
                        use_f0=use_f0,
                        text_enc_hidden_dim=enc_dim,
                        vocoder="HiFi-GAN",
                    )

                net_g.load_state_dict(cpt["weight"], strict=False)
                # Remove weight_g/weight_v parametrizations (weight norm) per
                # Applio realtime/pipeline.py strip_parametrizations().
                # Weight norm left in place causes the synthesizer to apply an
                # extra normalisation pass at inference time that distorts the
                # spectral envelope and contributes to tonal artefacts.
                _strip_parametrizations(net_g)
                net_g.eval()
                self._synth_device = _get_synth_device()
                net_g = net_g.to(self._synth_device)
                logger.info("Synthesizer on %s  HuBERT on %s",
                            self._synth_device, self.device)

                # sr stored in config last element, or cpt["sr"]
                model_sr_raw = cpt.get("sr", cfg[-1])
                try:
                    self.model_sr = int(str(model_sr_raw).replace("k","000"))
                except Exception:
                    self.model_sr = 32000

                self._net_g      = net_g
                self._loaded_pth = pth_path
                self._model_name = Path(pth_path).stem.lower()

                self._load_faiss(index_path)
                self._input_tail_cache = np.zeros(0, dtype=np.float32)
                self._sola_buffer = np.zeros(0, dtype=np.float32)
                self.backend_mode   = "realtime_rvc"
                self.backend_reason = f"Neural RVC v2 on {self.device.type.upper()}"
                self._warm = False

                # Load HuBERT synchronously — must be ready before first infer_chunk
                if not self._ensure_hubert():
                    self.backend_mode   = "dsp_bridge_only"
                    self.backend_reason = "HuBERT unavailable"
                    return False

                # JIT warm-up synchronously: avoids MPS thread-safety issues
                # and ensures the first real chunk has no cold-start latency.
                self._warmup()
                logger.info("Model loaded: %s  sr=%d", pth_path, self.model_sr)
                return True

        except Exception as exc:
            logger.error("Model load error: %s", exc, exc_info=True)
            self.backend_mode   = "dsp_bridge_only"
            self.backend_reason = str(exc)
            return False

    def _warmup(self):
        """Run one dummy inference to JIT-compile kernels before live audio starts.

        FAISS index is temporarily disabled during warmup: the dummy sine wave
        has no meaningful speaker embedding and FAISS search on random vectors
        can segfault with OpenBLAS on macOS (FAISS 1.13 thread-safety bug).
        """
        try:
            saved_index    = self.index
            saved_big_npy  = self._big_npy
            self.index     = None   # disable FAISS during warmup
            self._big_npy  = None
            try:
                # Warm up with the SAME window shape infer_chunk() actually uses
                # (extra context + overlap + sola_search + chunk), not just a bare
                # chunk — otherwise this warm-up doesn't reflect real steady-state
                # cost and the first live chunk is still an unexpected cold start.
                sr = self.model_sr
                chunk_len = int(sr * max(self.chunk_ms, 64) / 1000)
                overlap = max(1, min(int(sr * self.crossfade_ms / 1000), chunk_len // 2))
                sola_search = max(1, sr // 100)
                extra = int(sr * self.extra_context_s)
                window_len = extra + overlap + sola_search + chunk_len
                t = np.linspace(0, window_len / sr, window_len, dtype=np.float32)
                dummy_audio = (0.1 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
                _ = self._neural_infer(dummy_audio, sr, skip_head_samples=extra)
            finally:
                self.index    = saved_index   # restore after warmup
                self._big_npy = saved_big_npy
            self._warm = True
            logger.info("Warm-up complete (synth=%s hubert=%s)",
                        getattr(self, "_synth_device", "cpu"), self.device)
        except Exception as exc:
            logger.warning("Warm-up failed (non-fatal): %s", exc)

    def clear_tail(self):
        """Zero the crossfade tail cache and SOLA buffer.

        Called by the engine after sustained VAD silence to prevent the last
        voiced synthesis output (which contains model-specific tonal artifacts
        at ~750 Hz) from being blended into the next voiced chunk via the
        crossfade window.  Without this, the artifact persists in _input_tail_cache
        indefinitely and creates a growing buzz during silence.
        """
        with self._lock:
            self._input_tail_cache = np.zeros(0, dtype=np.float32)
            self._sola_buffer = np.zeros(0, dtype=np.float32)

    def unload_model(self):
        with self._lock:
            self._net_g       = None
            self._loaded_pth  = None
            self.index        = None
            self._big_npy     = None
            self._input_tail_cache = np.zeros(0, dtype=np.float32)
            self._sola_buffer = np.zeros(0, dtype=np.float32)
            self.backend_mode   = "dsp_bridge_only"
            self.backend_reason = "No model loaded"
            if self.device.type == "mps":
                torch.mps.empty_cache()

    # ── RMVPE F0 ─────────────────────────────────────────────────────────────

    _RMVPE_SR         = 16000
    _RMVPE_N_FFT      = 1024
    _RMVPE_HOP        = 160
    _RMVPE_N_MELS     = 128
    _RMVPE_FMIN       = 30.0
    _RMVPE_FMAX       = 8000.0
    _RMVPE_PAD_MULT   = 32        # pad mel time-dim to mult of 32 (UNet skip-conn)
    _RMVPE_CENTS      = 20.0 * np.arange(360, dtype=np.float32) + 1997.3794084376191

    def _audio_to_rmvpe_mel(self, audio_16k: np.ndarray) -> tuple:
        import librosa
        mel = librosa.feature.melspectrogram(
            y=audio_16k, sr=self._RMVPE_SR,
            n_fft=self._RMVPE_N_FFT, hop_length=self._RMVPE_HOP,
            win_length=self._RMVPE_N_FFT, n_mels=self._RMVPE_N_MELS,
            fmin=self._RMVPE_FMIN, fmax=self._RMVPE_FMAX,
        )
        mel = np.log(np.clip(mel, 1e-5, None)).astype(np.float32)
        n_orig = mel.shape[1]
        pad = (self._RMVPE_PAD_MULT - n_orig % self._RMVPE_PAD_MULT) % self._RMVPE_PAD_MULT
        if pad:
            mel = np.pad(mel, ((0, 0), (0, pad)))
        return mel[np.newaxis, :, :], n_orig

    def _rmvpe_bins_to_hz(self, logits: np.ndarray) -> np.ndarray:
        voiced_thresh = 0.1
        peak_idx  = np.argmax(logits, axis=-1)
        peak_conf = logits[np.arange(len(peak_idx)), peak_idx]
        cents     = self._RMVPE_CENTS[peak_idx]
        hz        = 10.0 * (2.0 ** (cents / 1200.0))
        return np.where(peak_conf >= voiced_thresh, hz, 0.0).astype(np.float32)

    def _extract_f0_fcpe(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """FCPE (Fast Causal Pitch Estimator) F0 extraction — preferred method."""
        try:
            from scipy.signal import resample_poly
            audio_16k = (resample_poly(audio, 16000, sr) if sr != 16000 else audio).astype(np.float32)
            if len(audio_16k) < 160:
                return np.zeros(1, dtype=np.float32)
            # Lazy import so FCPE is optional; fall back to RMVPE if unavailable.
            try:
                # pyrefly: ignore [missing-import]
                import torchfcpe
                model = torchfcpe.spawn_bundled_infer_model(device=str(self.device))
                model.eval()
                audio_t = torch.from_numpy(audio_16k).float().unsqueeze(0).unsqueeze(-1).to(self.device)
                with torch.no_grad():
                    f0 = model.infer(
                        audio_t,
                        sr=16000,
                        decoder_mode="local_argmax",
                        threshold=0.006,
                    )
                return f0.squeeze().cpu().numpy().astype(np.float32)
            except ImportError:
                # torchfcpe not installed — silently fall through to RMVPE
                return self._extract_f0_rmvpe(audio_16k, 16000)
        except Exception as exc:
            logger.warning("FCPE failed, falling back to RMVPE: %s", exc)
            return self._extract_f0_rmvpe(audio, sr)

    def _extract_f0_rmvpe(self, audio: np.ndarray, sr: int) -> np.ndarray:
        try:
            if self._rmvpe is None:
                if not RMVPE_PATH.exists():
                    return self._extract_f0_harvest(audio, sr)
                import onnxruntime as ort
                opts = ort.SessionOptions()
                opts.log_severity_level = 3
                self._rmvpe = ort.InferenceSession(
                    str(RMVPE_PATH), sess_options=opts,
                    providers=["CPUExecutionProvider"],
                )
            from scipy.signal import resample_poly
            audio_16k = (resample_poly(audio, 16000, sr) if sr != 16000 else audio).astype(np.float32)
            if len(audio_16k) < self._RMVPE_N_FFT:
                audio_16k = np.pad(audio_16k, (0, self._RMVPE_N_FFT - len(audio_16k)))
            mel_in, n_orig = self._audio_to_rmvpe_mel(audio_16k)
            raw = self._rmvpe.run(None, {"input": mel_in})
            logits = raw[0][0][:n_orig]
            return self._rmvpe_bins_to_hz(logits)
        except Exception as exc:
            logger.warning("RMVPE failed, falling back: %s", exc)
            self._rmvpe = None
            return self._extract_f0_harvest(audio, sr)

    def _extract_f0_harvest(self, audio: np.ndarray, sr: int) -> np.ndarray:
        from scipy.signal import resample_poly
        audio_16k = (resample_poly(audio, 16000, sr) if sr != 16000 else audio).astype(np.float32)
        frame_len = int(0.025 * 16000)
        hop_len   = int(0.010 * 16000)
        f0_list = []
        for i in range(0, max(1, len(audio_16k) - frame_len), hop_len):
            frame = audio_16k[i:i + frame_len] * np.hanning(frame_len)
            corr  = np.correlate(frame, frame, "full")[frame_len - 1:]
            lo, hi = int(16000 / 1100), min(len(corr) - 1, int(16000 / 50))
            if hi <= lo:
                f0_list.append(0.0)
                continue
            peak   = np.argmax(corr[lo:hi]) + lo
            voiced = corr[peak] / (corr[0] + 1e-8) > 0.25
            f0_list.append(16000.0 / peak if voiced else 0.0)
        return np.asarray(f0_list or [0.0], dtype=np.float32)

    # ── Core neural inference ─────────────────────────────────────────────────

    def _neural_infer(self, audio: np.ndarray, sr: int, skip_head_samples: int = 0, protect: float = 0.33,
                      volume_envelope: float = 1.0) -> np.ndarray:
        """
        Full RVC v2 inference, ported from Applio realtime/pipeline.py.

        Changes vs original:
         - protect: blends original HuBERT features back on unvoiced frames so
           consonants aren't pitch-shifted, eliminating inter-chunk tonal residue.
         - rate tensor: tells the vocoder the exact output stride so it doesn't
           smear frames across chunk boundaries (source of 750 Hz artifact).
         - volume_envelope: matches output RMS to input RMS, suppressing model-
           generated amplitude artifacts during silence transitions.
         - F0 boundary trim [3:-1]: removes unreliable RMVPE boundary estimates.
         - strip_parametrizations: removes weight_g/weight_v weight-norm from
           the synthesizer so it runs on its plain weight tensor.
        """
        from scipy.signal import resample_poly
        import librosa

        # 1. Resample to 16 kHz for HuBERT + RMVPE
        audio_16k = (resample_poly(audio, 16000, sr) if sr != 16000 else audio).astype(np.float32)

        # 2. HuBERT features [1, T_h, 768]
        feats = self._extract_hubert_features(audio_16k)
        # Applio realtime/pipeline.py: append last frame before interpolation so the
        # ×2 upsample never drops the boundary frame → eliminates edge distortion.
        feats = torch.cat((feats, feats[:, -1:, :]), 1)
        # Keep a copy of original features for protect blending (consonant protection)
        feats0 = feats.detach().clone()
        # Upsample ×2 (hop 320 → 160 @ 16 kHz)
        feats = F.interpolate(feats.permute(0, 2, 1), scale_factor=2, mode="nearest").permute(0, 2, 1)
        feats0 = F.interpolate(feats0.permute(0, 2, 1), scale_factor=2, mode="nearest").permute(0, 2, 1)

        # 3. FAISS index blending
        feats = self._apply_index(feats)

        # 4. p_len: align to audio length
        p_len = min(len(audio_16k) // 160, feats.shape[1])
        feats  = feats[:, :p_len, :]
        feats0 = feats0[:, :p_len, :]

        # 5. F0 at 16 kHz, trimming boundary frames [3:-1] per Applio
        if self.f0_method == "fcpe":
            f0_raw = self._extract_f0_fcpe(audio_16k, 16000)
        elif self.f0_method == "rmvpe":
            f0_raw = self._extract_f0_rmvpe(audio_16k, 16000)
        else:
            f0_raw = self._extract_f0_harvest(audio_16k, 16000)
        if self.pitch_semitones:
            f0_raw = np.where(f0_raw > 0, f0_raw * (2.0 ** (self.pitch_semitones / 12.0)), 0.0)
        # Apply median filter to smooth F0 — matches Applio pipeline.py behaviour
        # when filter_radius > 2.  Prevents jittery pitch between frames which
        # would otherwise manifest as fast tonal flutter in the converted voice.
        if self.filter_radius > 2 and len(f0_raw) > 3:
            from scipy.signal import medfilt
            f0_raw = medfilt(f0_raw, 3).astype(np.float32)
        # Trim unreliable boundary frames then resize to p_len (Applio: f0[3:-1])
        if len(f0_raw) > 4:
            f0_raw = f0_raw[3:-1]
        if len(f0_raw) != p_len:
            f0_raw = np.interp(
                np.linspace(0, max(len(f0_raw) - 1, 1), p_len),
                np.arange(len(f0_raw)),
                f0_raw,
            ).astype(np.float32)

        # 6. Protect blending — Applio realtime/pipeline.py voice_conversion()
        # On unvoiced frames (f0 == 0, i.e. consonants) blend original feats back.
        # protect=0.33 means unvoiced frames are 33% original / 67% speaker-index.
        # This prevents consonant distortion that manifests as 750 Hz tonal residue.
        if protect < 0.5:
            sdev = getattr(self, "_synth_device", torch.device("cpu"))
            pitchf_t_raw = torch.from_numpy(f0_raw).float().unsqueeze(0).to(sdev)
            pitchff = pitchf_t_raw.detach().clone()
            pitchff[pitchf_t_raw > 0] = 1.0
            pitchff[pitchf_t_raw < 1] = float(protect)
            feats = (feats.to(sdev) * pitchff.unsqueeze(-1)
                     + feats0.to(sdev) * (1.0 - pitchff.unsqueeze(-1)))
            feats = feats.to(feats0.dtype)

        # 7. Coarse + fine F0 tensors
        pitch_coarse, pitch_fine = f0_to_coarse_fine(f0_raw)
        sdev = getattr(self, "_synth_device", torch.device("cpu"))
        pitch_t  = torch.from_numpy(pitch_coarse).long().unsqueeze(0).to(sdev)
        pitchf_t = torch.from_numpy(pitch_fine).float().unsqueeze(0).to(sdev)

        # 8. rate tensor — Applio realtime/pipeline.py:
        # return_length / p_len tells the vocoder the exact output stride.
        # It trims `skip_frames` from the latent space before HiFi-GAN, allowing
        # HuBERT/FCPE to use `extra_context` for stability without wasting
        # vocoder compute on the context block.
        skip_head_16k = int(skip_head_samples * 16000 / sr)
        skip_frames = skip_head_16k // 160
        return_length = p_len - skip_frames
        if return_length <= 0:
            return_length = p_len
            skip_frames = 0
            
        rate_tensor = torch.tensor([return_length / p_len], dtype=torch.float32, device=sdev)
        p_len_t = torch.tensor([p_len], dtype=torch.long, device=sdev)
        sid_t   = torch.tensor([0],     dtype=torch.long, device=sdev)
        feats   = feats.to(sdev)

        with torch.no_grad():
            audio_out = self._net_g.infer(
                feats.float(), p_len_t, pitch_t, pitchf_t, sid_t, rate_tensor
            )[0][0, 0]
            # Hard clip per Applio RealtimeVoiceConverter.inference()
            audio_out = torch.clip(audio_out, -1.0, 1.0)

        audio_np = audio_out.float().cpu().numpy()

        # 9. volume_envelope — match output RMS to input RMS (Applio AudioProcessor.change_rms)
        # Suppresses the synthesizer's tendency to maintain a fixed output amplitude
        # profile during silence transitions, which sounds like a faint drone.
        if volume_envelope < 1.0:
            hop = sr // 2
            audio_for_rms = audio[skip_head_samples:]
            rms_src = librosa.feature.rms(y=audio_for_rms.astype(np.float32), frame_length=hop*2, hop_length=hop)
            rms_tgt = librosa.feature.rms(y=audio_np.astype(np.float32), frame_length=hop*2, hop_length=hop)
            if rms_src.size > 0 and rms_tgt.size > 0:
                rms_src_t = F.interpolate(torch.from_numpy(rms_src).float().unsqueeze(0),
                                          size=len(audio_np), mode="linear").squeeze()
                rms_tgt_t = F.interpolate(torch.from_numpy(rms_tgt).float().unsqueeze(0),
                                          size=len(audio_np), mode="linear").squeeze()
                rms_tgt_t = torch.clamp(rms_tgt_t, min=1e-6)
                gain = (rms_src_t.pow(1.0 - volume_envelope) * rms_tgt_t.pow(volume_envelope - 1.0)).numpy()
                audio_np = audio_np * gain

        # 10. Resample model_sr → input sr
        if self.model_sr != sr:
            audio_np = resample_poly(audio_np, sr, self.model_sr).astype(np.float32)

        # The output corresponds to `return_length * 160` samples at 16kHz.
        # At `sr`, it should be `target_len = len(audio) - skip_head_samples`.
        target_len = len(audio) - skip_head_samples
        if len(audio_np) > target_len:
            audio_np = audio_np[:target_len]
        elif len(audio_np) < target_len:
            audio_np = np.pad(audio_np, (0, target_len - len(audio_np)))

        return audio_np.astype(np.float32)

    # ── Public chunk inference (called by engine) ─────────────────────────────

    def infer_chunk(self, audio: np.ndarray, sr: int = 44100, f0_method: Optional[str] = None,
                    protect: float = 0.33, volume_envelope: float = 1.0) -> np.ndarray:
        """Real-time chunk inference with SOLA overlap-add.

        Ported from Applio rvc/realtime/core.py VoiceChanger.process_audio().

        SOLA (Synchronization by Overlap-Add) replaces the simple linear crossfade.
        It finds the best alignment offset between the new output and the stored
        overlap buffer by cross-correlation, then applies sin² fade-in/fade-out
        windows.  This eliminates phase discontinuities at chunk boundaries that
        were producing the 750 Hz inter-chunk tonal artefacts.
        """
        if not self.is_loaded or not self.realtime_ready:
            return audio.astype(np.float32, copy=False)

        start = time.perf_counter()
        block_size = len(audio)

        with self._lock:
            overlap = max(1, min(int(sr * self.crossfade_ms / 1000), block_size // 2))
            sola_search = max(1, sr // 100)   # ~10 ms search window
            extra = int(sr * self.extra_context_s)  # left-context for HuBERT/vocoder stability

            context_size = extra + overlap + sola_search

            if self._input_tail_cache.size < context_size:
                # pad with zeros if we don't have enough history yet
                self._input_tail_cache = np.zeros(context_size, dtype=np.float32)
                
            window_in = np.concatenate([self._input_tail_cache[-context_size:], audio.astype(np.float32)])
            
            # Save raw input tail before inference — used next iteration
            input_tail_for_next = window_in[-context_size:].copy()

            try:
                converted = self._neural_infer(window_in, sr, skip_head_samples=extra,
                                               protect=protect, volume_envelope=volume_envelope)
            except Exception as exc:
                logger.error("Neural infer error: %s", exc, exc_info=True)
                # Fallback: skip the extra context so lengths align
                converted = window_in[extra:].copy()

            # The vocoder output corresponds to the end of window_in, starting after `extra`.
            # Its target length should be `overlap + sola_search + block_size`.
            need = overlap + sola_search + block_size
            if len(converted) < need:
                converted = np.pad(converted, (0, need - len(converted)))

            # ── SOLA alignment (Applio VoiceChanger.process_audio) ───────────
            # Cross-correlate the overlap region of new output with sola_buffer
            # to find the best phase-aligned offset before crossfading.
            # This is the core fix for inter-chunk discontinuities.
            search_region = converted[:overlap + sola_search].astype(np.float64)
            if self._sola_buffer.size == overlap:
                nom = np.correlate(search_region, self._sola_buffer.astype(np.float64))
                den = np.sqrt(
                    np.convolve(search_region ** 2, np.ones(overlap), mode='valid') + 1e-8
                )
                ratio = nom / den
                sola_offset = int(np.argmax(ratio))
            else:
                sola_offset = 0

            # Trim converted to start at the best aligned offset
            converted = converted[sola_offset:]
            if len(converted) < block_size + overlap:
                converted = np.pad(converted, (0, block_size + overlap - len(converted)))

            # ── sin² fade-in / fade-out windows (Applio generate_strength) ──
            t = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
            fade_in  = np.sin(0.5 * np.pi * t) ** 2
            fade_out = 1.0 - fade_in

            is_onset = not np.any(self._sola_buffer)
            if is_onset:
                # Onset: find first energy and apply sin² fade-in from that point
                hop = max(1, sr // 300)   # ~3.3 ms hops
                n_hops = block_size // hop
                if n_hops >= 1:
                    hop_energy = np.abs(converted[:n_hops * hop].reshape(n_hops, hop)).max(axis=1)
                    peak = hop_energy.max()
                    onset_sample = 0
                    if peak > 1e-4:
                        above = np.where(hop_energy > 0.1 * peak)[0]
                        if len(above) > 0:
                            onset_sample = int(above[0]) * hop
                else:
                    onset_sample = 0
                converted[:onset_sample] = 0.0
                fade_len = min(block_size - onset_sample, overlap)
                if fade_len > 0:
                    converted[onset_sample:onset_sample + fade_len] *= fade_in[:fade_len]
            else:
                converted[:overlap] = (converted[:overlap] * fade_in
                                       + self._sola_buffer * fade_out)

            # Extract block output and store new SOLA buffer
            output = converted[:block_size].astype(np.float32)

            # Hard-clip to ±0.98 (Applio torch.clip(-1, 1) + safety margin)
            output = np.clip(output, -0.98, 0.98)



            # Store INPUT tail for next chunk's context window (not output audio)
            self._input_tail_cache = input_tail_for_next
            # Store SOLA buffer from the converted output (used for crossfade overlap)
            tail_start = block_size
            self._sola_buffer = converted[tail_start:tail_start + overlap].copy()
            if len(self._sola_buffer) < overlap:
                self._sola_buffer = np.pad(self._sola_buffer,
                                           (0, overlap - len(self._sola_buffer)))

        self._last_infer_ms = (time.perf_counter() - start) * 1000
        return output

    # ── end of RVCPipeline ────────────────────────────────────────────────────
