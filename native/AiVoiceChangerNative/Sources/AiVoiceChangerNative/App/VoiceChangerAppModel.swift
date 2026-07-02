import Foundation

@MainActor
final class VoiceChangerAppModel: ObservableObject {
    @Published var inputDevices: [AudioDeviceDescriptor] = []
    @Published var outputDevices: [AudioDeviceDescriptor] = []
    @Published var selectedInputID: AudioDeviceDescriptor.ID? {
        didSet { persistSelection() }
    }
    @Published var selectedOutputID: AudioDeviceDescriptor.ID? {
        didSet { persistSelection() }
    }
    @Published var hearMyself: Bool {
        didSet { defaults.set(hearMyself, forKey: Keys.hearMyself) }
    }

    @Published private(set) var isRunning = false
    @Published private(set) var lastError: String?

    private let defaults = UserDefaults.standard
    private let deviceService = AudioDeviceService()
    private let engine = AudioEngineController()

    init() {
        self.hearMyself = defaults.object(forKey: Keys.hearMyself) as? Bool ?? true
        self.selectedInputID = defaults.object(forKey: Keys.selectedInputID) as? UInt32
        self.selectedOutputID = defaults.object(forKey: Keys.selectedOutputID) as? UInt32
        refreshDevices()
    }

    var engineStatus: String {
        isRunning ? "Running" : "Stopped"
    }

    var selectedInputName: String {
        name(for: selectedInputID, devices: inputDevices, fallback: "System Default")
    }

    var selectedOutputName: String {
        name(for: selectedOutputID, devices: outputDevices, fallback: "System Default")
    }

    func refreshDevices() {
        inputDevices = deviceService.inputDevices()
        outputDevices = deviceService.outputDevices()

        if selectedInputID == nil {
            selectedInputID = deviceService.defaultDeviceID(for: .input)
        }
        if selectedOutputID == nil {
            selectedOutputID = deviceService.defaultDeviceID(for: .output)
        }

        if let selectedInputID, !inputDevices.contains(where: { $0.id == selectedInputID }) {
            self.selectedInputID = deviceService.defaultDeviceID(for: .input)
        }
        if let selectedOutputID, !outputDevices.contains(where: { $0.id == selectedOutputID }) {
            self.selectedOutputID = deviceService.defaultDeviceID(for: .output)
        }
    }

    func toggleEngine() {
        if isRunning {
            engine.stop()
            isRunning = false
            lastError = nil
        } else {
            engine.start(
                inputID: selectedInputID,
                outputID: selectedOutputID,
                monitoringEnabled: hearMyself
            )
            isRunning = engine.isRunning
            lastError = engine.lastError
        }
    }

    private func persistSelection() {
        defaults.set(selectedInputID, forKey: Keys.selectedInputID)
        defaults.set(selectedOutputID, forKey: Keys.selectedOutputID)
    }

    private func name(for id: AudioDeviceDescriptor.ID?, devices: [AudioDeviceDescriptor], fallback: String) -> String {
        guard let id, let device = devices.first(where: { $0.id == id }) else {
            return fallback
        }
        return device.displayName
    }
}

private enum Keys {
    static let selectedInputID = "native.selectedInputID"
    static let selectedOutputID = "native.selectedOutputID"
    static let hearMyself = "native.hearMyself"
}
