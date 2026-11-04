import AedstCore
import Foundation

/// One result of `SearchService.Search`.
public struct SearchHit: Sendable, Equatable, Identifiable {
    /// The owning module of the document.
    public enum Kind: Sendable, Equatable {
        case task
        case media
        case other
    }

    public let kind: Kind
    /// Id in the owning module (task id for `.task`).
    public let id: String
    public let title: String
    /// Raw snippet with U+E000/U+E001 highlight markers (see `SnippetHighlighter`).
    public let snippet: String
    /// Relative in-app route, e.g. `/tasks/<id>`.
    public let link: String
    public let updatedAt: Date?

    /// Memberwise initializer.
    public init(kind: Kind, id: String, title: String, snippet: String, link: String, updatedAt: Date? = nil) {
        self.kind = kind
        self.id = id
        self.title = title
        self.snippet = snippet
        self.link = link
        self.updatedAt = updatedAt
    }
}

/// The seam to `SearchService`.
public protocol SearchRepository: Sendable {
    /// One page of hits for `query` (1...200 characters, enforced server-side too).
    func search(query: String, pageToken: String?) async -> Outcome<Page<SearchHit>>
}

/// Turns the server's highlight markers into an `AttributedString` so each
/// client renders highlighting natively, without parsing HTML (search.proto:
/// "matched terms are wrapped in U+E000 / U+E001").
///
/// Highlighted runs get `inlinePresentationIntent = .stronglyEmphasized`
/// (rendered bold by SwiftUI `Text`). Unbalanced or
/// stray markers never leak into the output.
public enum SnippetHighlighter {
    /// Opening marker.
    public static let open: Character = "\u{E000}"
    /// Closing marker.
    public static let close: Character = "\u{E001}"

    /// The snippet with highlighted runs marked.
    public static func attributedString(from raw: String) -> AttributedString {
        var result = AttributedString()
        var buffer = ""
        var isHighlighted = false

        func flush() {
            guard !buffer.isEmpty else { return }
            var run = AttributedString(buffer)
            if isHighlighted {
                run.inlinePresentationIntent = .stronglyEmphasized
            }
            result += run
            buffer = ""
        }

        for character in raw {
            switch character {
            case open:
                flush()
                isHighlighted = true
            case close:
                flush()
                isHighlighted = false
            default:
                buffer.append(character)
            }
        }
        flush()
        return result
    }

    /// The snippet without markers (accessibility labels, copy).
    public static func plainText(from raw: String) -> String {
        String(raw.filter { $0 != open && $0 != close })
    }
}
