import AedstDesignSystem
import SwiftUI

/// Global search (`.searchable`). Selecting a hit calls `onOpenLink`
/// with its relative in-app route; `App/Shared` resolves it to a route value.
public struct SearchView: View {
    @State private var viewModel: SearchViewModel
    private let onOpenLink: (String) -> Void

    /// `onOpenLink` receives `SearchHit.link` (e.g. `/tasks/<id>`).
    public init(viewModel: SearchViewModel, onOpenLink: @escaping (String) -> Void) {
        self._viewModel = State(wrappedValue: viewModel)
        self.onOpenLink = onOpenLink
    }

    public var body: some View {
        @Bindable var viewModel = viewModel

        List {
            if viewModel.hasResults, viewModel.hits.isEmpty {
                Text(String(localized: "searchNoResults", bundle: .module))
                    .foregroundStyle(AedstColor.mutedForeground)
            } else if viewModel.query.isEmpty {
                Text(String(localized: "searchHint", bundle: .module))
                    .foregroundStyle(AedstColor.mutedForeground)
            }
            ForEach(viewModel.hits) { hit in
                Button {
                    onOpenLink(hit.link)
                } label: {
                    SearchHitRow(hit: hit)
                }
                .buttonStyle(.plain)
                .task { await viewModel.loadMoreIfNeeded(after: hit) }
            }
            if viewModel.isSearching {
                AedstProgressView(style: .circular)
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel(Text(AedstCommonStrings.loading))
            }
        }
        .searchable(text: $viewModel.query, prompt: Text(String(localized: "searchPrompt", bundle: .module)))
        .disableAutocorrection(true)
        .navigationTitle(String(localized: "searchTitle", bundle: .module))
        .aedstErrorPresenter($viewModel.error)
    }
}

private struct SearchHitRow: View {
    let hit: SearchHit

    var body: some View {
        HStack(alignment: .top, spacing: AedstSpacing.md) {
            Image(systemName: icon)
                .foregroundStyle(AedstColor.mutedForeground)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                Text(hit.title)
                    .aedstFont(AedstTypography.headline)
                if !hit.snippet.isEmpty {
                    Text(SnippetHighlighter.attributedString(from: hit.snippet))
                        .aedstFont(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                        .lineLimit(3)
                        .accessibilityLabel(Text(SnippetHighlighter.plainText(from: hit.snippet)))
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .aedstSensitive()
    }

    private var icon: String {
        switch hit.kind {
        case .task: "checklist"
        case .media: "photo"
        case .other: "doc.text"
        }
    }
}
