#if os(iOS)
import AedstMedia
import SwiftUI

extension View {
    /// Presents the iOS media chooser: `PHPickerViewController` (no photo-library permission needed). The macOS
    /// build has its own file with `.fileImporter`.
    func mediaPicker(isPresented: Binding<Bool>, onPick: @escaping ([PickedFile]) -> Void) -> some View {
        sheet(isPresented: isPresented) {
            AedstMediaPicker(selectionLimit: 5) { files in
                isPresented.wrappedValue = false
                onPick(files)
            } onCancel: {
                isPresented.wrappedValue = false
            }
            .ignoresSafeArea()
        }
    }
}
#endif
