"use client"

import {
  Mic,
  Volume2,
  Headphones,
  Cpu,
  Download,
  AudioWaveformIcon as Waveform,
  RefreshCw,
  Folder,
  KeyRound,
} from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type {
  AudioDevice,
  EngineMode,
  F0Method,
  VoiceChangerConfig,
} from "@/lib/voice-changer/types"

import { cn } from "@/lib/utils"
import { TRANSLATIONS } from "@/lib/voice-changer/translations"

interface SettingsViewProps {
  config: VoiceChangerConfig
  onChange: (patch: Partial<VoiceChangerConfig>) => void
  inputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  monitorDevices: AudioDevice[]
  drops?: number
  onRescanDevices: () => void
  onDownloadRmvpe: () => void
}

export function SettingsView({
  config,
  onChange,
  inputDevices,
  outputDevices,
  monitorDevices,
  drops = 0,
  onRescanDevices,
  onDownloadRmvpe,
}: SettingsViewProps) {
  const lang = config.language || "en"
  const t = (key: keyof typeof TRANSLATIONS.en) => {
    return TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key] || String(key)
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">
          {t("settings")}
        </span>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          {t("settingsTitle")}
        </h1>
        <p className="max-w-2xl text-sm text-white/55">
          {t("settingsDesc")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {/* Routing */}
        <Panel title={t("routing")} icon={Mic}>
          <DeviceField
            icon={Mic}
            label={t("inputDevice")}
            value={config.inputDeviceIndex}
            devices={inputDevices}
            onChange={(v) => onChange({ inputDeviceIndex: v })}
          />
          <DeviceField
            icon={Volume2}
            label={t("outputDevice")}
            value={config.outputDeviceIndex}
            devices={outputDevices}
            onChange={(v) => onChange({ outputDeviceIndex: v })}
          />
          <DeviceField
            icon={Headphones}
            label={t("monitorDevice")}
            value={config.monitorDeviceIndex}
            devices={monitorDevices}
            onChange={(v) => onChange({ monitorDeviceIndex: v })}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onRescanDevices}
            className="mt-1 h-8 w-full justify-center gap-1.5 border-white/15 bg-transparent text-xs text-white/80 hover:bg-white/5 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" />
            {t("rescanDevices")}
          </Button>
        </Panel>

        {/* Levels */}
        <Panel title={t("levels")} icon={Volume2}>
          <SliderField
            label={t("inputVolume")}
            unit="%"
            value={config.inputVolume}
            min={0}
            max={150}
            step={1}
            onChange={(v) => onChange({ inputVolume: v })}
          />
          <SliderField
            label={t("outputVolume")}
            unit="%"
            value={config.outputVolume}
            min={0}
            max={150}
            step={1}
            onChange={(v) => onChange({ outputVolume: v })}
          />
          <SliderField
            label={t("monitorMix")}
            unit="%"
            value={config.monitorMix}
            min={0}
            max={100}
            step={1}
            onChange={(v) => onChange({ monitorMix: v })}
          />
          <ToggleField
            label={t("hearMyself")}
            description="Routes processed audio to monitor"
            checked={config.hearMyself}
            onChange={(v) => onChange({ hearMyself: v })}
          />
          <ToggleField
            label={t("voiceChanger")}
            description="Master enable for the engine"
            checked={config.voiceChangerEnabled}
            onChange={(v) => onChange({ voiceChangerEnabled: v })}
          />
        </Panel>

        {/* Audio Engine */}
        <Panel title={t("audioEngine")} icon={Waveform}>
          <SelectField
            label={t("sampleRate")}
            value={String(config.sampleRate)}
            onChange={(v) => onChange({ sampleRate: Number(v) as 44100 | 48000 })}
            options={[
              { value: "44100", label: "44.1 kHz" },
              { value: "48000", label: "48 kHz" },
            ]}
          />
          <SelectField
            label={t("bufferSize")}
            value={String(config.bufferSize)}
            onChange={(v) => onChange({ bufferSize: Number(v) as 256 | 512 | 1024 | 2048 })}
            options={[
              { value: "256", label: "256 samples · ultra-low" },
              { value: "512", label: "512 samples · low" },
              { value: "1024", label: "1024 samples · stable" },
              { value: "2048", label: "2048 samples · safe" },
            ]}
          />
          <SelectField
            label={t("aiChunkSize")}
            value={String(config.chunkMs)}
            onChange={(v) => onChange({ chunkMs: Number(v) as 128 | 256 | 512 })}
            options={[
              { value: "128", label: "128 ms · responsive" },
              { value: "256", label: "256 ms · balanced" },
              { value: "512", label: "512 ms · clean" },
            ]}
          />
          <SelectField
            label={t("f0Method")}
            value={config.f0Method}
            onChange={(v) => onChange({ f0Method: v as F0Method })}
            options={[
              { value: "fcpe", label: "FCPE · fastest" },
              { value: "rmvpe", label: "RMVPE · accurate" },
              { value: "harvest", label: "Harvest · classic" },
              { value: "crepe", label: "CREPE · research" },
            ]}
          />
          <SelectField
            label="Engine Mode"
            value={config.mode}
            onChange={(v) => onChange({ mode: v as EngineMode })}
            options={[
              { value: "dsp", label: "DSP · pedalboard only" },
              { value: "ai", label: "AI Voice · RVC" },
            ]}
          />
        </Panel>

        {/* Voice tuning */}
        <Panel title={t("voice")} icon={Cpu}>
          <SliderField
            label="Pitch"
            unit="st"
            value={config.pitchSemitones}
            min={-24}
            max={24}
            step={1}
            format={(v) => (v > 0 ? `+${v}` : `${v}`)}
            onChange={(v) => onChange({ pitchSemitones: v })}
          />
          <SliderField
            label="Index Strength"
            value={config.indexRate}
            min={0}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => onChange({ indexRate: v })}
          />
          <SliderField
            label="Protect"
            value={config.protect}
            min={0}
            max={0.5}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => onChange({ protect: v })}
          />
          <SliderField
            label="Reverb Damping"
            value={config.reverbDamping}
            min={0}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => onChange({ reverbDamping: v })}
          />
        </Panel>

        {/* App */}
        <Panel title={t("app")} icon={Folder}>
          <SelectField
            label={t("theme")}
            value={config.theme || "dark"}
            onChange={(v) => onChange({ theme: v as "dark" | "light" })}
            options={[
              { value: "dark", label: "Dark Mode" },
              { value: "light", label: "Light Mode" },
            ]}
          />
          <SelectField
            label={t("language")}
            value={config.language || "en"}
            onChange={(v) => onChange({ language: v as "en" | "ja" | "zh" })}
            options={[
              { value: "en", label: "English" },
              { value: "ja", label: "日本語" },
              { value: "zh", label: "简体中文" },
            ]}
          />
          <KeyValue label={t("drops")} value={drops > 0 ? `${drops} ⚠` : "0"} mono />
          <KeyValue label={t("customModelsDir")} value="~/.aivoicechanger/models" mono />
          <Button
            variant="outline"
            size="sm"
            onClick={onDownloadRmvpe}
            className="mt-1 h-8 w-full justify-center gap-1.5 border-white/15 bg-transparent text-xs text-white/80 hover:bg-white/5 hover:text-white"
          >
            <Download className="h-3 w-3" />
            {t("downloadRmvpe")}
          </Button>
        </Panel>

        {/* Shortcuts */}
        <Panel title={t("shortcuts")} icon={KeyRound}>
          <ShortcutRow keys={["Space"]} label={t("toggleEngine")} />
          <ShortcutRow keys={["1", "2", "3"]} label={t("pickVoice")} />
          <ShortcutRow keys={["⌘", "K"]} label={t("searchVoices")} />
          <ShortcutRow keys={["⌘", ","]} label={t("openSettings")} />
          <ShortcutRow keys={["M"]} label={t("muteMaster")} />
        </Panel>
      </div>
    </section>
  )
}

/* ─── Subcomponents ───────────────────────────────────────────────────────── */

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
          <Icon className="h-3 w-3" />
          {title}
        </span>
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function DeviceField({
  icon: Icon,
  label,
  value,
  devices,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | null
  devices: AudioDevice[]
  onChange: (v: number | null) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-xs text-white/65">
        <Icon className="h-3 w-3 text-white/45" />
        {label}
      </label>
      <Select
        value={value === null ? "default" : String(value)}
        onValueChange={(v) => onChange(v === "default" ? null : Number(v))}
      >
        <SelectTrigger className="h-9 border-white/10 bg-white/[0.02] text-sm text-white hover:border-white/30 focus:ring-0">
          <SelectValue placeholder="System default" />
        </SelectTrigger>
        <SelectContent className="border-white/10 bg-zinc-950 text-white">
          <SelectItem value="default" className="text-xs">
            System Default
          </SelectItem>
          {devices.map((d) => (
            <SelectItem key={d.index} value={String(d.index)} className="text-xs">
              {d.name}
              <span className="ml-2 font-mono text-[10px] text-white/40">{d.channels}ch</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-white/65">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 border-white/10 bg-white/[0.02] text-sm text-white hover:border-white/30 focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-white/10 bg-zinc-950 text-white">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/65">{label}</span>
        <span className="font-mono tabular-nums text-white">
          {format ? format(value) : value.toFixed(2)}
          {unit && <span className="ml-0.5 text-white/40">{unit}</span>}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="[&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-white"
      />
    </div>
  )
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="flex flex-col leading-tight">
        <span className="text-sm text-white/85">{label}</span>
        <span className="text-xs text-white/40">{description}</span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="data-[state=checked]:bg-white data-[state=unchecked]:bg-white/10 [&_[data-slot=switch-thumb]]:bg-black data-[state=unchecked]:[&_[data-slot=switch-thumb]]:bg-white/70"
      />
    </label>
  )
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-white/55">{label}</span>
      <span className={cn("text-white/85", mono && "font-mono tabular-nums")}>{value}</span>
    </div>
  )
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-white/65">{label}</span>
      <span className="flex items-center gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-[1px] font-mono text-[10px] text-white/85"
          >
            {k}
          </kbd>
        ))}
      </span>
    </div>
  )
}
