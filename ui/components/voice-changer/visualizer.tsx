"use client"

import { useEffect, useRef } from "react"

interface VisualizerProps {
  /** 0..100 — drives wave amplitude */
  level: number
  isLive: boolean
  className?: string
}

/**
 * Monochrome animated waveform — black background, white wave, faint grid.
 * Smooth EMA on incoming level so spikes don't jitter.
 */
export function Visualizer({ level, isLive, className }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const stateRef = useRef({
    level: 0,
    history: Array.from({ length: 96 }, () => 0.06),
  })

  useEffect(() => {
    stateRef.current.level = level / 100
  }, [level])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const tick = () => {
      const w = canvas.width
      const h = canvas.height
      const s = stateRef.current

      // Smooth and push history
      const target = isLive ? Math.max(0.04, s.level * 0.85) : 0.04
      s.history.push(target)
      s.history = s.history.slice(-96)

      ctx.clearRect(0, 0, w, h)

      // Faint grid
      ctx.strokeStyle = "rgba(255,255,255,0.04)"
      ctx.lineWidth = 1 * dpr
      for (let i = 0; i < 6; i++) {
        const y = (h / 6) * i
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      // Centerline
      ctx.strokeStyle = "rgba(255,255,255,0.12)"
      ctx.beginPath()
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      ctx.stroke()

      // Waveform — mirrored bars
      const bars = s.history.length
      const barW = w / bars
      const t = performance.now() * 0.004

      for (let i = 0; i < bars; i++) {
        const v = s.history[i]
        const wobble = Math.sin(i * 0.55 + t) * 0.5 + 0.5
        const amp = v * (0.55 + wobble * 0.6) * h * 0.78
        const x = i * barW

        const alpha = 0.35 + (i / bars) * 0.55
        ctx.fillStyle = isLive
          ? `rgba(255,255,255,${alpha})`
          : `rgba(255,255,255,${alpha * 0.35})`

        ctx.fillRect(
          Math.round(x) + Math.max(1, dpr),
          Math.round(h / 2 - amp / 2),
          Math.max(1, Math.floor(barW - 2 * dpr)),
          Math.max(1, Math.floor(amp)),
        )
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [isLive])

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "h-full w-full rounded-md border border-white/10 bg-black"}
      aria-hidden
    />
  )
}
