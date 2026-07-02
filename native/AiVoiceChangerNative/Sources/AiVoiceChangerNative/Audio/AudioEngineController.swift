import Foundation

@MainActor
final class AudioEngineController: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var lastError: String?

    func start(inputID: AudioDeviceDescriptor.ID?, outputID: AudioDeviceDescriptor.ID?, monitoringEnabled: Bool) {
        guard !isRunning else { return }

        guard inputID != nil || outputID != nil else {
            lastError = "Select at least one audio device before starting the engine."
            return
        }

        lastError = nil

        // Placeholder for the future duplex CoreAudio graph.
        // We intentionally stop here instead of pretending to process live audio.
        isRunning = true
        if !monitoringEnabled {
            lastError = "Engine shell started. Real-time routing is the next implementation step."
        }
    }

    func stop() {
        isRunning = false
        lastError = nil
    }
}
