"use client"

import { Minus, Square, X, Upload, BoxSelect, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"


interface TitleBarProps {
  onImport: () => void
  onHideToTray: () => void
  isLive: boolean
  latencyMs: number
}

export function TitleBar({ onImport, onHideToTray, isLive, latencyMs }: TitleBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-black px-3 select-none">
      {/* Left: space reserved for native macOS traffic lights in Electron,
          then logo + app name */}
      <div className="flex items-center gap-2 pl-[72px]">
        <div className="relative h-7 w-7 overflow-hidden rounded-md flex items-center justify-center">
          <img src="/icon.png" alt="RVC Voicechanger Logo" className="h-full w-full object-contain" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-semibold tracking-tight">RVC Voicechanger</span>
          <span className="font-mono text-[10px] text-white/40 tracking-wide">RVC · Realtime</span>
        </div>
      </div>

      {/* Center: live status pill */}
      <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 md:flex">
        <span
          className={cn(
            "relative h-1.5 w-1.5 rounded-full",
            isLive ? "bg-white" : "bg-white/30",
          )}
        >
          {isLive && <span className="absolute inset-0 animate-ping rounded-full bg-white" />}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/60">
          {isLive ? "Live" : "Idle"}
        </span>
        <span className="h-3 w-px bg-white/10" />
        <Activity className="h-3 w-3 text-white/50" />
        <span className="font-mono text-[11px] tabular-nums text-white/70">
          {latencyMs.toFixed(0)} ms
        </span>
      </div>

      {/* Right: actions + window controls */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onHideToTray}
          className="h-8 gap-1.5 px-2.5 text-xs text-white/70 hover:bg-white/5 hover:text-white"
        >
          <BoxSelect className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Tray</span>
        </Button>
        <Button
          size="sm"
          onClick={onImport}
          className="h-8 gap-1.5 bg-white px-3 text-xs text-black hover:bg-white/90"
        >
          <Upload className="h-3.5 w-3.5" />
          Import Model
        </Button>

      </div>
    </header>
  )
}
