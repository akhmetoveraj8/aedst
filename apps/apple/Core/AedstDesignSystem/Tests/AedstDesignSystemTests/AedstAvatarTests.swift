import Testing
@testable import AedstDesignSystem

@Suite("AedstAvatar")
struct AedstAvatarTests {
    @Test("initials are the first letters of the first two words, uppercased")
    func initials() {
        #expect(AedstAvatarInitials.make(from: "ada lovelace") == "AL")
        #expect(AedstAvatarInitials.make(from: "Ada Augusta Lovelace") == "AA")
        #expect(AedstAvatarInitials.make(from: "Plato") == "P")
    }

    @Test("blank names give no initials and extra whitespace is ignored")
    func blank() {
        #expect(AedstAvatarInitials.make(from: "").isEmpty)
        #expect(AedstAvatarInitials.make(from: "   ").isEmpty)
        #expect(AedstAvatarInitials.make(from: "  Ada   Lovelace ") == "AL")
    }

    @Test("sizes grow in order")
    func sizes() {
        #expect(AedstAvatarSize.sm.dimension < AedstAvatarSize.default.dimension)
        #expect(AedstAvatarSize.default.dimension < AedstAvatarSize.lg.dimension)
    }
}
