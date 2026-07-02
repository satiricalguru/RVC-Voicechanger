"use client"

import { Slider } from "@/components/ui/slider"
import { Activity, AlertTriangle, CheckCircle2, Loader2, Volume2, Mic } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Voice, VoiceChangerConfig, EngineStatus } from "@/lib/voice-changer/types"
import { VoiceAvatar } from "./voice-avatar"

interface InspectorProps {
  selectedVoice: Voice | null
  status: EngineStatus
  config: VoiceChangerConfig
  onChange: (patch: Partial<VoiceChangerConfig>) => void
}

export function Inspector({ selectedVoice, status, config, onChange }: InspectorProps) {
  const loadState = status.voiceLoadError
    ? { icon: AlertTriangle, label: status.voiceLoadError, tone: "warn" as const }
    : status.loadingVoiceId
      ? { icon: Loader2, label: "Loading model…", tone: "info" as const, spin: true }
      : status.loadedVoiceId
        ? { icon: CheckCircle2, label: "Model loaded", tone: "ok" as const }
        : { icon: Activity, label: "No model loaded", tone: "muted" as const }

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col gap-3 border-l border-white/10 bg-black p-3">
      {/* Live voice card */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
            Live Voice
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                status.isRunning ? "bg-white" : "bg-white/30",
              )}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
              {status.isRunning ? "Live" : "Idle"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <VoiceAvatar
            initials={selectedVoice?.initials ?? "MIC"}
            tone={selectedVoice?.tone ?? 0}
            size="lg"
            active={status.isRunning}
            image={selectedVoice?.image}
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold">{selectedVoice?.name ?? "Original"}</h3>
            <p className="truncate text-xs text-white/50">
              {selectedVoice?.category ?? "—"}
              {selectedVoice?.speaker && <> · {selectedVoice.speaker}</>}
            </p>
            <div className="mt-1 font-mono text-[10px] tabular-nums text-white/40">
              {status.latencyMs.toFixed(0)} ms · {status.inferMs.toFixed(0)} ms infer
            </div>
          </div>
        </div>

        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs",
            loadState.tone === "ok" && "border-white/15 bg-white/5 text-white/85",
            loadState.tone === "info" && "border-white/15 bg-white/5 text-white/70",
            loadState.tone === "warn" && "border-amber-200/30 bg-amber-200/[0.04] text-amber-100",
            loadState.tone === "muted" && "border-white/10 bg-white/[0.02] text-white/50",
          )}
        >
          <loadState.icon className={cn("h-3.5 w-3.5", loadState.spin && "animate-spin")} />
          <span className="truncate">{loadState.label}</span>
        </div>
      </div>

      {/* Voice tuning */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <SectionHeader>Voice Tuning</SectionHeader>
        <SliderRow
          label="Pitch"
          unit="st"
          format={(v) => (v > 0 ? `+${v}` : `${v}`)}
          value={config.pitchSemitones}
          min={-24}
          max={24}
          step={1}
          onChange={(v) => onChange({ pitchSemitones: v })}
        />
        <SliderRow
          label="Index Strength"
          value={config.indexRate}
          min={0}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => onChange({ indexRate: v })}
        />
        <SliderRow
          label="Protect"
          value={config.protect}
          min={0}
          max={0.5}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => onChange({ protect: v })}
        />
        <SliderRow
          label="Reverb"
          value={config.reverb}
          min={0}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => onChange({ reverb: v })}
        />
        <SliderRow
          label="Noise Gate"
          unit="dB"
          value={config.noiseGateDb}
          min={-90}
          max={0}
          step={1}
          format={(v) => `${v}`}
          onChange={(v) => onChange({ noiseGateDb: v })}
        />
        <SliderRow
          label="Compressor"
          unit="x"
          value={config.compressorRatio}
          min={1}
          max={20}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => onChange({ compressorRatio: v })}
        />

        <div className="mt-5">
          <SectionHeader>Levels</SectionHeader>
          <SliderRow
            icon={Mic}
            label="Input Volume"
            unit="%"
            value={config.inputVolume}
            min={0}
            max={150}
            step={1}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ inputVolume: v })}
          />
          <SliderRow
            icon={Volume2}
            label="Output Volume"
            unit="%"
            value={config.outputVolume}
            min={0}
            max={150}
            step={1}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ outputVolume: v })}
          />
          <SliderRow
            label="Monitor Mix"
            unit="%"
            value={config.monitorMix}
            min={0}
            max={100}
            step={1}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ monitorMix: v })}
          />
        </div>
      </div>
    </aside>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">{children}</span>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  format,
  onChange,
  icon: Icon,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  format: (v: number) => string
  onChange: (v: number) => void
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-white/65">
          {Icon && <Icon className="h-3 w-3 text-white/45" />}
          {label}
        </span>
        <span className="font-mono tabular-nums text-white">
          {format(value)}
          {unit && <span className="ml-0.5 text-white/40">{unit}</span>}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="[&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:shadow-[0_0_0_3px_rgba(255,255,255,0.12)] [&_[data-slot=slider-thumb]]:focus-visible:ring-2 [&_[data-slot=slider-thumb]]:focus-visible:ring-white/40"
      />
    </div>
  )
}
