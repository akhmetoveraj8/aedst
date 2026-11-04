import AedstCore
import Foundation

/// Uploads files straight to object storage (presigned PUT) through a
/// **background** `URLSession`: the transfer is owned by the system and keeps
/// going while the app is suspended, with per-task progress while it runs.
///
/// - One session per process (the identifier must be unique); it is created
///   lazily so unit tests and previews never open one.
/// - `taskDescription` carries the caller's id (the media id). If the app was
///   terminated mid-upload, the system relaunches it in the background and
///   reports the result to `orphanCompletionHandler`, which lets the caller
///   finish the protocol (`CompleteUpload`) without the original `await`.
/// - iOS: the app delegate forwards
///   `application(_:handleEventsForBackgroundURLSession:completionHandler:)`
///   and the uploader calls `eventsFinishedHandler` when the session drained.
///
/// State is guarded by one lock: delegate callbacks arrive on the session's
/// own serial queue, `upload` is called from any task.
public final class BackgroundUploader: NSObject, @unchecked Sendable {
    /// Background session identifier (also matched in the app delegate).
    public static let sessionIdentifier = "com.aedst.apple.media-upload"

    /// Result for an upload whose `await` no longer exists (app was relaunched).
    public typealias OrphanCompletionHandler = @Sendable (_ taskDescription: String, _ statusCode: Int?, _ error: Error?) -> Void

    private struct Waiter {
        let continuation: CheckedContinuation<Int, Error>
        let progress: @Sendable (Double) -> Void
    }

    private let lock = NSLock()
    private var session: URLSession?
    private var waiters: [Int: Waiter] = [:]
    private var orphanHandler: OrphanCompletionHandler?
    private var eventsFinishedHandler: (@Sendable () -> Void)?
    private let identifier: String

    /// `identifier` defaults to `sessionIdentifier`.
    public init(identifier: String = BackgroundUploader.sessionIdentifier) {
        self.identifier = identifier
        super.init()
    }

    /// Re-attaches to the background session (call at launch and when the
    /// system delivers background session events) so pending results arrive.
    public func activate() {
        _ = currentSession()
    }

    /// Receives results for uploads started by a previous process.
    public func setOrphanCompletionHandler(_ handler: @escaping OrphanCompletionHandler) {
        lock.withLock { orphanHandler = handler }
    }

    /// Called once the background session finished delivering events.
    public func setEventsFinishedHandler(_ handler: @escaping @Sendable () -> Void) {
        lock.withLock { eventsFinishedHandler = handler }
    }

    /// Uploads `fileURL` and returns the HTTP status code (2xx on success; any
    /// other status is thrown as `AedstError`). `progress` receives 0...1.
    public func upload(
        fileURL: URL,
        to destination: URL,
        method: String,
        headers: [String: String],
        taskDescription: String,
        progress: @escaping @Sendable (Double) -> Void
    ) async throws -> Int {
        var request = URLRequest(url: destination)
        request.httpMethod = method.isEmpty ? "PUT" : method
        for (field, value) in headers {
            request.setValue(value, forHTTPHeaderField: field)
        }
        let task = currentSession().uploadTask(with: request, fromFile: fileURL)
        task.taskDescription = taskDescription

        let status = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int, Error>) in
                lock.withLock {
                    waiters[task.taskIdentifier] = Waiter(continuation: continuation, progress: progress)
                }
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
        guard (200..<300).contains(status) else {
            throw status == 403
                ? AedstError.unauthenticated // expired/invalid presigned URL
                : AedstError.unavailable(reason: "Upload failed with HTTP \(status)")
        }
        return status
    }

    private func currentSession() -> URLSession {
        lock.withLock {
            if let session { return session }
            let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
            configuration.isDiscretionary = false
            configuration.sessionSendsLaunchEvents = true
            configuration.httpCookieStorage = nil
            configuration.urlCache = nil
            let created = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            session = created
            return created
        }
    }
}

extension BackgroundUploader: URLSessionTaskDelegate {
    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard totalBytesExpectedToSend > 0 else { return }
        let fraction = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
        let waiter = lock.withLock { waiters[task.taskIdentifier] }
        waiter?.progress(min(max(fraction, 0), 1))
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let status = (task.response as? HTTPURLResponse)?.statusCode
        let (waiter, orphan) = lock.withLock { (waiters.removeValue(forKey: task.taskIdentifier), orphanHandler) }

        guard let waiter else {
            orphan?(task.taskDescription ?? "", status, error)
            return
        }
        if let error {
            waiter.continuation.resume(throwing: AedstError.unavailable(reason: error.localizedDescription))
        } else {
            waiter.progress(1)
            waiter.continuation.resume(returning: status ?? 0)
        }
    }
}

extension BackgroundUploader: URLSessionDelegate {
    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let handler = lock.withLock { eventsFinishedHandler }
        handler?()
    }
}
