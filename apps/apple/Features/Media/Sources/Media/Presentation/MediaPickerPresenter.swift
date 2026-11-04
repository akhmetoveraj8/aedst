import AedstMedia
import SwiftUI
import UniformTypeIdentifiers

extension View {
    /// Presents the platform's media chooser: `PHPickerViewController` on iOS
    /// (no photo-library permission needed), `.fileImporter` on macOS (needs the
    /// `com.apple.security.files.user-selected.read-only` sandbox entitlement).
    func mediaPicker(isPresented: Binding<Bool>, onPick: @escaping ([PickedFile]) -> Void) -> some View {
        #if os(iOS)
        sheet(isPresented: isPresented) {
            AedstMediaPicker(selectionLimit: 5) { files in
                isPresented.wrappedValue = false
                onPick(files)
            } onCancel: {
                isPresented.wrappedValue = false
            }
            .ignoresSafeArea()
        }
        #else
        fileImporter(
            isPresented: isPresented,
            allowedContentTypes: [.image, .movie],
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result else { return }
            onPick(urls.compactMap { try? PickedFileCopier.copyToTemporaryDirectory($0) })
        }
        #endif
    }
}
