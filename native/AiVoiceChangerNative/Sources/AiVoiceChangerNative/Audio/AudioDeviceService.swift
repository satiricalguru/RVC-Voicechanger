import CoreAudio
import Foundation

enum AudioDeviceDirection {
    case input
    case output

    var scope: AudioObjectPropertyScope {
        switch self {
        case .input:
            kAudioDevicePropertyScopeInput
        case .output:
            kAudioDevicePropertyScopeOutput
        }
    }
}

final class AudioDeviceService {
    func inputDevices() -> [AudioDeviceDescriptor] {
        devices(for: .input)
    }

    func outputDevices() -> [AudioDeviceDescriptor] {
        devices(for: .output)
    }

    func defaultDeviceID(for direction: AudioDeviceDirection) -> AudioDeviceDescriptor.ID? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: direction == .input ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var deviceID = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &size,
            &deviceID
        )

        guard status == noErr, deviceID != 0 else {
            return nil
        }
        return deviceID
    }

    private func devices(for direction: AudioDeviceDirection) -> [AudioDeviceDescriptor] {
        guard let deviceIDs = allDeviceIDs() else {
            return []
        }

        return deviceIDs.compactMap { id in
            let inputChannels = channelCount(for: id, direction: .input)
            let outputChannels = channelCount(for: id, direction: .output)

            switch direction {
            case .input where inputChannels == 0:
                return nil
            case .output where outputChannels == 0:
                return nil
            default:
                return AudioDeviceDescriptor(
                    id: id,
                    name: deviceName(for: id) ?? "Unknown Device",
                    inputChannels: inputChannels,
                    outputChannels: outputChannels,
                    nominalSampleRate: nominalSampleRate(for: id)
                )
            }
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func allDeviceIDs() -> [AudioDeviceID]? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize: UInt32 = 0
        let sizeStatus = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize
        )

        guard sizeStatus == noErr else {
            return nil
        }

        let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.stride
        var deviceIDs = Array(repeating: AudioDeviceID(0), count: count)
        let dataStatus = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &deviceIDs
        )

        guard dataStatus == noErr else {
            return nil
        }

        return deviceIDs
    }

    private func deviceName(for deviceID: AudioDeviceID) -> String? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioObjectPropertyName,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var name: CFString = "" as CFString
        var size = UInt32(MemoryLayout<CFString>.size)
        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &size,
            &name
        )

        guard status == noErr else {
            return nil
        }

        return name as String
    }

    private func nominalSampleRate(for deviceID: AudioDeviceID) -> Double {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var sampleRate = Float64(44100)
        var size = UInt32(MemoryLayout<Float64>.size)
        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &size,
            &sampleRate
        )

        return status == noErr ? sampleRate : 44100
    }

    private func channelCount(for deviceID: AudioDeviceID, direction: AudioDeviceDirection) -> Int {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: direction.scope,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize: UInt32 = 0
        let sizeStatus = AudioObjectGetPropertyDataSize(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize
        )

        guard sizeStatus == noErr else {
            return 0
        }

        let bufferListPointer = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: Int(dataSize))
        defer { bufferListPointer.deallocate() }

        let dataStatus = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            bufferListPointer
        )

        guard dataStatus == noErr else {
            return 0
        }

        let bufferList = UnsafeMutableAudioBufferListPointer(bufferListPointer)
        return bufferList.reduce(0) { partialResult, buffer in
            partialResult + Int(buffer.mNumberChannels)
        }
    }
}
