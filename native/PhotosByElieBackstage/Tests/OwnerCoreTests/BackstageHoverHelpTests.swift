import AppKit
import Foundation
import Testing
@testable import BackstageUI

@Test("Backstage tooltip placement clamps horizontally and flips above a bottom edge")
func backstageTooltipPlacementClampsAndFlips() {
    let window = CGRect(x: 0, y: 0, width: 800, height: 600)
    let tooltip = CGSize(width: 280, height: 100)

    let left = BackstageTooltipPlacement.rect(
        for: CGRect(x: 4, y: 300, width: 20, height: 24),
        tooltipSize: tooltip,
        in: window
    )
    #expect(left.minX == 0)
    #expect(left.maxX == 280)
    #expect(left.minY == 192)

    let right = BackstageTooltipPlacement.rect(
        for: CGRect(x: 776, y: 300, width: 20, height: 24),
        tooltipSize: tooltip,
        in: window
    )
    #expect(right.maxX == 800)
    #expect(right.minY == 192)

    let top = BackstageTooltipPlacement.rect(
        for: CGRect(x: 380, y: 568, width: 40, height: 24),
        tooltipSize: tooltip,
        in: window
    )
    #expect(top.minY >= window.minY)
    #expect(top.maxY <= window.maxY)

    let bottom = BackstageTooltipPlacement.rect(
        for: CGRect(x: 380, y: 8, width: 40, height: 24),
        tooltipSize: tooltip,
        in: window
    )
    #expect(bottom.minY == 40)
    #expect(bottom.maxY == 140)
}

@Test("Backstage tooltip placement adapts to a resized narrow window")
func backstageTooltipPlacementAdaptsToResize() {
    let resizedWindow = CGRect(x: 0, y: 0, width: 220, height: 180)
    let placement = BackstageTooltipPlacement.rect(
        for: CGRect(x: 180, y: 72, width: 30, height: 24),
        tooltipSize: CGSize(width: 280, height: 80),
        in: resizedWindow
    )

    #expect(placement.width == 220)
    #expect(placement.maxX == 220)
    #expect(placement.minY >= resizedWindow.minY)
    #expect(placement.maxY <= resizedWindow.maxY)
}

@Test("Backstage tooltip placement clamps an unsupported oversized height within all margins")
func backstageTooltipPlacementBoundsOversizedHeight() {
    let contentRect = CGRect(x: 0, y: 0, width: 220, height: 120)
    let available = contentRect.insetBy(
        dx: BackstageTooltipPlacement.windowMargin,
        dy: BackstageTooltipPlacement.windowMargin
    )
    let oversizedTooltip = CGSize(width: 280, height: 400)
    let constrainedSize = BackstageTooltipPlacement.constrainedSize(
        oversizedTooltip,
        in: available
    )
    let placement = BackstageTooltipPlacement.rect(
        for: CGRect(x: 90, y: 48, width: 40, height: 24),
        tooltipSize: oversizedTooltip,
        in: available
    )

    #expect(constrainedSize == available.size)
    #expect(placement == available)
    #expect(placement.minX - contentRect.minX == 12)
    #expect(contentRect.maxX - placement.maxX == 12)
    #expect(placement.minY - contentRect.minY == 12)
    #expect(contentRect.maxY - placement.maxY == 12)
}

@Test("Current hover explanations fit the supported minimum Backstage content height")
func backstageTooltipCurrentExplanationsFitSupportedWindow() throws {
    func extractHelpArguments(from source: String) -> [String] {
        var arguments: [String] = []
        var searchStart = source.startIndex

        while let call = source.range(
            of: ".backstageHelp(",
            range: searchStart..<source.endIndex
        ) {
            var cursor = call.upperBound
            var depth = 1
            var isInsideString = false
            var isEscaped = false

            while cursor < source.endIndex, depth > 0 {
                let character = source[cursor]
                if isInsideString {
                    if isEscaped {
                        isEscaped = false
                    } else if character == "\\" {
                        isEscaped = true
                    } else if character == "\"" {
                        isInsideString = false
                    }
                } else if character == "\"" {
                    isInsideString = true
                } else if character == "(" {
                    depth += 1
                } else if character == ")" {
                    depth -= 1
                }
                cursor = source.index(after: cursor)
            }

            guard depth == 0 else { break }
            let argumentEnd = source.index(before: cursor)
            arguments.append(String(source[call.upperBound..<argumentEnd]))
            searchStart = cursor
        }

        return arguments
    }

    let packageRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let sourceDirectory = packageRoot
        .appendingPathComponent("Sources/BackstageApp", isDirectory: true)
    let sourceURLs = try FileManager.default.contentsOfDirectory(
        at: sourceDirectory,
        includingPropertiesForKeys: nil
    ).filter { $0.pathExtension == "swift" }
    let arguments = try sourceURLs.flatMap { url -> [String] in
        let source = try String(contentsOf: url, encoding: .utf8)
        return extractHelpArguments(from: source)
    }
    let literalPattern = try NSRegularExpression(
        pattern: #"\"((?:\\.|[^\"\\])*)\""#
    )
    let explanations = arguments.flatMap { argument -> [String] in
        let range = NSRange(argument.startIndex..., in: argument)
        return literalPattern.matches(in: argument, range: range).compactMap { match in
            guard let matchRange = Range(match.range(at: 1), in: argument) else {
                return nil
            }
            return String(argument[matchRange])
        }
    }

    #expect(arguments.count >= 100)
    #expect(explanations.count >= arguments.count)
    let font = NSFont.preferredFont(forTextStyle: .callout)
    let maximumNaturalHeight = explanations.map { explanation in
        (explanation as NSString).boundingRect(
            with: NSSize(
                width: 280,
                height: CGFloat.greatestFiniteMagnitude
            ),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font]
        ).height + (BackstageTooltipPlacement.verticalPadding * 2)
    }.max() ?? 0
    let minimumSupportedContent = CGRect(
        x: 0,
        y: 0,
        width: 1_120,
        height: 720
    )
    let available = minimumSupportedContent.insetBy(
        dx: BackstageTooltipPlacement.windowMargin,
        dy: BackstageTooltipPlacement.windowMargin
    )
    let naturalTooltipWidth = 280
        + (BackstageTooltipPlacement.horizontalPadding * 2)

    #expect(naturalTooltipWidth <= available.width)
    #expect(maximumNaturalHeight <= available.height)
}
