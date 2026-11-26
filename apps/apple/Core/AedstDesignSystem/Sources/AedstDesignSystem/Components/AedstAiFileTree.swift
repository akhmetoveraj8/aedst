import Observation
import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Open folders and the selected file of an `AedstAiFileTree`. Own it in the caller (`@State`) to read or drive
/// it, as the web `expanded` / `selectedPath` props do; it is main-actor state of the view tree.
@MainActor
@Observable
public final class AedstAiFileTreeState {
    /// Paths of the open folders.
    public var expanded: Set<String>
    /// Path of the selected file.
    public var selectedPath: String?

    public init(expanded: Set<String> = [], selectedPath: String? = nil) {
        self.expanded = expanded
        self.selectedPath = selectedPath
    }

    public func isExpanded(_ path: String) -> Bool {
        expanded.contains(path)
    }

    public func setExpanded(_ path: String, _ open: Bool) {
        if open {
            expanded.insert(path)
        } else {
            expanded.remove(path)
        }
    }

    public func toggle(_ path: String) {
        setExpanded(path, !isExpanded(path))
    }

    public func isSelected(_ path: String) -> Bool {
        selectedPath == path
    }
}

extension EnvironmentValues {
    @Entry var aedstAiFileTreeOnSelect: (@MainActor (String) -> Void)? = nil
}

/// The files the agent changed as folders that open and close, matching the web `AiFileTree`. A folder is a
/// disclosure (`AedstCollapsible`), a file a button with the selected trait; names stay left-to-right.
public struct AedstAiFileTree<Content: View>: View {
    private let state: AedstAiFileTreeState
    private let accessibilityLabel: String
    private let onSelect: (@MainActor (String) -> Void)?
    private let content: Content

    /// - Parameters:
    ///   - state: Open folders and selection.
    ///   - accessibilityLabel: Name of the tree ("Changed files").
    ///   - onSelect: Called with the path of the file the user picked (after it became selected).
    public init(
        state: AedstAiFileTreeState,
        accessibilityLabel: String,
        onSelect: (@MainActor (String) -> Void)? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.state = state
        self.accessibilityLabel = accessibilityLabel
        self.onSelect = onSelect
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(state)
        .environment(\.aedstAiFileTreeOnSelect, onSelect)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityLabel))
    }
}

/// A folder: chevron, open or closed folder icon and name; its content is the nested folders and files.
public struct AedstAiFileTreeFolder<Content: View>: View {
    private let path: String
    private let name: String
    private let content: Content
    @Environment(AedstAiFileTreeState.self) private var state

    public init(path: String, name: String, @ViewBuilder content: () -> Content) {
        self.path = path
        self.name = name
        self.content = content()
    }

    public var body: some View {
        let isOpen = Binding(get: { state.isExpanded(path) }, set: { state.setExpanded(path, $0) })
        AedstCollapsible(isExpanded: isOpen) {
            HStack(spacing: AedstSpacing.sm) {
                AedstAiFileTreeIcon(isOpen.wrappedValue ? "folder.fill" : "folder")
                AedstAiFileTreeName(name)
            }
        } content: {
            VStack(alignment: .leading, spacing: AedstSpacing.none) {
                content
            }
            .padding(.leading, AedstSpacing.xs)
            .overlay(alignment: .leading) { AedstSeparator(.vertical) }
            .padding(.leading, AedstSpacing.lg)
        }
    }
}

/// A file: a button that selects it; `actions` sit beside it (never inside it).
public struct AedstAiFileTreeFile<Actions: View>: View {
    private let path: String
    private let name: String
    private let systemImage: String
    private let actions: Actions
    @Environment(AedstAiFileTreeState.self) private var state
    @Environment(\.aedstAiFileTreeOnSelect) private var onSelect

    public init(path: String, name: String, systemImage: String = "doc", @ViewBuilder actions: () -> Actions) {
        self.path = path
        self.name = name
        self.systemImage = systemImage
        self.actions = actions()
    }

    public var body: some View {
        let selected = state.isSelected(path)
        HStack(spacing: AedstSpacing.xs) {
            Button {
                state.selectedPath = path
                onSelect?(path)
            } label: {
                HStack(spacing: AedstSpacing.sm) {
                    AedstAiFileTreeIcon(systemImage)
                    AedstAiFileTreeName(name)
                    Spacer(minLength: AedstSpacing.none)
                }
                // Aligns with folder names, which have a chevron before the icon.
                .padding(.leading, AedstSpacing.xxl + AedstSpacing.xs)
                .padding(.trailing, AedstSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .aedstHitTarget()
                .background(
                    selected ? AedstColor.accent : Color.clear,
                    in: RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
            AedstAiFileTreeActions { actions }
        }
    }
}

extension AedstAiFileTreeFile where Actions == EmptyView {
    /// A file without actions.
    public init(path: String, name: String, systemImage: String = "doc") {
        self.init(path: path, name: name, systemImage: systemImage) { EmptyView() }
    }
}

/// Decorative file or folder icon.
public struct AedstAiFileTreeIcon: View {
    private let systemImage: String

    public init(_ systemImage: String) {
        self.systemImage = systemImage
    }

    public var body: some View {
        Image(systemName: systemImage)
            .foregroundStyle(AedstColor.mutedForeground)
            .accessibilityHidden(true)
    }
}

/// A file or folder name: monospaced, truncated in the middle, always left-to-right (paths).
public struct AedstAiFileTreeName: View {
    private let name: String

    public init(_ name: String) {
        self.name = name
    }

    public var body: some View {
        Text(name)
            .font(AedstTypography.caption.monospaced())
            .foregroundStyle(AedstColor.foreground)
            .lineLimit(1)
            .truncationMode(.middle)
            .environment(\.layoutDirection, .leftToRight)
    }
}

/// Buttons or a badge beside a file.
public struct AedstAiFileTreeActions<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) { content }
            .fixedSize()
    }
}

#Preview("AedstAiFileTree") {
    @Previewable @State var state = AedstAiFileTreeState(expanded: ["src", "src/ui"], selectedPath: "src/ui/button.tsx")
    AedstAiFileTree(state: state, accessibilityLabel: "Changed files") {
        AedstAiFileTreeFolder(path: "src", name: "src") {
            AedstAiFileTreeFolder(path: "src/ui", name: "ui") {
                AedstAiFileTreeFile(path: "src/ui/button.tsx", name: "button.tsx") {
                    AedstBadge("M", variant: .secondary)
                }
                AedstAiFileTreeFile(path: "src/ui/card.tsx", name: "card.tsx")
            }
        }
        AedstAiFileTreeFile(path: "package.json", name: "package.json")
    }
    .padding()
}

#endif
