"use client"

import { Mic, SlidersHorizontal, Volume2, Settings2, Star, User2, Layers, Cpu, Zap, Plus, AudioWaveformIcon as Waveform } from 'lucide-react'
import { cn } from "@/lib/utils"
import type { EngineMode } from "@/lib/voice-changer/types"

export type AppView = "voicebox" | "voicelab" | "soundboard" | "settings"

interface SidebarProps {
  currentView: AppView
  setView: (v: AppView) => void
  currentCategory: string
  setCategory: (c: string) => void
  categories: string[]
  mode: EngineMode
  latencyMs: number
  chunkMs: number
  loadedVoiceName: string | null
  onImport: () => void
}

const NAV: { id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "voicebox", label: "Voicebox", icon: Mic },
  { id: "voicelab", label: "VoiceLab", icon: SlidersHorizontal },
  { id: "soundboard", label: "Soundboard", icon: Volume2 },
  { id: "settings", label: "Settings", icon: Settings2 },
]

const STATIC_COLLECTIONS: { id: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "All", label: "All Voices", icon: Layers },
  { id: "Favorites", label: "Favorites", icon: Star },
  { id: "My Voices", label: "My Voices", icon: User2 },
]

export function Sidebar({
  currentView,
  setView,
  currentCategory,
  setCategory,
  categories,
  mode,
  latencyMs,
  chunkMs,
  loadedVoiceName,
  onImport,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-6 border-r border-white/10 bg-black px-3 py-4">
      <div className="flex flex-col gap-1">
        <SectionLabel>Mode</SectionLabel>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = currentView === item.id
            return (
              <div key={item.id} className="flex flex-col">
                <button
                  onClick={() => setView(item.id)}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition",
                    active
                      ? "bg-white text-black"
                      : "text-white/60 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{item.label}</span>
                  {active && (
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.2em] text-black/60">
                      ON
                    </span>
                  )}
                </button>
                {item.id === "voicelab" && (
                  <button
                    onClick={onImport}
                    className="group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition text-white/60 hover:bg-white/5 hover:text-white"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="font-medium">Import RVC Model</span>
                  </button>
                )}
              </div>
            )
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>Collections</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {STATIC_COLLECTIONS.map((c) => {
            const Icon = c.icon
            const active = currentCategory === c.id
            return (
              <button
                key={c.id}
                onClick={() => {
                  setCategory(c.id)
                  setView("voicebox")
                }}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition",
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/55 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{c.label}</span>
              </button>
            )
          })}
          {categories.length > 0 && (
            <div className="mt-1 flex flex-col gap-0.5">
              {categories.map((cat) => {
                const active = currentCategory === cat
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setCategory(cat)
                      setView("voicebox")
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition",
                      active
                        ? "bg-white/10 text-white"
                        : "text-white/45 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <span className="grid h-3.5 w-3.5 place-items-center text-white/30">
                      <span className="h-1 w-1 rounded-full bg-current" />
                    </span>
                    <span>{cat}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between">
          <SectionLabel>Engine</SectionLabel>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
            v1.0
          </span>
        </div>
        <Stat icon={Cpu} label="Backend" value={mode === "ai" ? "RVC AI" : "DSP"} />
        <Stat icon={Zap} label="Latency" value={`${latencyMs.toFixed(0)} ms`} />
        <Stat icon={Waveform} label="Chunk" value={`${chunkMs} ms`} />
        <div className="mt-1 truncate font-mono text-[10px] text-white/40">
          <span className="text-white/30">Voice:</span>{" "}
          <span className="text-white/70">{loadedVoiceName ?? "—"}</span>
        </div>
      </div>
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">
      {children}
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="flex items-center gap-1.5 text-white/45">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span className="font-mono tabular-nums text-white/85">{value}</span>
    </div>
  )
}
