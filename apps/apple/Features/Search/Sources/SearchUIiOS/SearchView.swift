#if os(iOS)
import AedstDesignSystem
import SearchDomain
import SearchPresentation
import SwiftUI

/// Global search (`.searchable`). Selecting a hit calls `onOpenLink`
/// with its relative in-app route; the app target resolves it to a route value.
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
                Text(String(localized: "searchNoResults", bundle: SearchStrings.bundle))
                    .foregroundStyle(AedstColor.mutedForeground)
            } else if viewModel.query.isEmpty {
                Text(String(localized: "searchHint", bundle: SearchStrings.bundle))
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
        .searchable(text: $viewModel.query, prompt: Text(String(localized: "searchPrompt", bundle: SearchStrings.bundle)))
        .disableAutocorrection(true)
        .navigationTitle(String(localized: "searchTitle", bundle: SearchStrings.bundle))
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
#endif
