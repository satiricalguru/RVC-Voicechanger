# AiVoiceChangerNative

This is the native macOS foundation for rebuilding `AiVoiceChanger` into a more production-style desktop app.

Current scope:

- SwiftUI shell for a native desktop UI
- CoreAudio-based input and output device enumeration
- Persisted app state for selected devices and monitoring mode
- Audio engine controller placeholder for the future low-latency processing graph

Planned next:

1. Replace the placeholder engine with a real CoreAudio/AVAudioEngine duplex pipeline.
2. Add a native DSP rack for EQ, gate, compression, pitch, and reverb.
3. Add a proper model runtime layer for real-time voice conversion.
4. Add packaging, signing, updates, and a virtual-device routing strategy.

Build:

```bash
cd /Users/jatinpandey/Antigravity/AiVoiceChanger/native/AiVoiceChangerNative
swift build
```
