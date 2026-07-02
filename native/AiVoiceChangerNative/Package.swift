// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AiVoiceChangerNative",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(
            name: "AiVoiceChangerNative",
            targets: ["AiVoiceChangerNative"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "AiVoiceChangerNative"
        ),
    ]
)
