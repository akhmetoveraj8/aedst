#if os(iOS) || os(macOS) || os(visionOS)
import Foundation
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiContext")
struct AedstAiContextTests {
    private let english = Locale(identifier: "en_US")

    @Test("the ratio is clamped to 0...1 and is 0 for an unknown window")
    func ratio() {
        #expect(AedstAiContextValue(usedTokens: 50, maxTokens: 200).ratio == 0.25)
        #expect(AedstAiContextValue(usedTokens: 500, maxTokens: 200).ratio == 1)
        #expect(AedstAiContextValue(usedTokens: -5, maxTokens: 200).ratio == 0)
        #expect(AedstAiContextValue(usedTokens: 50, maxTokens: 0).ratio == 0)
    }

    @Test("percent has no fraction digits")
    func percent() {
        #expect(AedstAiContextValue.formatPercent(0.25, locale: english) == "25%")
        #expect(AedstAiContextValue.formatPercent(0.244, locale: english) == "24%")
    }

    @Test("token counts are compact with at most one fraction digit")
    func compactTokens() {
        #expect(AedstAiContextValue.formatTokens(128_000, locale: english) == "128K")
        #expect(AedstAiContextValue.formatTokens(48_200, locale: english) == "48.2K")
        #expect(AedstAiContextValue.formatTokens(950, locale: english) == "950")
    }

    @Test("formatting follows the locale")
    func localised() {
        let russian = AedstAiContextValue.formatTokens(48_200, locale: Locale(identifier: "ru_RU"))
        #expect(russian != AedstAiContextValue.formatTokens(48_200, locale: english))
    }

    @Test("each usage row reads its own count and hides a missing one")
    func usageRows() {
        let usage = AedstAiContextUsage(inputTokens: 10, outputTokens: 20, cachedInputTokens: 5)
        #expect(AedstAiContextUsageKind.input.tokens(in: usage) == 10)
        #expect(AedstAiContextUsageKind.output.tokens(in: usage) == 20)
        #expect(AedstAiContextUsageKind.reasoning.tokens(in: usage) == nil)
        #expect(AedstAiContextUsageKind.cache.tokens(in: usage) == 5)
        #expect(AedstAiContextUsageKind.input.tokens(in: nil) == nil)
    }
}
#endif
