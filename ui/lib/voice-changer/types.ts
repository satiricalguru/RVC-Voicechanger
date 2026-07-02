export type VoiceSource = "system" | "rvc" | "custom"

export type EngineMode = "dsp" | "ai"

export type F0Method = "fcpe" | "rmvpe" | "harvest" | "crepe"

export interface Voice {
  id: string
  name: string
  description: string
  category: string
  source: VoiceSource
  initials: string
  speaker?: string
  version?: string
  sampleRate?: number
  sizeMb?: number
  hasIndex?: boolean
  isFavorite?: boolean
  image?: string
  /** monogram tone 0..1 — used for grayscale avatar gradient */
  tone?: number
}

export interface AudioDevice {
  index: number
  name: string
  channels: number
}

export interface EngineStatus {
  isRunning: boolean
  mode: EngineMode
  loadedVoiceId: string | null
  loadingVoiceId: string | null
  voiceLoadError: string | null
  latencyMs: number
  inferMs: number
  chunkMs: number
  vuIn: number // 0..100
  vuOut: number // 0..100
  drops: number
  sampleRate: number
  bufferSize: number
}

export interface VoiceChangerConfig {
  // Routing
  inputDeviceIndex: number | null
  outputDeviceIndex: number | null
  monitorDeviceIndex: number | null

  // Levels
  inputVolume: number // 0..150 (%)
  outputVolume: number // 0..150 (%)
  monitorMix: number // 0..100 (%)
  hearMyself: boolean
  voiceChangerEnabled: boolean

  // Audio engine
  sampleRate: 44100 | 48000
  bufferSize: 256 | 512 | 1024 | 2048
  chunkMs: 128 | 256 | 512
  f0Method: F0Method
  mode: EngineMode

  // Voice tuning
  pitchSemitones: number // -24..24
  indexRate: number // 0..1
  protect: number // 0..0.5
  reverb: number // 0..1
  reverbDamping: number // 0..1
  noiseGateDb: number // -90..0
  compressorRatio: number // 1..20

  // Selected voice
  selectedVoiceId: string
}
