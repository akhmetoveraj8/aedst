// Pixel snapshots are platform- and runtime-specific (fonts, rasterization), so they exist only
// where a reference can be recorded: iOS Simulator (UIKit traits) and macOS (AppKit
// appearance). Other platforms compile this file to nothing. See README.md in this folder.
//
// UNVERIFIED: written without a Swift toolchain and never run. No reference images exist.
#if os(iOS) || os(macOS)
import AedstDesignSystem
import Foundation
import SnapshotTesting
import SwiftUI

/// Pinned canvas so reference images do not depend on the device a run happens on.
private let phoneWidth: CGFloat = 390 // iPhone 17 portrait
private let padWidth: CGFloat = 820 // iPad (A16 / 11") portrait
private let macWidth: CGFloat = 480

/// Shared tolerance: sub-pixel anti-aliasing drift between runtimes of the same OS family.
private let imagePrecision: Float = 0.99
private let imagePerceptualPrecision: Float = 0.98

#if os(iOS)
import UIKit

/// One reference image per component group x variant.
///
/// | Variant | Idiom / size class | Style | Dynamic Type | Direction |
/// |---|---|---|---|---|
/// | `iphone-light` | phone, compact | light | default | LTR |
/// | `iphone-dark` | phone, compact | dark | default | LTR |
/// | `iphone-a11y-xxxl` | phone, compact | light | accessibilityXXXL | LTR |
/// | `ipad-light` | pad, regular | light | default | LTR |
/// | `ipad-dark` | pad, regular | dark | default | LTR |
/// | `iphone-rtl-ar` | phone, compact | light | default | RTL (`ar`) |
private enum Variant: CaseIterable {
    case iPhoneLight
    case iPhoneDark
    case iPhoneAccessibilityText
    case iPadLight
    case iPadDark
    case iPhoneRTL

    var name: String {
        switch self {
        case .iPhoneLight: "iphone-light"
        case .iPhoneDark: "iphone-dark"
        case .iPhoneAccessibilityText: "iphone-a11y-xxxl"
        case .iPadLight: "ipad-light"
        case .iPadDark: "ipad-dark"
        case .iPhoneRTL: "iphone-rtl-ar"
        }
    }

    var width: CGFloat {
        switch self {
        case .iPadLight, .iPadDark: padWidth
        default: phoneWidth
        }
    }

    var layoutDirection: LayoutDirection { self == .iPhoneRTL ? .rightToLeft : .leftToRight }
    var locale: Locale { Locale(identifier: self == .iPhoneRTL ? "ar" : "en") }

    var traits: UITraitCollection {
        // displayScale is pinned: otherwise the library uses UIScreen.main.scale, so the PNG
        // pixel size would depend on the simulator model.
        let scale = UITraitCollection(displayScale: 2)
        let phone = UITraitCollection(traitsFrom: [
            scale,
            UITraitCollection(userInterfaceIdiom: .phone),
            UITraitCollection(horizontalSizeClass: .compact),
        ])
        let pad = UITraitCollection(traitsFrom: [
            scale,
            UITraitCollection(userInterfaceIdiom: .pad),
            UITraitCollection(horizontalSizeClass: .regular),
            UITraitCollection(verticalSizeClass: .regular),
        ])
        switch self {
        case .iPhoneLight, .iPhoneRTL:
            return UITraitCollection(traitsFrom: [phone, UITraitCollection(userInterfaceStyle: .light)])
        case .iPhoneDark:
            return UITraitCollection(traitsFrom: [phone, UITraitCollection(userInterfaceStyle: .dark)])
        case .iPhoneAccessibilityText:
            return UITraitCollection(traitsFrom: [
                phone,
                UITraitCollection(userInterfaceStyle: .light),
                UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge),
            ])
        case .iPadLight:
            return UITraitCollection(traitsFrom: [pad, UITraitCollection(userInterfaceStyle: .light)])
        case .iPadDark:
            return UITraitCollection(traitsFrom: [pad, UITraitCollection(userInterfaceStyle: .dark)])
        }
    }

    /// Accessibility sizes make content several times taller; give the fixed canvas room.
    func canvasHeight(for base: CGFloat) -> CGFloat {
        self == .iPhoneAccessibilityText ? base * 3 : base
    }
}

@MainActor
func assertComponent<Content: View>(
    height: CGFloat,
    fileID: StaticString = #fileID,
    file: StaticString = #filePath,
    testName: String = #function,
    line: UInt = #line,
    column: UInt = #column,
    @ViewBuilder content: () -> Content
) {
    let component = content()
    for variant in Variant.allCases {
        let canvas = component
            .padding(AedstSpacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(AedstColor.background)
            .foregroundStyle(AedstColor.foreground)
            .environment(\.layoutDirection, variant.layoutDirection)
            .environment(\.locale, variant.locale)
        // Record mode is not set here: swift-snapshot-testing reads `SNAPSHOT_TESTING_RECORD`
        // (all | failed | missing | never; default `missing`: record AND fail) itself.
        assertSnapshot(
            of: canvas,
            as: .image(
                precision: imagePrecision,
                perceptualPrecision: imagePerceptualPrecision,
                layout: .fixed(width: variant.width, height: variant.canvasHeight(for: height)),
                traits: variant.traits
            ),
            named: variant.name,
            fileID: fileID,
            file: file,
            testName: testName,
            line: line,
            column: column
        )
    }
}

#elseif os(macOS)
import AppKit

/// macOS has no size classes and no Dynamic Type; the variants are the AppKit appearance
/// (`NSAppearance`, which resolves the dynamic `NSColor`s behind `AedstColor`) and direction.
private enum Variant: CaseIterable {
    case macLight
    case macDark
    case macRTL

    var name: String {
        switch self {
        case .macLight: "mac-light"
        case .macDark: "mac-dark"
        case .macRTL: "mac-rtl-ar"
        }
    }

    var appearance: NSAppearance? {
        NSAppearance(named: self == .macDark ? .darkAqua : .aqua)
    }

    var layoutDirection: LayoutDirection { self == .macRTL ? .rightToLeft : .leftToRight }
    var locale: Locale { Locale(identifier: self == .macRTL ? "ar" : "en") }
}

@MainActor
func assertComponent<Content: View>(
    height: CGFloat,
    fileID: StaticString = #fileID,
    file: StaticString = #filePath,
    testName: String = #function,
    line: UInt = #line,
    column: UInt = #column,
    @ViewBuilder content: () -> Content
) {
    let component = content()
    for variant in Variant.allCases {
        let canvas = component
            .padding(AedstSpacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(AedstColor.background)
            .foregroundStyle(AedstColor.foreground)
            .environment(\.layoutDirection, variant.layoutDirection)
            .environment(\.locale, variant.locale)
        let host = NSHostingView(rootView: canvas)
        host.appearance = variant.appearance
        host.frame = NSRect(x: 0, y: 0, width: macWidth, height: height)
        host.layoutSubtreeIfNeeded()
        assertSnapshot(
            of: host,
            as: .image(precision: imagePrecision, perceptualPrecision: imagePerceptualPrecision),
            named: variant.name,
            fileID: fileID,
            file: file,
            testName: testName,
            line: line,
            column: column
        )
    }
}
#endif
#endif
