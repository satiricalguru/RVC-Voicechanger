"use client"

import { useMemo, useState } from "react"
import { Search, Star, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Voice } from "@/lib/voice-changer/types"
import { VoiceAvatar } from "./voice-avatar"

interface VoiceGridProps {
  voices: Voice[]
  selectedId: string
  loadingId: string | null
  loadedId: string | null
  category: string
  onSelect: (voice: Voice) => void
  onToggleFavorite: (id: string) => void
  onImport: () => void
  onDeleteVoice?: (id: string) => void
  onCategoryChange?: (c: string) => void
  totalCount: number
  latencyMs: number
  inferMs: number
}

export function VoiceGrid({
  voices,
  selectedId,
  loadingId,
  loadedId,
  category,
  onSelect,
  onToggleFavorite,
  onImport,
  onDeleteVoice,
  onCategoryChange,
  totalCount,
  latencyMs,
  inferMs,
}: VoiceGridProps) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return voices
    return voices.filter((v) =>
      [v.name, v.description, v.category, v.speaker].filter(Boolean).some((s) => s!.toLowerCase().includes(q)),
    )
  }, [voices, query])

  const chips = useMemo(() => {
    const set = new Set<string>(["All", "Favorites", "My Voices"])
    voices.forEach((v) => set.add(v.category))
    return Array.from(set)
  }, [voices])

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      {/* Hero */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">
              Voicebox · {category}
            </span>
            <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
              Real-time voice conversion.
            </h1>
            <p className="max-w-xl text-pretty text-sm text-white/55">
              Drop in a <span className="font-mono text-white/80">.pth</span> +{" "}
              <span className="font-mono text-white/80">.index</span>, pick a preset, and go live with sub-frame latency.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Models" value={String(totalCount)} />
            <Stat label="Latency" value={`${latencyMs.toFixed(0)} ms`} />
            <Stat label="Infer" value={`${inferMs.toFixed(0)} ms`} />
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search voices, categories, speakers…"
            className="h-10 border-white/10 bg-white/[0.03] pl-9 text-sm text-white placeholder:text-white/35 focus-visible:border-white/30 focus-visible:ring-0"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
          {chips.map((chip) => (
            <button
              key={chip}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-wide transition",
                category === chip
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/30 hover:text-white",
              )}
              onClick={() => onCategoryChange?.(chip)}
              type="button"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="grid h-full place-content-center gap-2 rounded-xl border border-dashed border-white/10 p-10 text-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">No match</span>
            <h3 className="text-lg font-semibold">Nothing matches that filter.</h3>
            <p className="text-sm text-white/45">Try another term, switch collections, or import a new model.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {filtered.map((voice) => {
              const isSelected = selectedId === voice.id
              const isLoading = loadingId === voice.id
              const isLoaded = loadedId === voice.id
              return (
                <article
                  key={voice.id}
                  onClick={() => onSelect(voice)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(voice) } }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  className={cn(
                    "group relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition",
                    "bg-gradient-to-b from-white/[0.03] to-transparent",
                    isSelected
                      ? "border-white/60 bg-white/[0.06] shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_8px_32px_-12px_rgba(255,255,255,0.25)]"
                      : "border-white/10 hover:border-white/30 hover:bg-white/[0.04]",
                  )}
                >
                  {/* top row: badge + fav / delete */}
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-white/60">
                      {isLoading ? (
                        <>
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          Loading
                        </>
                      ) : voice.source === "rvc" ? (
                        "RVC"
                      ) : voice.source === "custom" ? (
                        "Custom"
                      ) : (
                        "Clean"
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      {voice.source === "custom" && onDeleteVoice && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteVoice(voice.id)
                          }}
                          className="grid h-7 w-7 place-items-center rounded-md text-white/40 hover:bg-red-950/40 hover:text-red-400 transition"
                          aria-label="Delete model"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleFavorite(voice.id)
                        }}
                        className={cn(
                          "grid h-7 w-7 place-items-center rounded-md transition",
                          voice.isFavorite
                            ? "bg-white text-black"
                            : "text-white/40 hover:bg-white/10 hover:text-white",
                        )}
                        aria-label={voice.isFavorite ? "Remove from favorites" : "Add to favorites"}
                      >
                        <Star className={cn("h-3.5 w-3.5", voice.isFavorite && "fill-current")} />
                      </button>
                    </div>
                  </div>

                  <VoiceAvatar
                    initials={voice.initials}
                    tone={voice.tone}
                    size="lg"
                    active={isSelected}
                    className="mx-auto my-1"
                    image={voice.image}
                  />

                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold tracking-tight">{voice.name}</h3>
                    <p className="line-clamp-2 text-xs leading-snug text-white/50">
                      {voice.description}
                    </p>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/55">
                      {voice.category}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-white/45">
                      {voice.sizeMb ? `${voice.sizeMb} MB` : "—"}
                    </span>
                  </div>

                  {isLoaded && !isLoading && (
                    <span className="absolute left-1/2 top-2.5 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-black shadow-md z-10">
                      <CheckCircle2 className="h-2 w-2" /> Loaded
                    </span>
                  )}
                </article>
              )
            })}

            {/* Import card */}
            <button
              onClick={onImport}
              className="group flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.01] p-4 text-center transition hover:border-white/40 hover:bg-white/[0.04]"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full border border-white/15 text-white/60 transition group-hover:border-white group-hover:text-white">
                <Plus className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold">Import RVC Model</span>
              <span className="text-xs text-white/45">.pth + .index</span>
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">{label}</div>
      <div className="mt-1 font-mono text-base tabular-nums">{value}</div>
    </div>
  )
}
