// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PhotosByElieBackstage",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "OwnerCore", targets: ["OwnerCore"]),
        .library(name: "BackstageUI", targets: ["BackstageUI"]),
        .executable(name: "PhotosByElieBackstage", targets: ["BackstageApp"]),
    ],
    targets: [
        .target(
            name: "OwnerCore",
            linkerSettings: [
                .linkedFramework("Security"),
                .linkedFramework("Photos"),
                .linkedFramework("Network"),
                .linkedLibrary("sqlite3"),
            ]
        ),
        .target(
            name: "BackstageUI",
            dependencies: ["OwnerCore"],
            path: "Sources/BackstageApp",
            linkerSettings: [.linkedFramework("Quartz")]
        ),
        .executableTarget(
            name: "BackstageApp",
            dependencies: ["BackstageUI"],
            path: "Sources/BackstageLauncher"
        ),
        .testTarget(
            name: "OwnerCoreTests",
            dependencies: ["OwnerCore", "BackstageUI"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
