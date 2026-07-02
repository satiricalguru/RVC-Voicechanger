/**
 * backend-api.ts — helper for communication with the Python FastAPI backend.
 */

import { Voice, AudioDevice, VoiceChangerConfig, EngineStatus } from "./types";


let backendPort: number | null = null;

async function getBaseUrl(): Promise<string> {
  if (backendPort) return `http://127.0.0.1:${backendPort}`;
  if (typeof window !== "undefined" && window.electronAPI) {
    backendPort = await window.electronAPI.getBackendPort();
    return `http://127.0.0.1:${backendPort}`;
  }
  // Fallback for browser-only development
  return "http://127.0.0.1:8000";
}

/** Exported so page.tsx can build URLs without duplicating logic. */
export async function getApiBaseUrl(): Promise<string> {
  return getBaseUrl();
}

export async function fetchVoices(): Promise<Voice[]> {
  try {
    const base = await getBaseUrl();
    const res = await fetch(`${base}/api/voices`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error("fetchVoices error", e);
    return [];
  }
}

export async function deleteVoiceModel(voiceId: string): Promise<boolean> {
  try {
    const base = await getBaseUrl();
    const res = await fetch(`${base}/api/model/${voiceId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return !!data.ok;
  } catch (e) {
    console.error("deleteVoiceModel error", e);
    return false;
  }
}

export async function fetchDevices(): Promise<AudioDevice[]> {
  try {
    const base = await getBaseUrl();
    const res = await fetch(`${base}/api/devices`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw.map((d: any) => ({
      index: d.index,
      name: d.name,
      channels: Math.max(d.maxInputChannels || 0, d.maxOutputChannels || 0),
    }));
  } catch (e) {
    console.error("fetchDevices error", e);
    return [];
  }
}

export async function fetchConfig(): Promise<Partial<VoiceChangerConfig> | null> {
  try {
    const base = await getBaseUrl();
    const res = await fetch(`${base}/api/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return mapBackendToFrontend(raw);
  } catch (e) {
    console.error("fetchConfig error", e);
    return null;
  }
}

export async function updateBackendConfig(patch: Partial<VoiceChangerConfig>) {
  try {
    const base = await getBaseUrl();
    const mapped = mapFrontendToBackend(patch);
    const res = await fetch(`${base}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mapped),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error("updateBackendConfig error", e);
  }
}

/**
 * Creates a WebSocket to the backend with automatic exponential-backoff reconnect.
 *
 * Returns the initial WebSocket instance.  When the connection drops (backend
 * restart, audio device crash, etc.) a new socket is created internally and
 * `onReconnect` is called with the new instance so the caller can update any
 * stored reference.
 *
 * Call `ws.__stopReconnect?.()` before closing to prevent reconnect attempts
 * during intentional shutdown (e.g. component unmount).
 */
export function createBackendWS(
  onMessage: (data: any) => void,
  onReconnect?: (ws: WebSocket) => void
): WebSocket {
  let stopped = false;
  let retryDelay = 1000;

  function buildWS(): WebSocket {
    const port = backendPort ?? 8000;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    // Expose a stop handle so callers can prevent reconnect on intentional close
    (ws as any).__stopReconnect = () => { stopped = true; };

    ws.onopen = () => {
      retryDelay = 1000; // reset backoff on successful connect
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "vu_update" || data.type === "status") {
          // Merge original snake_case + mapped camelCase so both work
          onMessage({ ...data, ...mapBackendToFrontend(data) });
        } else if (data.type === "init") {
          // Map the nested config and status objects separately
          onMessage({
            type: "init",
            config: data.config ? mapBackendToFrontend(data.config) : null,
            status: data.status ? mapBackendToFrontend(data.status) : null,
          });
        } else {
          onMessage(data);
        }
      } catch (e) {
        console.error("WS parse error", e);
      }
    };

    ws.onerror = (e) => console.error("WS error", e);

    ws.onclose = () => {
      if (!stopped) {
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 30_000); // cap at 30s
        console.info(`[WS] reconnecting in ${delay}ms…`);
        setTimeout(() => {
          if (!stopped) {
            const newWs = buildWS();
            onReconnect?.(newWs);
          }
        }, delay);
      }
    };

    return ws;
  }

  return buildWS();
}

// ── Field-name maps ──────────────────────────────────────────────────────────

function mapBackendToFrontend(raw: any): any {
  const mapping: Record<string, string> = {
    // Config / routing
    selected_voice:        "selectedVoiceId",
    input_device:          "inputDeviceIndex",
    output_device:         "outputDeviceIndex",
    monitor_device:        "monitorDeviceIndex",

    // Levels (frontend-persisted via backend)
    input_volume:          "inputVolume",
    output_volume:         "outputVolume",
    monitor_mix:           "monitorMix",

    // Voice tuning
    pitch_semitones:       "pitchSemitones",
    reverb_room:           "reverb",
    reverb_damping:        "reverbDamping",
    noise_gate_db:         "noiseGateDb",
    compressor_ratio:      "compressorRatio",
    index_rate:            "indexRate",
    protect:               "protect",

    // Toggles
    hear_myself:           "hearMyself",
    voice_changer_enabled: "voiceChangerEnabled",

    // Engine / audio
    sample_rate:           "sampleRate",
    buffer_size:           "bufferSize",
    rvc_f0_method:         "f0Method",
    rvc_mode:              "mode",

    // Chunk size — two possible keys (config uses rvc_chunk_ms, status uses chunk_ms)
    rvc_chunk_ms:          "chunkMs",
    chunk_ms:              "chunkMs",

    // Status fields
    vu_in:                 "vuIn",
    vu_out:                "vuOut",
    latency_ms:            "latencyMs",
    rvc_infer_ms:          "inferMs",
    queue_drops:           "drops",
    is_running:            "isRunning",
    loaded_voice_id:       "loadedVoiceId",
    loading_voice_id:      "loadingVoiceId",
    voice_load_error:      "voiceLoadError",
  };

  const result: any = {};
  for (const key in raw) {
    const mappedKey = mapping[key] ?? key;
    result[mappedKey] = raw[key];
  }
  return result;
}

function mapFrontendToBackend(patch: any): any {
  const mapping: Record<string, string> = {
    // Config / routing
    selectedVoiceId:       "selected_voice",
    inputDeviceIndex:      "input_device",
    outputDeviceIndex:     "output_device",
    monitorDeviceIndex:    "monitor_device",

    // Levels
    inputVolume:           "input_volume",
    outputVolume:          "output_volume",
    monitorMix:            "monitor_mix",

    // Voice tuning
    pitchSemitones:        "pitch_semitones",
    reverb:                "reverb_room",
    reverbDamping:         "reverb_damping",
    noiseGateDb:           "noise_gate_db",
    compressorRatio:       "compressor_ratio",
    indexRate:             "index_rate",
    protect:               "protect",

    // Toggles
    hearMyself:            "hear_myself",
    voiceChangerEnabled:   "voice_changer_enabled",

    // Engine / audio
    sampleRate:            "sample_rate",
    bufferSize:            "buffer_size",
    f0Method:              "rvc_f0_method",
    mode:                  "rvc_mode",
    chunkMs:               "rvc_chunk_ms",
  };

  const result: any = {};
  for (const key in patch) {
    const mappedKey = mapping[key] ?? key;
    result[mappedKey] = patch[key];
  }
  return result;
}
