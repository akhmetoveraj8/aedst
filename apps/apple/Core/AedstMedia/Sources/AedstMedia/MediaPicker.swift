import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// A file the user picked, already copied into the app's temporary directory
/// (picker/importer URLs are only valid briefly or need security scope).
public struct PickedFile: Sendable, Equatable {
    /// Temporary local copy.
    public let url: URL
    /// The file's type.
    public let contentType: UTType

    /// Creates a picked-file value.
    public init(url: URL, contentType: UTType) {
        self.url = url
        self.contentType = contentType
    }

    /// `true` for movies.
    public var isVideo: Bool { contentType.conforms(to: .movie) }
    /// `true` for still images.
    public var isImage: Bool { contentType.conforms(to: .image) }
}

/// Copies a user-selected file (macOS `.fileImporter`, iOS Files) into the
/// temporary directory while holding its security scope.
public enum PickedFileCopier {
    /// Copies `url` and returns the temporary copy.
    public static func copyToTemporaryDirectory(_ url: URL) throws -> PickedFile {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("aedst-pick-\(UUID().uuidString)")
            .appendingPathExtension(url.pathExtension)
        try FileManager.default.copyItem(at: url, to: destination)
        let type = UTType(filenameExtension: url.pathExtension) ?? .data
        return PickedFile(url: destination, contentType: type)
    }
}

#if os(iOS)
import PhotosUI

/// Photo/video picker: `PHPickerViewController` runs out of process and needs
/// **no photo-library permission** (no `NSPhotoLibraryUsageDescription`).
/// SwiftUI's `PhotosPicker` would also work at the current OS floor; the
/// UIKit picker is kept because it already returns the `PickedFile` values
/// this module's callers consume.
public struct AedstMediaPicker: UIViewControllerRepresentable {
    private let selectionLimit: Int
    private let onPick: ([PickedFile]) -> Void
    private let onCancel: () -> Void

    /// `onPick` runs on the main actor with the temporary copies (possibly empty).
    public init(selectionLimit: Int = 1, onPick: @escaping ([PickedFile]) -> Void, onCancel: @escaping () -> Void = {}) {
        self.selectionLimit = selectionLimit
        self.onPick = onPick
        self.onCancel = onCancel
    }

    public func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration()
        configuration.filter = .any(of: [.images, .videos])
        configuration.selectionLimit = selectionLimit
        // Hand over the original encoding (HEIC/HEVC); MediaCompressor re-encodes anyway.
        configuration.preferredAssetRepresentationMode = .current
        let controller = PHPickerViewController(configuration: configuration)
        controller.delegate = context.coordinator
        return controller
    }

    public func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}

    public func makeCoordinator() -> Coordinator {
        Coordinator(onPick: onPick, onCancel: onCancel)
    }

    /// Receives the picker result and copies each item's file representation.
    ///
    /// `@preconcurrency` on the delegate conformance: `PHPickerViewControllerDelegate` is not annotated `@MainActor`
    /// in the SDK, but PhotosUI always calls it on the main thread; the class is `@MainActor`, so the delegate method
    /// is main-actor isolated and the compiler only needs to be told the (documented) call site is the main thread.
    @MainActor
    public final class Coordinator: NSObject, @preconcurrency PHPickerViewControllerDelegate {
        private let onPick: ([PickedFile]) -> Void
        private let onCancel: () -> Void

        init(onPick: @escaping ([PickedFile]) -> Void, onCancel: @escaping () -> Void) {
            self.onPick = onPick
            self.onCancel = onCancel
        }

        public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard !results.isEmpty else {
                onCancel()
                return
            }
            let providers = results.map(\.itemProvider)
            Task { @MainActor in
                var files: [PickedFile] = []
                for provider in providers {
                    let type: UTType = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) ? .movie : .image
                    if let file = try? await Self.copyFileRepresentation(from: provider, type: type) {
                        files.append(file)
                    }
                }
                onPick(files)
            }
        }

        private static func copyFileRepresentation(from provider: NSItemProvider, type: UTType) async throws -> PickedFile {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<PickedFile, Error>) in
                _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                    // The URL is deleted when this closure returns: copy synchronously.
                    guard let url else {
                        continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
                        return
                    }
                    do {
                        let destination = FileManager.default.temporaryDirectory
                            .appendingPathComponent("aedst-pick-\(UUID().uuidString)")
                            .appendingPathExtension(url.pathExtension)
                        try FileManager.default.copyItem(at: url, to: destination)
                        let actualType = UTType(filenameExtension: url.pathExtension) ?? type
                        continuation.resume(returning: PickedFile(url: destination, contentType: actualType))
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        }
    }
}
#endif
