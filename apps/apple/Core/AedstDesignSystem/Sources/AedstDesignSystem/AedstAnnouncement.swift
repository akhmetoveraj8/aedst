import SwiftUI

/// What the design system says out loud, and for how long things stay on screen, when VoiceOver is running.
/// Pure functions, so the policy is unit-tested without a screen reader.
public enum AedstAnnouncementPolicy {
    /// A toast stays this many times longer while VoiceOver reads it.
    public static let voiceOverDurationMultiplier: TimeInterval = 3
    /// ...and never shorter than this (seconds).
    public static let minimumVoiceOverDuration: TimeInterval = 8

    /// How long a transient message (toast) is shown.
    public static func displayDuration(base: TimeInterval, voiceOverRunning: Bool) -> TimeInterval {
        guard voiceOverRunning else { return base }
        return max(base * voiceOverDurationMultiplier, minimumVoiceOverDuration)
    }

    /// The sentence announced for a toast: the title, then the message when there is one.
    public static func spokenText(title: String, message: String?) -> String {
        guard let message, !message.isEmpty else { return title }
        return "\(title). \(message)"
    }

    /// The text to announce when an inline error changes from `previous` to `current`: only a new, non-empty error
    /// is spoken (not its disappearance, and not the same text again).
    public static func announcement(previous: String?, current: String?) -> String? {
        guard let current, !current.isEmpty, current != previous else { return nil }
        return current
    }
}

/// Posts a VoiceOver announcement (`AccessibilityNotification.Announcement`, iOS 17 / macOS 14 and later).
@MainActor
public enum AedstAnnouncer {
    public static func post(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}
