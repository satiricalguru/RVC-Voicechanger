import SwiftUI

@main
struct AiVoiceChangerNativeApp: App {
    @StateObject private var model = VoiceChangerAppModel()

    var body: some Scene {
        WindowGroup("AiVoiceChanger Native") {
            ContentView(model: model)
                .frame(minWidth: 860, minHeight: 560)
        }
        .defaultSize(width: 980, height: 640)
    }
}
