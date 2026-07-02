"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { TitleBar } from "@/components/voice-changer/title-bar"
import { Sidebar, type AppView } from "@/components/voice-changer/sidebar"
import { VoiceGrid } from "@/components/voice-changer/voice-grid"
import { Inspector } from "@/components/voice-changer/inspector"
import { BottomBar } from "@/components/voice-changer/bottom-bar"
import { UploadDialog } from "@/components/voice-changer/upload-dialog"
import { SettingsView } from "@/components/voice-changer/settings-view"
import { VoiceLabView } from "@/components/voice-changer/voicelab-view"
import { Toaster } from "@/components/ui/sonner"
import { toast } from "sonner"
import {
  DEFAULT_CONFIG,
  VOICES,
} from "@/lib/voice-changer/mock-data"
import type {
  EngineStatus,
  Voice,
  VoiceChangerConfig,
  AudioDevice,
} from "@/lib/voice-changer/types"
import {
  fetchVoices,
  fetchDevices,
  fetchConfig,
  updateBackendConfig,
  createBackendWS,
  getApiBaseUrl,
  deleteVoiceModel,
  uploadVoiceModelFile,
  importVoiceModelPaths,
} from "@/lib/voice-changer/backend-api"

/**
 * Main shell — purely client-side.
 * In the real Electron+FastAPI app this composes a WebSocket to the Python
 * backend. Here we simulate engine telemetry locally so the UI feels alive.
 */
export default function Page() {
  /* ── State ────────────────────────────────────────────────────────────── */
  const [config, setConfig] = useState<VoiceChangerConfig>(DEFAULT_CONFIG)
  const [voices, setVoices] = useState<Voice[]>(VOICES)
  const [view, setView] = useState<AppView>("voicebox")
  const [category, setCategory] = useState("All")
  const [uploadOpen, setUploadOpen] = useState(false)

  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [monitorDevices, setMonitorDevices] = useState<AudioDevice[]>([])

  const [status, setStatus] = useState<EngineStatus>({
    isRunning: false,
    mode: "ai",
    loadedVoiceId: "original",
    loadingVoiceId: null,
    voiceLoadError: null,
    latencyMs: 0,
    inferMs: 0,
    chunkMs: 256,
    vuIn: 0,
    vuOut: 0,
    drops: 0,
    sampleRate: 48000,
    bufferSize: 512,
  })

  /* ── Derived ──────────────────────────────────────────────────────────── */
  const filteredVoices = useMemo(() => {
    if (category === "All") return voices
    if (category === "Favorites") return voices.filter((v) => v.isFavorite)
    if (category === "My Voices") return voices.filter((v) => v.source === "custom")
    return voices.filter((v) => v.category === category)
  }, [voices, category])

  const dynamicCategories = useMemo(() => {
    const set = new Set<string>()
    voices.forEach((v) => set.add(v.category))
    return Array.from(set)
  }, [voices])

  const selectedVoice = voices.find((v) => v.id === config.selectedVoiceId) ?? null

  /* ── Engine simulation ────────────────────────────────────────────────── */
  /* ── Backend Integration ─────────────────────────────────────────────── */
  const wsRef = useRef<WebSocket | null>(null)

  const refreshData = useCallback(async () => {
    try {
      const [v, d, c] = await Promise.all([fetchVoices(), fetchDevices(), fetchConfig()])
      if (v && v.length > 0) setVoices(v)
      if (d && d.length > 0) {
        setInputDevices(d.filter((dev) => dev.channels > 0))
        setOutputDevices(d.filter((dev) => dev.channels > 0))
        setMonitorDevices(d.filter((dev) => dev.channels > 0))
      }
      // Merge — never replace — so frontend-only fields (inputVolume, outputVolume,
      // monitorMix, monitorDeviceIndex) always fall back to DEFAULT_CONFIG values.
      if (c) setConfig((prev) => ({ ...prev, ...c }))
    } catch (err) {
      console.error("Failed to fetch initial data", err)
    }
  }, [])

  useEffect(() => {
    refreshData().then(() => {
      const ws = createBackendWS(
        (data) => {
          if (data.type === "vu_update" || data.type === "status") {
            setStatus((prev) => ({ ...prev, ...data }))
          } else if (data.type === "init") {
            // Backend sends full config + status on connect — merge both
            if (data.config) setConfig((prev) => ({ ...prev, ...data.config }))
            if (data.status) setStatus((prev) => ({ ...prev, ...data.status }))
          } else if (data.type === "models_refreshed") {
            fetchVoices().then(setVoices)
          } else if (data.type === "voice_selected") {
            setStatus((s) => ({ ...s, loadedVoiceId: data.voice_id }))
          }
        },
        // onReconnect: keep wsRef pointing at the live socket after reconnects
        (newWs) => { wsRef.current = newWs }
      )
      wsRef.current = ws
    })

    return () => {
      // Signal the reconnect loop to stop before closing
      ;(wsRef.current as any)?.__stopReconnect?.()
      wsRef.current?.close()
    }
  }, [refreshData])

  /* ── Handlers ─────────────────────────────────────────────────────────── */
  const updateConfig = (patch: Partial<VoiceChangerConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }))
    // Notify the user when the engine auto-starts because hear_myself was enabled
    if (patch.hearMyself === true && !status.isRunning) {
      toast("Engine starting for monitoring…", {
        description: "Set your monitor device in Settings → Devices for best results.",
      })
    }
    updateBackendConfig(patch)
  }

  const handleSelectVoice = useCallback(
    (voice: Voice) => {
      if (voice.id === config.selectedVoiceId) return
      setConfig((c) => ({ ...c, selectedVoiceId: voice.id }))
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "select_voice", value: voice.id }))
      }
    },
    [config.selectedVoiceId]
  )

  const toggleFavorite = async (id: string) => {
    try {
      const base = await getApiBaseUrl()
      await fetch(`${base}/api/favorite/${id}`, { method: "POST" })
      setVoices((vs) =>
        vs.map((v) => (v.id === id ? { ...v, isFavorite: !v.isFavorite } : v))
      )
    } catch (err) {
      console.error("Favorite error", err)
    }
  }

  const togglePower = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const type = status.isRunning ? "stop_changer" : "start_changer"
      wsRef.current.send(JSON.stringify({ type }))
    }
  }
  const handleUpload = async ({
    name,
    pthFile,
    pthPath,
    indexFile,
    indexPath,
  }: {
    name: string
    pthFile?: File
    pthPath?: string
    indexFile?: File
    indexPath?: string
  }) => {
    if (pthPath) {
      await importVoiceModelPaths(pthPath, indexPath || null, name)
    } else if (pthFile) {
      await uploadVoiceModelFile(pthFile, indexFile || null, name)
    } else {
      throw new Error("No model file selected.")
    }

    const updated = await fetchVoices()
    if (updated && updated.length > 0) setVoices(updated)

    const displayName = name || pthFile?.name.replace(/\.pth$/i, "") || pthPath?.split(/[\\/]/).pop()?.replace(/\.pth$/i, "") || ""
    const safeName = displayName.replace(/\s+/g, "_")
    const newVoice =
      updated?.find((v) => v.id === `custom_${safeName}`) ??
      updated?.find((v) => v.source === "custom" && v.name === displayName) ??
      null

    if (newVoice) {
      setConfig((c) => ({ ...c, selectedVoiceId: newVoice.id }))
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "select_voice", value: newVoice.id }))
      }
    }

    toast.success("Model imported", {
      description: `${displayName} is now in My Voices.`,
    })
  }
  const handleDeleteVoice = async (id: string) => {
    const voice = voices.find((v) => v.id === id)
    if (!voice) return
    if (confirm(`Are you sure you want to delete "${voice.name}"?`)) {
      try {
        const ok = await deleteVoiceModel(id)
        if (ok) {
          toast.success("Model deleted successfully")
          if (config.selectedVoiceId === id) {
            const orig = voices.find((v) => v.id === "original") || voices[0]
            handleSelectVoice(orig)
          }
          const updated = await fetchVoices()
          if (updated && updated.length > 0) setVoices(updated)
        } else {
          toast.error("Failed to delete model")
        }
      } catch (err) {
        console.error("Delete error", err)
        toast.error("An error occurred while deleting the model")
      }
    }
  }

  /* ── Hotkeys ──────────────────────────────────────────────────────────── */
  // Use refs so the keydown handler always sees fresh state without re-registering
  const filteredVoicesRef = useRef(filteredVoices)
  filteredVoicesRef.current = filteredVoices
  const handleSelectVoiceRef = useRef(handleSelectVoice)
  handleSelectVoiceRef.current = handleSelectVoice
  const togglePowerRef = useRef(togglePower)
  togglePowerRef.current = togglePower

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return
      if (e.code === "Space") {
        e.preventDefault()
        togglePowerRef.current()
      } else if (e.metaKey && e.key === ",") {
        e.preventDefault()
        setView("settings")
      } else if (e.key === "m" || e.key === "M") {
        if (!e.metaKey) {
          e.preventDefault()
          setConfig((c) => ({ ...c, voiceChangerEnabled: !c.voiceChangerEnabled }))
        }
      } else if (!e.metaKey && /^[1-9]$/.test(e.key)) {
        const v = filteredVoicesRef.current[Number(e.key) - 1]
        if (v) handleSelectVoiceRef.current(v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, []) // stable — all mutable values accessed via refs

  /* ── Render ──────────────────────────────────────────────────────────── */
  const loadedVoice = voices.find((v) => v.id === status.loadedVoiceId) ?? null

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
      <TitleBar
        onImport={() => setUploadOpen(true)}
        onHideToTray={() => toast("Hidden to tray", { description: "Still running in the background" })}
        isLive={status.isRunning}
        latencyMs={status.latencyMs}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          currentView={view}
          setView={setView}
          currentCategory={category}
          setCategory={setCategory}
          categories={dynamicCategories}
          mode={config.mode}
          latencyMs={status.latencyMs}
          chunkMs={status.chunkMs}
          loadedVoiceName={loadedVoice?.name ?? null}
          onImport={() => setUploadOpen(true)}
        />

        <main className="min-w-0 flex-1 overflow-hidden p-4">
          {view === "voicebox" && (
            <VoiceGrid
              voices={filteredVoices}
              selectedId={config.selectedVoiceId}
              loadingId={status.loadingVoiceId}
              loadedId={status.loadedVoiceId}
              category={category}
              onSelect={handleSelectVoice}
              onToggleFavorite={toggleFavorite}
              onImport={() => setUploadOpen(true)}
              onDeleteVoice={handleDeleteVoice}
              onCategoryChange={setCategory}
              totalCount={voices.length}
              latencyMs={status.latencyMs}
              inferMs={status.inferMs}
            />
          )}
          {view === "voicelab" && (
            <VoiceLabView
              selectedVoice={selectedVoice}
              status={status}
              config={config}
              onChange={updateConfig}
              onPreview={togglePower}
            />
          )}
          {view === "settings" && (
            <SettingsView
              config={config}
              onChange={updateConfig}
              inputDevices={inputDevices}
              outputDevices={outputDevices}
              monitorDevices={monitorDevices}
              drops={status.drops}
              onRescanDevices={refreshData}
              onDownloadRmvpe={async () => {
                const base = await getApiBaseUrl()
                fetch(`${base}/api/download-rmvpe`, { method: "POST" })
                toast("Downloading RMVPE weights…")
              }}
            />
          )}
        </main>

        <Inspector
          selectedVoice={selectedVoice}
          status={status}
          config={config}
          onChange={updateConfig}
        />
      </div>

      <BottomBar
        isLive={status.isRunning}
        onTogglePower={togglePower}
        hearMyself={config.hearMyself}
        onHearMyselfChange={(v) => updateConfig({ hearMyself: v })}
        voiceChangerEnabled={config.voiceChangerEnabled}
        onVoiceChangerChange={(v) => updateConfig({ voiceChangerEnabled: v })}
        vuIn={status.vuIn}
        vuOut={status.vuOut}
        drops={status.drops}
      />

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUpload={handleUpload} />

      <Toaster
        position="bottom-center"
        theme="dark"
        toastOptions={{
          classNames: {
            toast:
              "!bg-zinc-950 !border-white/10 !text-white !rounded-lg !font-sans",
            description: "!text-white/55",
          },
        }}
      />
    </div>
  )
}
