/// Marker every route value conforms to. All route enums live in `AedstRoutes.swift` in this package, so any
/// feature can push any screen onto the shared `Router` (`router.push(MediaRoute.detail(id: id))`) without
/// importing the feature that renders it. Each feature registers the view builder for its own route type with its
/// `*Destinations` modifier, and `App/Shared` (which links every feature) attaches those modifiers to the root
/// `AedstNavigationStack`.
///
/// This is the Swift analogue of `AedstNavGraph`/`AedstRoutes` in `apps/android/core/navigation`: the seam that
/// keeps feature modules from depending on each other.
///
/// `Codable` so the whole `NavigationPath` can be saved and restored (`Router.persistedData()`, scene restoration).
/// Route cases are a persisted format across launches: add cases, do not rename or repurpose one.
public protocol AedstRoute: Hashable, Sendable, Codable {}
