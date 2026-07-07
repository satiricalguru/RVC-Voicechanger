"use client"

import { useState, useRef, useEffect } from "react"
import { Play, Square, Trash2, UploadCloud, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SoundboardSound } from "@/lib/voice-changer/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface SoundboardViewProps {
  sounds: SoundboardSound[]
  onUpload: (file: File, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function SoundboardView({ sounds, onUpload, onDelete }: SoundboardViewProps) {
  const [name, setName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const handlePlay = (sound: SoundboardSound) => {
    if (playingId === sound.id) {
      if (audioRef.current) {
        audioRef.current.pause()
        setPlayingId(null)
      }
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
    }

    setPlayingId(sound.id)

    const audio = new Audio(sound.url)
    audioRef.current = audio

    audio.onended = () => {
      setPlayingId(null)
    }

    audio.onerror = (err) => {
      console.error("Audio playback error:", err)
      toast.error("Failed to play sound effect.")
      setPlayingId(null)
    }

    audio.play().catch((err) => {
      console.error("Failed to play audio:", err)
      toast.error("Audio playback blocked or failed.")
      setPlayingId(null)
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) {
      toast.error("Please select an audio file first.")
      return
    }
    const displayName = name.trim() || file.name.replace(/\.[^/.]+$/, "")
    setBusy(true)
    try {
      await onUpload(file, displayName)
      setName("")
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
      toast.success("Sound uploaded successfully!")
    } catch (err: any) {
      toast.error(err.message || "Failed to upload sound.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">Soundboard</span>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          Trigger sound effects instantly.
        </h1>
        <p className="max-w-2xl text-sm text-white/55">
          Upload custom audio clips (MP3, WAV, etc.) to play them back instantly.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Upload Panel */}
        <article className="lg:col-span-1 flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
            Add New Sound
          </span>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs text-white/60">Sound Label/Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Airhorn, Laugh"
                className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/20 focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-white/60">Audio File</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 bg-white/[0.01] p-6 text-center cursor-pointer hover:bg-white/[0.03] transition",
                  file && "border-white/50 bg-white/[0.04]"
                )}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  accept="audio/*"
                  className="hidden"
                />
                <UploadCloud className="h-6 w-6 text-white/40" />
                <div className="text-xs text-white/70">
                  {file ? file.name : "Click to select audio file"}
                </div>
                <div className="text-[10px] text-white/40 font-mono">MP3, WAV, OGG, or M4A</div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={busy || !file}
              className="mt-2 w-full bg-white text-black hover:bg-white/90 disabled:bg-white/50"
            >
              {busy ? "Uploading..." : "Upload Sound"}
            </Button>
          </form>
        </article>

        {/* List of Sounds */}
        <article className="lg:col-span-2 flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5 min-h-[300px]">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
            Your Sounds
          </span>

          {sounds.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-white/40">
              <Music className="h-8 w-8 stroke-1" />
              <div className="text-sm font-medium">No sounds loaded</div>
              <p className="max-w-[280px] text-xs text-white/30">
                Upload custom audio files on the left panel to build your soundboard library.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto max-h-[400px] pr-1">
              {sounds.map((sound) => {
                const isPlaying = playingId === sound.id
                return (
                  <div
                    key={sound.id}
                    className={cn(
                      "group flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 transition hover:border-white/15 hover:bg-white/[0.04]",
                      isPlaying && "border-white/30 bg-white/[0.06]"
                    )}
                  >
                    <button
                      onClick={() => handlePlay(sound)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div
                        className={cn(
                          "grid h-8 w-8 place-items-center rounded-md bg-white/5 text-white/70 transition group-hover:bg-white/10 group-hover:text-white",
                          isPlaying && "bg-white text-black group-hover:bg-white group-hover:text-black"
                        )}
                      >
                        {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white/90">{sound.name}</div>
                        <div className="truncate text-[10px] text-white/30">{sound.filename}</div>
                      </div>
                    </button>

                    <button
                      onClick={() => onDelete(sound.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-white/45 hover:text-white hover:bg-white/5 rounded transition"
                      title="Delete sound"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
