import os

/// Thin `os.Logger` facade so features log through one type (and so
/// `AedstAnalytics` can later tap the same categories) instead of each
/// module rolling its own `Logger(subsystem:category:)` boilerplate.
public struct AedstLogger: Sendable {
    private let logger: Logger

    public init(category: String, subsystem: String = "com.aedst.apple") {
        self.logger = Logger(subsystem: subsystem, category: category)
    }

    public func debug(_ message: @autoclosure () -> String) {
        logger.debug("\(message(), privacy: .public)")
    }

    public func info(_ message: @autoclosure () -> String) {
        logger.info("\(message(), privacy: .public)")
    }

    public func error(_ message: @autoclosure () -> String, error: Error? = nil) {
        if let error {
            logger.error("\(message(), privacy: .public) — \(String(describing: error), privacy: .private)")
        } else {
            logger.error("\(message(), privacy: .public)")
        }
    }
}
