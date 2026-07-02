"use client"

import { Power, Headphones, Mic2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { Visualizer } from "./visualizer"

interface BottomBarProps {
  isLive: boolean
  onTogglePower: () => void
  hearMyself: boolean
  onHearMyselfChange: (v: boolean) => void
  voiceChangerEnabled: boolean
  onVoiceChangerChange: (v: boolean) => void
  vuIn: number
  vuOut: number
  drops: number
}

export function BottomBar({
  isLive,
  onTogglePower,
  hearMyself,
  onHearMyselfChange,
  voiceChangerEnabled,
  onVoiceChangerChange,
  vuIn,
  vuOut,
  drops,
}: BottomBarProps) {
  return (
    <footer className="flex h-24 shrink-0 items-stretch gap-3 border-t border-white/10 bg-black px-3 py-2.5">
      {/* Toggles */}
      <div className="flex w-[230px] shrink-0 flex-col justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
        <ToggleRow
          icon={Headphones}
          label="Hear Myself"
          hint="Monitor mix"
          checked={hearMyself}
          onChange={onHearMyselfChange}
        />
        <ToggleRow
          icon={Mic2}
          label="Voice Changer"
          hint="Master enable"
          checked={voiceChangerEnabled}
          onChange={onVoiceChangerChange}
        />
      </div>

      {/* Visualizer + meters */}
      <div className="flex flex-1 items-stretch gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-2">
        <div className="relative flex-1 overflow-hidden rounded-md">
          <Visualizer
            level={Math.max(vuIn, vuOut)}
            isLive={isLive}
            className="h-full w-full bg-black"
          />
          <div className="pointer-events-none absolute left-2 top-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-white/40">
            Waveform
          </div>
          <div className="pointer-events-none absolute right-2 top-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-white/40">
            {drops > 0 ? `Drops: ${drops}` : "0 drops"}
          </div>
        </div>
        <div className="flex w-44 flex-col justify-center gap-2">
          <Meter label="IN" value={vuIn} />
          <Meter label="OUT" value={vuOut} />
        </div>
      </div>

      {/* Power */}
      <button
        onClick={onTogglePower}
        className={cn(
          "group relative flex w-[200px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border transition",
          isLive
            ? "border-white bg-white text-black hover:bg-white/95"
            : "border-white/15 bg-white/[0.02] text-white hover:border-white/40 hover:bg-white/[0.05]",
        )}
        aria-pressed={isLive}
      >
        {isLive && (
          <span className="pointer-events-none absolute inset-0 animate-pulse rounded-lg shadow-[0_0_60px_-10px_rgba(255,255,255,0.6)]" />
        )}
        <Power className="h-5 w-5" />
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em]">
          {isLive ? "Stop Engine" : "Start Engine"}
        </span>
        <span
          className={cn(
            "font-mono text-[9px] uppercase tracking-[0.18em]",
            isLive ? "text-black/50" : "text-white/40",
          )}
        >
          {isLive ? "Press space to stop" : "Press space to start"}
        </span>
      </button>
    </footer>
  )
}

function ToggleRow({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-white/55" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-xs font-medium text-white/85">{label}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
            {hint}
          </span>
        </span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="h-4 w-7 data-[state=checked]:bg-white data-[state=unchecked]:bg-white/10 [&_[data-slot=switch-thumb]]:h-3 [&_[data-slot=switch-thumb]]:w-3 [&_[data-slot=switch-thumb]]:bg-black data-[state=unchecked]:[&_[data-slot=switch-thumb]]:bg-white/70"
      />
    </label>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  const segments = 24
  const lit = Math.round((Math.min(100, Math.max(0, value)) / 100) * segments)
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
        {label}
      </span>
      <div className="flex flex-1 items-center gap-[2px]">
        {Array.from({ length: segments }).map((_, i) => {
          const isOn = i < lit
          // make a subtle gradient ramp white→white-dim across segments
          const intensity = isOn ? 0.2 + (i / segments) * 0.8 : 0.06
          return (
            <span
              key={i}
              className="h-2 flex-1 rounded-sm"
              style={{ background: `rgba(255,255,255,${intensity})` }}
            />
          )
        })}
      </div>
      <span className="w-8 text-right font-mono text-[10px] tabular-nums text-white/55">
        {value.toFixed(0)}
      </span>
    </div>
  )
}
