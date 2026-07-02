"use client"

import { useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { UploadCloud, FolderOpen, HardDriveUpload, Rocket, FileX, FileCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface UploadDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onUpload: (params: { name: string; pthName: string; indexName?: string }) => Promise<void> | void
}

interface PickedFile {
  name: string
  size: number
  kind: "pth" | "index"
  /** for browser File objects */
  file?: File
  /** for native (Electron) paths */
  path?: string
}

export function UploadDialog({ open, onOpenChange, onUpload }: UploadDialogProps) {
  const [name, setName] = useState("")
  const [pth, setPth] = useState<PickedFile | null>(null)
  const [indexFile, setIndexFile] = useState<PickedFile | null>(null)
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setName("")
    setPth(null)
    setIndexFile(null)
    setProgress(0)
    setBusy(false)
  }

  function ingestFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    let nextPth: PickedFile | null = pth
    let nextIdx: PickedFile | null = indexFile
    for (const f of arr) {
      const lower = f.name.toLowerCase()
      if (lower.endsWith(".pth")) {
        nextPth = { name: f.name, size: f.size, kind: "pth", file: f }
        if (!name) setName(f.name.replace(/\.pth$/i, "").replace(/[_-]+/g, " "))
      } else if (lower.endsWith(".index")) {
        nextIdx = { name: f.name, size: f.size, kind: "index", file: f }
      }
    }
    setPth(nextPth)
    setIndexFile(nextIdx)
  }

  async function handleUpload() {
    if (!pth) return
    setBusy(true)
    setProgress(15)
    const ticker = setInterval(() => setProgress((p) => Math.min(92, p + 7)), 120)
    try {
      await onUpload({
        name: name.trim() || pth.name.replace(/\.pth$/i, ""),
        pthName: pth.name,
        indexName: indexFile?.name,
      })
      clearInterval(ticker)
      setProgress(100)
      setTimeout(() => {
        reset()
        onOpenChange(false)
      }, 350)
    } catch (e) {
      clearInterval(ticker)
      setBusy(false)
      setProgress(0)
      toast.error("Upload failed", {
        description: e instanceof Error ? e.message : "An unknown error occurred.",
      })
    }
  }

  async function handleImportByPath() {
    // In Electron, open a native file dialog; fall back to the regular upload flow in browser
    const api = window.electronAPI
    if (api?.openFileDialog) {
      const result = await api.openFileDialog({ properties: ["openFile", "multiSelections"] })
      if (!result.canceled && result.filePaths.length > 0) {
        // For path-based import, forward the paths to the onUpload callback with path info
        const pthPath = result.filePaths.find((p) => p.endsWith(".pth"))
        const idxPath = result.filePaths.find((p) => p.endsWith(".index"))
        if (!pthPath) { toast.error("No .pth file selected"); return }
        const pthName = pthPath.split(/[\\/]/).pop() ?? "model.pth"
        setPth({ name: pthName, size: 0, kind: "pth", path: pthPath })
        if (idxPath) {
          const idxName = idxPath.split(/[\\/]/).pop() ?? "model.index"
          setIndexFile({ name: idxName, size: 0, kind: "index", path: idxPath })
        }
        if (!name) setName(pthName.replace(/\.pth$/i, "").replace(/[_-]+/g, " "))
      }
    } else {
      // Browser fallback — just open the file input
      inputRef.current?.click()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-lg border-white/10 bg-zinc-950 text-white">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Import RVC Model</DialogTitle>
          <DialogDescription className="text-xs text-white/55">
            Drop in a <span className="font-mono text-white/85">.pth</span> file and an optional matching{" "}
            <span className="font-mono text-white/85">.index</span>. They&apos;ll be saved into your custom
            models directory and become a new voice preset.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/55">Display name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Haruka v2"
              className="border-white/10 bg-white/[0.03] text-sm placeholder:text-white/30 focus-visible:border-white/30 focus-visible:ring-0"
            />
          </label>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              ingestFiles(e.dataTransfer.files)
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-7 transition",
              drag
                ? "border-white bg-white/10"
                : "border-white/15 bg-white/[0.02] hover:border-white/40 hover:bg-white/[0.04]",
            )}
          >
            <UploadCloud className="h-6 w-6 text-white/70" />
            <span className="text-sm font-semibold">Drop model files here</span>
            <span className="text-xs text-white/45">or click to browse from disk</span>
            <input
              ref={inputRef}
              type="file"
              accept=".pth,.index"
              multiple
              hidden
              onChange={(e) => e.target.files && ingestFiles(e.target.files)}
            />
          </button>

          <div className="flex flex-col gap-1.5">
            <FileRow file={pth} expected="pth" />
            <FileRow file={indexFile} expected="index" optional />
          </div>

          {progress > 0 && (
            <div className="flex flex-col gap-1.5">
              <Progress
                value={progress}
                className="h-1 bg-white/10 [&_[data-slot=progress-indicator]]:bg-white"
              />
              <span className="font-mono text-[10px] tabular-nums text-white/50">
                {progress}% · {progress < 100 ? "uploading" : "imported"}
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-white/15 bg-transparent text-xs text-white/85 hover:bg-white/5 hover:text-white"
            onClick={() => inputRef.current?.click()}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose files
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 border-white/15 bg-transparent text-xs text-white/85 hover:bg-white/5 hover:text-white"
              onClick={handleImportByPath}
            >
              <HardDriveUpload className="h-3.5 w-3.5" />
              Import by path
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-white text-xs text-black hover:bg-white/90 disabled:bg-white/30"
              onClick={handleUpload}
              disabled={!pth || busy}
            >
              <Rocket className="h-3.5 w-3.5" />
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FileRow({ file, expected, optional }: { file: PickedFile | null; expected: "pth" | "index"; optional?: boolean }) {
  if (!file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-white/35">
        <span className="flex items-center gap-2">
          <FileX className="h-3.5 w-3.5" />
          {expected === "pth" ? "Required: .pth" : "Optional: .index"}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
          {optional ? "Optional" : "Required"}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs">
      <span className="flex items-center gap-2">
        <FileCheck className="h-3.5 w-3.5 text-white" />
        <span className="truncate font-medium">{file.name}</span>
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
        {file.kind} · {(file.size / (1024 * 1024)).toFixed(1)} MB
      </span>
    </div>
  )
}
