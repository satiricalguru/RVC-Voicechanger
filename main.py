"""
AiVoiceChanger backend server for Electron and browser-based development.
"""

import argparse
import asyncio
import json
import logging
import signal
import socket
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from app.backend.config_manager import ConfigManager
from app.backend.engine import AudioEngine
from app.backend.models_manager import ModelsManager
from app.backend.rvc_pipeline import RVCPipeline

# Resolve directories relative to THIS FILE, not the process CWD.
# When Electron spawns Python with cwd=APP_ROOT the paths are the same, but
# resolving from __file__ guarantees correctness even if CWD drifts.
SCRIPT_DIR   = Path(__file__).resolve().parent
FRONTEND_DIR = SCRIPT_DIR / "app" / "frontend"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")

parser = argparse.ArgumentParser(description="AiVoiceChanger backend server")
parser.add_argument("--port", type=int, default=0, help="Port to bind (0 = auto)")
parser.add_argument("--host", type=str, default="127.0.0.1")
parser.add_argument("--debug", action="store_true")
args, _ = parser.parse_known_args()

config = ConfigManager()
rvc = RVCPipeline()
engine = AudioEngine(rvc_pipeline=rvc)
models = ModelsManager("models")

engine.sample_rate = config.get("sample_rate", 48000)
engine.buffer_size = config.get("buffer_size", 512)
engine.hear_myself = config.get("hear_myself", False)
engine.voice_changer_enabled = config.get("voice_changer_enabled", True)
engine.rvc_mode = config.get("rvc_mode", "dsp")
engine.set_pitch(config.get("pitch_semitones", 0))
engine.set_reverb(config.get("reverb_room", 0.1), config.get("reverb_damping", 0.5))
engine.set_noise_gate(config.get("noise_gate_db", -40))
engine.set_compressor(config.get("compressor_ratio", 4.0))
engine.set_input_volume(config.get("input_volume", 100))
engine.set_output_volume(config.get("output_volume", 100))
engine.set_monitor_mix(config.get("monitor_mix", 35))
rvc.index_rate = config.get("index_rate", 0.75)
rvc.protect = config.get("protect", 0.33)
rvc.filter_radius = config.get("filter_radius", 3)
rvc.set_f0_method(config.get("rvc_f0_method", "fcpe"))
rvc.set_chunk_ms(config.get("rvc_chunk_ms", 256))
if config.get("input_device") is not None:
    engine.input_device_idx = config.get("input_device")
if config.get("output_device") is not None:
    engine.output_device_idx = config.get("output_device")
if config.get("monitor_device") is not None:
    engine.monitor_device_idx = config.get("monitor_device")

selected_voice = config.get("selected_voice", "original")
engine.select_voice(
    selected_voice,
    models.get_voice_by_id(selected_voice),
    preferred_mode="dsp" if selected_voice == "original" else config.get("rvc_mode", "ai"),
)

active_connections: set[WebSocket] = set()

_UPLOAD_MAX_BYTES = 500 * 1024 * 1024  # 500 MB hard limit for model uploads


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("", 0))
        return sock.getsockname()[1]


async def broadcast(payload: dict):
    if not active_connections:
        return
    text = json.dumps(payload)
    dead = []
    for ws in list(active_connections):  # snapshot — safe against concurrent add/remove
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_connections.discard(ws)


async def vu_broadcast_loop():
    while True:
        await asyncio.sleep(1 / 30)
        if active_connections:
            status = engine.get_status()
            await broadcast({"type": "vu_update", **status})


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(vu_broadcast_loop())
    yield
    engine.stop()


app = FastAPI(title="RVC Voicechanger", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static images directory for voice models
images_dir = Path("models/images")
images_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/images", StaticFiles(directory=str(images_dir)), name="images")


@app.get("/api/voices")
async def get_voices():
    favorites = config.get("favorites", [])
    selected = config.get("selected_voice", "original")
    voices = models.get_voice_list()
    for voice in voices:
        voice["is_favorite"] = voice["id"] in favorites
        voice["active"] = voice["id"] == selected
    return JSONResponse(content=voices)


@app.get("/api/devices")
async def get_devices():
    return JSONResponse(content=engine.get_devices())


@app.get("/api/config")
async def get_config():
    return JSONResponse(content=config.all())


@app.get("/api/status")
async def get_status():
    return JSONResponse(content=engine.get_status())


@app.post("/api/config")
async def update_config(data: dict):
    config.update(data)
    # Live-apply engine-relevant fields if they arrive via the REST endpoint
    # (the WS handlers do this too, but Settings panel uses REST)
    if "pitch_semitones" in data:
        engine.set_pitch(float(data["pitch_semitones"]))
    if "reverb_room" in data or "reverb_damping" in data:
        engine.set_reverb(
            float(data.get("reverb_room", config.get("reverb_room", 0.1))),
            float(data.get("reverb_damping", config.get("reverb_damping", 0.5))),
        )
    if "noise_gate_db" in data:
        engine.set_noise_gate(float(data["noise_gate_db"]))
    if "compressor_ratio" in data:
        engine.set_compressor(float(data["compressor_ratio"]))
    if "index_rate" in data:
        rvc.index_rate = float(data["index_rate"])
    if "protect" in data:
        rvc.protect = float(data["protect"])
    if "input_volume" in data:
        engine.set_input_volume(float(data["input_volume"]))
    if "output_volume" in data:
        engine.set_output_volume(float(data["output_volume"]))
    if "monitor_mix" in data:
        engine.set_monitor_mix(float(data["monitor_mix"]))
    if "monitor_device" in data:
        engine.set_monitor_device(data["monitor_device"])
        config.set("monitor_device", None if data["monitor_device"] in ("", None) else int(data["monitor_device"]))
    if "hear_myself" in data:
        engine.set_hear_myself(bool(data["hear_myself"]))
    if "voice_changer_enabled" in data:
        engine.set_voice_changer(bool(data["voice_changer_enabled"]))
    if "rvc_mode" in data:
        engine.set_rvc_mode(str(data["rvc_mode"]))
    if "rvc_f0_method" in data:
        rvc.set_f0_method(str(data["rvc_f0_method"]))
    if "rvc_chunk_ms" in data:
        rvc.set_chunk_ms(int(data["rvc_chunk_ms"]))
        engine._reset_ai_buffers()
    if "sample_rate" in data:
        engine.set_sample_rate(int(data["sample_rate"]))
    if "buffer_size" in data:
        engine.set_buffer_size(int(data["buffer_size"]))
    if "input_device" in data:
        engine.set_input_device(data["input_device"])
    if "output_device" in data:
        engine.set_output_device(data["output_device"])
    return JSONResponse(content={"ok": True})


@app.post("/api/favorite/{voice_id}")
async def toggle_favorite(voice_id: str):
    if config.is_favorite(voice_id):
        config.remove_favorite(voice_id)
        return JSONResponse({"is_favorite": False})
    config.add_favorite(voice_id)
    return JSONResponse({"is_favorite": True})


@app.post("/api/upload-model")
async def upload_model(
    pth_file: UploadFile = File(...),
    index_file: Optional[UploadFile] = File(None),
    model_name: str = Form(default=""),
):
    try:
        pth_bytes = await pth_file.read()
        if len(pth_bytes) > _UPLOAD_MAX_BYTES:
            return JSONResponse(
                content={"ok": False, "error": f"Model file exceeds the 500 MB limit ({len(pth_bytes) // 1024 // 1024} MB)"},
                status_code=413,
            )
        index_bytes = await index_file.read() if index_file and index_file.filename else None
        voice = models.save_custom_model(
            pth_bytes=pth_bytes,
            pth_name=model_name or pth_file.filename or "custom_model",
            index_bytes=index_bytes,
            index_name=index_file.filename if index_file else None,
        )
        await broadcast({"type": "models_refreshed"})
        return JSONResponse(content={"ok": True, "voice": voice})
    except Exception as exc:
        logger.error("Upload error: %s", exc, exc_info=True)
        return JSONResponse(content={"ok": False, "error": str(exc)}, status_code=500)


@app.post("/api/import-model-paths")
async def import_model_paths(data: dict):
    pth_path = data.get("pth_path")
    if not pth_path:
        return JSONResponse(content={"ok": False, "error": "pth_path is required"}, status_code=400)
    try:
        voice = models.import_model_files(
            pth_path=pth_path,
            index_path=data.get("index_path"),
            model_name=data.get("model_name"),
        )
        await broadcast({"type": "models_refreshed"})
        return JSONResponse(content={"ok": True, "voice": voice})
    except Exception as exc:
        logger.error("Import error: %s", exc, exc_info=True)
        return JSONResponse(content={"ok": False, "error": str(exc)}, status_code=500)


@app.delete("/api/model/{voice_id}")
async def delete_model(voice_id: str):
    ok = models.delete_custom_model(voice_id)
    if ok:
        await broadcast({"type": "models_refreshed"})
    return JSONResponse(content={"ok": ok})


@app.post("/api/download-rmvpe")
async def download_rmvpe():
    def _background():
        rvc.download_rmvpe()

    threading.Thread(target=_background, daemon=True).start()
    return JSONResponse(content={"ok": True})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    await websocket.send_text(json.dumps({
        "type": "init",
        "config": config.all(),
        "status": engine.get_status(),
    }))

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "start_changer":
                try:
                    engine.start()
                    config.set("voice_changer_enabled", True)
                    await websocket.send_text(json.dumps({"type": "started"}))
                except Exception as exc:
                    await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))

            elif msg_type == "stop_changer":
                engine.stop()
                await websocket.send_text(json.dumps({"type": "stopped"}))

            elif msg_type == "select_voice":
                voice_id = msg.get("value")
                voice_data = models.get_voice_by_id(voice_id)
                preferred_mode = "dsp" if voice_id == "original" else "ai"
                engine.select_voice(voice_id, voice_data, preferred_mode=preferred_mode)
                config.set("selected_voice", voice_id)
                config.set("rvc_mode", preferred_mode)
                await websocket.send_text(json.dumps({
                    "type": "voice_selected",
                    "voice_id": voice_id,
                    "rvc_enabled": engine.rvc_enabled,
                    "backend_mode": rvc.backend_mode,
                    "status": engine.get_status(),
                }))

            elif msg_type == "set_pitch":
                value = float(msg.get("value", 0))
                engine.set_pitch(value)
                config.set("pitch_semitones", value)

            elif msg_type == "set_reverb":
                value = float(msg.get("value", 0.1))
                damping = float(msg.get("damping", 0.5))
                engine.set_reverb(value, damping)
                config.update({"reverb_room": value, "reverb_damping": damping})

            elif msg_type == "set_noise_gate":
                value = float(msg.get("value", -40))
                engine.set_noise_gate(value)
                config.set("noise_gate_db", value)

            elif msg_type == "set_compressor":
                value = float(msg.get("value", 4.0))
                engine.set_compressor(value)
                config.set("compressor_ratio", value)

            elif msg_type == "set_index_rate":
                value = float(msg.get("value", 0.75))
                rvc.index_rate = value
                config.set("index_rate", value)

            elif msg_type == "set_protect":
                value = float(msg.get("value", 0.33))
                rvc.protect = value
                config.set("protect", value)

            elif msg_type == "set_filter_radius":
                value = int(msg.get("value", 3))
                rvc.filter_radius = value
                config.set("filter_radius", value)

            elif msg_type == "set_input_volume":
                value = float(msg.get("value", 100))
                engine.set_input_volume(value)
                config.set("input_volume", value)

            elif msg_type == "set_output_volume":
                value = float(msg.get("value", 100))
                engine.set_output_volume(value)
                config.set("output_volume", value)

            elif msg_type == "set_monitor_mix":
                value = float(msg.get("value", 35))
                engine.set_monitor_mix(value)
                config.set("monitor_mix", value)

            elif msg_type == "set_monitor_device":
                value = msg.get("value")
                engine.set_monitor_device(value)
                config.set("monitor_device", None if value in ("", None) else int(value))

            elif msg_type == "set_hear_myself":
                value = bool(msg.get("value", False))
                engine.set_hear_myself(value)
                config.set("hear_myself", value)

            elif msg_type == "set_voice_changer":
                value = bool(msg.get("value", True))
                engine.set_voice_changer(value)
                config.set("voice_changer_enabled", value)

            elif msg_type == "set_rvc_mode":
                mode = "ai" if msg.get("value") == "ai" else "dsp"
                engine.set_rvc_mode(mode)
                config.set("rvc_mode", mode)

            elif msg_type == "set_input_device":
                value = msg.get("value")
                engine.set_input_device(value)
                config.set("input_device", None if value in ("", None) else int(value))

            elif msg_type == "set_output_device":
                value = msg.get("value")
                engine.set_output_device(value)
                config.set("output_device", None if value in ("", None) else int(value))

            elif msg_type == "set_sample_rate":
                value = int(msg.get("value", 44100))
                engine.set_sample_rate(value)
                config.set("sample_rate", value)

            elif msg_type == "set_buffer_size":
                value = int(msg.get("value", 512))
                engine.set_buffer_size(value)
                config.set("buffer_size", value)

            elif msg_type == "set_rvc_chunk_ms":
                value = int(msg.get("value", 256))
                rvc.set_chunk_ms(value)
                engine._reset_ai_buffers()
                config.set("rvc_chunk_ms", value)

            elif msg_type == "set_f0_method":
                value = str(msg.get("value", "fcpe"))
                rvc.set_f0_method(value)
                config.set("rvc_f0_method", value)

            elif msg_type == "complete_onboarding":
                config.set("onboarding_completed", True)

            elif msg_type == "refresh_models":
                models.refresh()
                await websocket.send_text(json.dumps({"type": "models_refreshed"}))

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as exc:
        logger.error("WebSocket error: %s", exc, exc_info=True)
    finally:
        active_connections.discard(websocket)


def _shutdown(signum, frame):
    logger.info("Received signal %s, shutting down", signum)
    engine.stop()
    raise SystemExit(0)


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)


@app.get("/{path:path}")
async def serve_frontend(path: str):
    # FRONTEND_DIR is resolved from __file__ — immune to CWD drift.
    # 1. Try to serve the exact requested file (JS chunks, CSS, images, etc.)
    file_path = FRONTEND_DIR / path
    if file_path.is_file():
        return FileResponse(str(file_path))

    # 2. Try .html extension (e.g. /settings → settings.html)
    html_path = FRONTEND_DIR / (path + ".html")
    if html_path.is_file():
        return FileResponse(str(html_path))

    # 3. SPA fallback — always serve index.html for client-side routes
    index_path = FRONTEND_DIR / "index.html"
    if index_path.is_file():
        return FileResponse(str(index_path))

    logger.warning("Frontend not found: %s (FRONTEND_DIR=%s)", path, FRONTEND_DIR)
    return JSONResponse(
        {"error": "Frontend not built. Run: cd ui && pnpm build"},
        status_code=404,
    )


def run_server(host: str, port: int):
    uvicorn.run(app, host=host, port=port, log_level="info" if args.debug else "warning")


def main():
    port = args.port if args.port else find_free_port()
    host = args.host
    thread = threading.Thread(target=run_server, args=(host, port), daemon=True, name="fastapi-server")
    thread.start()

    logger.info("Starting AiVoiceChanger backend on %s:%s", host, port)
    import urllib.request

    # Poll until uvicorn is accepting connections.
    # Python 3.14 + torch + onnxruntime cold-import can take 20–30 s on first
    # launch; 300 × 0.5 s gives a 150 s window which comfortably covers that.
    for _ in range(300):
        try:
            urllib.request.urlopen(f"http://{host}:{port}/api/status", timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    print(f"READY:{port}", flush=True)
    logger.info("Backend ready at http://%s:%s", host, port)


    thread.join()


if __name__ == "__main__":
    main()
