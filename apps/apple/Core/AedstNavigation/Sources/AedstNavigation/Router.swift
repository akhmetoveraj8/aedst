import Foundation
import Observation
import SwiftUI

/// One `NavigationPath`-backed router, owned at the app root and pushed to by every
/// feature's presentation layer. Features depend on `AedstNavigation` (this
/// package) only — never on each other — exactly like Android features only
/// depend on `core/navigation`'s `AedstNavGraph` contract.
///
/// `@Observable` is the system Observation framework; `AedstNavigationStack`
/// binds to `path`. Hand the router to a view either explicitly
/// (`StartView(router: router)`) or through `@Environment(Router.self)`;
/// `AedstNavigationStack` is the one container that renders it.
@MainActor
@Observable
public final class Router {
    /// Bound by `AedstNavigationStack`; mutate through `push`/`pop`/`popToRoot`/`replace`
    /// rather than directly (it is `public` only so SwiftUI can bind to it).
    public var path = NavigationPath()

    /// Bumped by every mutation made through this type's methods. With `path.count` it lets a view notice any change
    /// to the stack (a `replace` keeps the count; a back swipe changes only the count) without needing `NavigationPath`
    /// to be `Equatable`; used to save the stack for scene restoration.
    public private(set) var revision = 0

    /// Creates an empty router.
    public init() {}

    /// Pushes `route` onto the stack.
    public func push(_ route: some AedstRoute) {
        path.append(route)
        revision += 1
    }

    /// Pops the top route; no-op on an empty stack.
    public func pop() {
        guard !path.isEmpty else { return }
        path.removeLast()
        revision += 1
    }

    /// Removes every pushed route.
    public func popToRoot() {
        path = NavigationPath()
        revision += 1
    }

    /// Clears the stack, then pushes `route`.
    public func replace(with route: some AedstRoute) {
        popToRoot()
        push(route)
    }

    // MARK: Restoration

    /// The stack encoded for `@SceneStorage` (`nil` when empty or when it cannot be encoded). Every `AedstRoute`
    /// is `Codable`, so a path built through `push` always encodes.
    public func persistedData() -> Data? {
        guard !path.isEmpty, let representation = path.codable else { return nil }
        return try? JSONEncoder().encode(representation)
    }

    /// Replaces the stack with one saved by `persistedData()`. Unreadable data (a route renamed by an update, a
    /// corrupt value) leaves the stack alone: restoring is a convenience, never a reason to fail.
    /// - Returns: `true` when the stack was restored.
    @discardableResult
    public func restore(from data: Data?) -> Bool {
        guard let data,
            let representation = try? JSONDecoder().decode(NavigationPath.CodableRepresentation.self, from: data)
        else { return false }
        path = NavigationPath(representation)
        revision += 1
        return true
    }
}
