import SwiftUI

struct ContentView: View {
    @ObservedObject var model: VoiceChangerAppModel

    var body: some View {
        NavigationSplitView {
            List {
                Section("Audio") {
                    LabeledContent("Engine") {
                        Text(model.engineStatus)
                            .foregroundStyle(model.isRunning ? .green : .secondary)
                    }

                    Picker("Input", selection: $model.selectedInputID) {
                        Text("System Default").tag(AudioDeviceDescriptor.ID?.none)
                        ForEach(model.inputDevices) { device in
                            Text(device.displayName).tag(Optional(device.id))
                        }
                    }

                    Picker("Output", selection: $model.selectedOutputID) {
                        Text("System Default").tag(AudioDeviceDescriptor.ID?.none)
                        ForEach(model.outputDevices) { device in
                            Text(device.displayName).tag(Optional(device.id))
                        }
                    }

                    Toggle("Live Monitoring", isOn: $model.hearMyself)
                }

                Section("Controls") {
                    Button(model.isRunning ? "Stop Engine" : "Start Engine") {
                        model.toggleEngine()
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Refresh Devices") {
                        model.refreshDevices()
                    }
                    .buttonStyle(.bordered)
                }
            }
            .navigationTitle("AiVoiceChanger")
        } detail: {
            VStack(alignment: .leading, spacing: 20) {
                Text("Native Rebuild")
                    .font(.largeTitle.weight(.semibold))

                Text("This target is the new macOS foundation for replacing the Python prototype with a lower-latency, more reliable architecture.")
                    .foregroundStyle(.secondary)

                HStack(spacing: 16) {
                    StatusCard(
                        title: "Input Devices",
                        value: "\(model.inputDevices.count)",
                        caption: model.selectedInputName
                    )
                    StatusCard(
                        title: "Output Devices",
                        value: "\(model.outputDevices.count)",
                        caption: model.selectedOutputName
                    )
                    StatusCard(
                        title: "Mode",
                        value: model.hearMyself ? "Monitor" : "Silent",
                        caption: model.engineStatus
                    )
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("What Comes Next")
                        .font(.title2.weight(.medium))
                    Text("1. CoreAudio duplex engine with block-safe routing")
                    Text("2. Native DSP chain")
                    Text("3. Real model runtime instead of the current placeholder synthesis")
                    Text("4. Packaging and app polish")
                }

                if let errorMessage = model.lastError {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .font(.callout)
                }

                Spacer()
            }
            .padding(28)
        }
    }
}

private struct StatusCard: View {
    let title: String
    let value: String
    let caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 34, weight: .bold, design: .rounded))
            Text(caption)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
