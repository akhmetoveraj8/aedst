#if os(macOS)
import AedstMedia
import SwiftUI
import UniformTypeIdentifiers

extension View {
    /// Presents the macOS file chooser: `.fileImporter` (needs the `com.apple.security.files.user-selected.read-only`
    /// sandbox entitlement). The iOS build has its own file with `PHPickerViewController`.
    func mediaPicker(isPresented: Binding<Bool>, onPick: @escaping ([PickedFile]) -> Void) -> some View {
        fileImporter(
            isPresented: isPresented,
            allowedContentTypes: [.image, .movie],
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result else { return }
            onPick(urls.compactMap { try? PickedFileCopier.copyToTemporaryDirectory($0) })
        }
    }
}
#endif
