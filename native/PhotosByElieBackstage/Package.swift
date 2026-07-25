// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PhotosByElieBackstage",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "OwnerCore", targets: ["OwnerCore"]),
        .executable(name: "PhotosByElieBackstage", targets: ["BackstageApp"]),
    ],
    targets: [
        .target(
            name: "OwnerCore",
            linkerSettings: [
                .linkedFramework("Security"),
                .linkedFramework("Photos"),
                .linkedLibrary("sqlite3"),
            ]
        ),
        .executableTarget(
            name: "BackstageApp",
            dependencies: ["OwnerCore"],
            linkerSettings: [.linkedFramework("Quartz")]
        ),
        .testTarget(
            name: "OwnerCoreTests",
            dependencies: ["OwnerCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
