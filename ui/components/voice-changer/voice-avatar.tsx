import { useState } from "react"
import { cn } from "@/lib/utils"

interface VoiceAvatarProps {
  initials: string
  tone?: number
  size?: "sm" | "md" | "lg" | "xl"
  active?: boolean
  className?: string
  image?: string
}

const SIZES = {
  sm: "h-9 w-9 text-[10px]",
  md: "h-12 w-12 text-xs",
  lg: "h-16 w-16 text-sm",
  xl: "h-20 w-20 text-base",
}

/**
 * Monochrome avatar — renders a web image if available; falls back to a 
 * radial gradient swatch that varies by `tone` (0..1) on error or absence.
 */
export function VoiceAvatar({ initials, tone = 0.5, size = "md", active, className, image }: VoiceAvatarProps) {
  const start = Math.round(20 + tone * 70) // %
  const end = Math.round(Math.max(0, start - 35))
  const text = tone > 0.55 ? "text-black" : "text-white"
  const [imgError, setImgError] = useState(false)

  const showImage = image && !imgError

  return (
    <div
      className={cn(
        "relative grid place-items-center rounded-2xl font-mono font-semibold tracking-[0.18em] uppercase overflow-hidden",
        "ring-1 ring-inset ring-white/10",
        active && "ring-white/40",
        SIZES[size],
        text,
        className,
      )}
      style={{
        background: showImage
          ? "transparent"
          : `radial-gradient(circle at 30% 30%, hsl(0 0% ${start}%) 0%, hsl(0 0% ${end}%) 70%, hsl(0 0% ${Math.max(0, end - 8)}%) 100%)`,
      }}
      aria-hidden
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={initials}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <>
          <span className="relative z-10">{initials}</span>
          <span className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/40 mix-blend-overlay" />
        </>
      )}
    </div>
  )
}
