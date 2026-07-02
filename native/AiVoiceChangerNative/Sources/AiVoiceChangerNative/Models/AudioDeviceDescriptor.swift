import Foundation

struct AudioDeviceDescriptor: Identifiable, Hashable {
    typealias ID = UInt32

    let id: ID
    let name: String
    let inputChannels: Int
    let outputChannels: Int
    let nominalSampleRate: Double

    var displayName: String {
        "\(name) (\(Int(nominalSampleRate)) Hz)"
    }
}
