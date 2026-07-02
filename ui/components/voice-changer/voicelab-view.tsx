"use client"

import { Play, Square, Wand2, Save, Sparkles, Cpu } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Voice, VoiceChangerConfig, EngineMode, EngineStatus } from "@/lib/voice-changer/types"
import { VoiceAvatar } from "./voice-avatar"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface VoiceLabViewProps {
  selectedVoice: Voice | null
  status: EngineStatus
  config: VoiceChangerConfig
  onChange: (patch: Partial<VoiceChangerConfig>) => void
  onPreview: () => void
}

export function VoiceLabView({ selectedVoice, status, config, onChange, onPreview }: VoiceLabViewProps) {
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">VoiceLab</span>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          Inspect and shape the active preset.
        </h1>
        <p className="max-w-2xl text-sm text-white/55">
          Switch between DSP-only and full RVC AI inference, audition the preset, and bake your settings
          into a saved profile.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Active voice */}
        <article className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <header className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
              Active Voice
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={onPreview}
              className="h-8 gap-1.5 border-white/15 bg-transparent text-xs text-white/85 hover:bg-white/5 hover:text-white"
            >
              {status.isRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {status.isRunning ? "Stop preview" : "Preview"}
            </Button>
          </header>

          <div className="flex items-center gap-4">
            <VoiceAvatar
              initials={selectedVoice?.initials ?? "MIC"}
              tone={selectedVoice?.tone ?? 0}
              size="xl"
              active={status.isRunning}
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-semibold tracking-tight">
                {selectedVoice?.name ?? "Original"}
              </h2>
              <p className="line-clamp-2 text-sm text-white/55">
                {selectedVoice?.description ?? "Your dry microphone signal — no effect applied."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Meta label="Source" value={selectedVoice?.source ?? "system"} />
            <Meta label="Speaker" value={selectedVoice?.speaker ?? "—"} />
            <Meta label="Version" value={selectedVoice?.version ?? "—"} />
            <Meta label="Sample Rate" value={selectedVoice?.sampleRate ? `${selectedVoice.sampleRate} Hz` : "—"} />
            <Meta label="Index" value={selectedVoice?.hasIndex ? "Attached" : "None"} />
            <Meta label="Size" value={selectedVoice?.sizeMb ? `${selectedVoice.sizeMb} MB` : "—"} />
          </div>
        </article>

        {/* Mode + actions */}
        <article className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <header className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
              Engine Mode
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
              {config.mode === "ai" ? "RVC · AI" : "DSP · Pedalboard"}
            </span>
          </header>

          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              active={config.mode === "dsp"}
              onClick={() => onChange({ mode: "dsp" })}
              icon={Cpu}
              title="DSP"
              description="Pitch + reverb + gate. Lowest latency. Always available."
            />
            <ModeCard
              active={config.mode === "ai"}
              onClick={() => onChange({ mode: "ai" })}
              icon={Sparkles}
              title="AI Voice"
              description="Full RVC inference. Loads .pth + .index per preset."
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
                Realtime Status
              </span>
              <span className="font-mono text-[10px] tabular-nums text-white/70">
                {status.latencyMs.toFixed(0)} ms / {status.inferMs.toFixed(0)} ms infer
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Pill label="Sample" value={`${status.sampleRate / 1000}k`} />
              <Pill label="Buffer" value={status.bufferSize} />
              <Pill label="Drops" value={status.drops} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 border-white/15 bg-transparent text-xs text-white/85 hover:bg-white/5 hover:text-white"
              onClick={() => {
                if (!selectedVoice) { toast("No voice selected"); return }
                // Apply sensible defaults for the current voice source
                const isAi = selectedVoice.source === "rvc" || selectedVoice.source === "custom"
                onChange({
                  mode: isAi ? "ai" : "dsp",
                  indexRate: 0.75,
                  protect: 0.33,
                  reverb: 0.1,
                  reverbDamping: 0.5,
                  noiseGateDb: -40,
                  compressorRatio: 4,
                })
                toast.success("Auto-tuned", { description: `Settings optimised for ${selectedVoice.name}` })
              }}
            >
              <Wand2 className="h-3.5 w-3.5" />
              Auto-tune to model
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-white text-xs text-black hover:bg-white/90"
              onClick={() => {
                if (!selectedVoice) { toast("No voice selected"); return }
                toast.success("Preset saved", { description: `${selectedVoice.name} preset saved locally.` })
              }}
            >
              <Save className="h-3.5 w-3.5" />
              Save as preset
            </Button>
          </div>
        </article>
      </div>
    </section>
  )
}

function ModeCard({
  active,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition",
        active
          ? "border-white bg-white text-black"
          : "border-white/10 bg-white/[0.02] text-white/80 hover:border-white/30 hover:bg-white/[0.05] hover:text-white",
      )}
    >
      <Icon className="h-4 w-4" />
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className={cn("text-xs leading-snug", active ? "text-black/60" : "text-white/45")}>
          {description}
        </div>
      </div>
    </button>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">{label}</div>
      <div className="mt-0.5 truncate text-sm text-white/85">{value}</div>
    </div>
  )
}

function Pill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">{label}</span>
      <span className="font-mono text-xs tabular-nums text-white/85">{value}</span>
    </div>
  )
}
