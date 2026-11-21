import AedstDesignSystem
import AedstNavigation
import Auth
import Media
import Notifications
import Search
import SwiftUI
import Tasks

/// The one navigation shell shared by iOS and macOS — each app target's `@main` scene wraps this in its own
/// platform chrome but the destinations and the `Router` are identical, same as `AppNavHost.kt` composing every
/// Android `feature/*`'s navigation entry point. This is the only place that knows every feature: cross-feature
/// wiring (task detail → media attachments, search/notification links → routes) happens here.
///
/// Layout adapts to the width: compact (iPhone, iPad in split view) is one `NavigationStack` rooted at the home
/// list; regular width (iPad full screen) and macOS use a `NavigationSplitView` with the home list as the sidebar
/// and the same `Router`'s stack as the detail column. Signed-out always shows the single stack.
public struct RootView: View {
    @State private var router = Router()
    @State private var model: RootViewModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    /// The navigation stack of this scene, restored after a relaunch (routes are `Codable`).
    @SceneStorage("aedst.path") private var savedPath: Data?
    private let dependencies: AppDependencies

    @MainActor
    public init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        self._model = State(wrappedValue: RootViewModel(dependencies: dependencies))
    }

    public var body: some View {
        ZStack {
            navigation

            VStack(spacing: 0) {
                if !model.isOnline {
                    OfflineBanner()
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                Spacer(minLength: 0)
            }
            .aedstAnimation(.easeOut(duration: AedstMotion.durationNormal), value: model.isOnline)

            if model.showsLockScreen {
                LockView(model: model)
            }

            // Above everything, including the lock: a refused app version cannot be used at all.
            if model.isUpgradeRequired {
                UpgradeRequiredView(appStoreURL: model.appStoreURL)
            }
        }
        .background(AedstColor.background)
        .environment(router)
        .environment(\.aedstSensitiveContent, dependencies.sensitiveContentMasker)
        .task { await model.run() }
        .task {
            for await link in dependencies.linkInbox.links {
                open(link)
            }
        }
        .onChange(of: scenePhase) { _, phase in model.handleScenePhase(phase) }
        .onChange(of: model.session) { _, session in
            if session == nil { router.popToRoot() }
        }
        .onChange(of: model.hasRestored) { _, restored in
            // Back to where the user was, once the session is known. A signed-out launch starts at the root.
            if restored, model.isSignedIn { router.restore(from: savedPath) }
        }
        .onChange(of: [router.path.count, router.revision]) {
            savedPath = model.isSignedIn ? router.persistedData() : nil
        }
        .onOpenURL { url in
            guard let link = DeepLink(url: url) else { return }
            handle(link)
        }
    }

    // MARK: Layout

    /// Regular width, or macOS (always): the split layout; only while signed in.
    private var usesSplitView: Bool {
        #if os(macOS)
        let isMac = true
        #else
        let isMac = false
        #endif
        return RootLayout.usesSplitView(
            isSignedIn: model.isSignedIn,
            horizontalSizeClass: horizontalSizeClass,
            isMac: isMac
        )
    }

    @ViewBuilder
    private var navigation: some View {
        if usesSplitView {
            NavigationSplitView {
                HomeView(model: model, badge: dependencies.badge, select: show)
            } detail: {
                AedstNavigationStack(router: router) {
                    SelectSectionPlaceholder()
                        .modifier(FeatureDestinations(dependencies: dependencies, router: router, open: open))
                }
            }
        } else {
            AedstNavigationStack(router: router) {
                StartView(model: model, router: router, badge: dependencies.badge, select: show)
                    .authDestinations {
                        LoginView(
                            viewModel: dependencies.makeLoginViewModel(),
                            onLoginSucceeded: { session in
                                model.didSignIn(session)
                                router.popToRoot()
                            }
                        )
                    }
                    .modifier(FeatureDestinations(dependencies: dependencies, router: router, open: open))
            }
        }
    }

    /// A home entry was chosen: in the split layout it replaces the detail column's content, in the compact one it
    /// pushes onto the stack.
    private func show(_ entry: HomeEntry) {
        switch entry {
        case .tasks: go(TaskRoute.list)
        case .search: go(SearchRoute.search)
        case .notifications: go(NotificationsRoute.inbox)
        case .media: go(MediaRoute.library)
        case .admin: go(AdminRoute.dashboard)
        }
    }

    private func go(_ route: some AedstRoute) {
        if usesSplitView {
            router.replace(with: route)
        } else {
            router.push(route)
        }
    }

    // MARK: Links

    private func handle(_ link: DeepLink) {
        switch link {
        case .login:
            guard !model.isSignedIn else { return }
            router.replace(with: AuthRoute.login)
        }
    }

    /// Routes a relative in-app link (notification, search hit, push payload).
    /// Unknown links and links to areas the user cannot open are ignored.
    private func open(_ path: String) {
        guard model.isSignedIn, let link = AppLink(path: path), model.isFeatureEnabled(link.feature) else { return }
        dependencies.analytics.addBreadcrumb("open \(path)", category: "navigation")
        switch link {
        case .tasks: router.push(TaskRoute.list)
        case .task(let id): router.push(TaskRoute.detail(id: id))
        case .media: router.push(MediaRoute.library)
        case .mediaItem(let id): router.push(MediaRoute.detail(id: id))
        case .notifications: router.push(NotificationsRoute.inbox)
        case .search: router.push(SearchRoute.search)
        case .admin:
            if model.isAdmin { router.push(AdminRoute.dashboard) }
        }
    }
}

/// The compact layout's root: the sign-in prompt, or the home list once signed in.
private struct StartView: View {
    let model: RootViewModel
    let router: Router
    let badge: UnreadBadgeModel
    let select: (HomeEntry) -> Void

    var body: some View {
        if model.isSignedIn {
            HomeView(model: model, badge: badge, select: select)
        } else {
            VStack(spacing: AedstSpacing.lg) {
                Text(verbatim: "AEDST") // brand name, not translated
                    .aedstFont(AedstTypography.largeTitle)
                    .accessibilityAddTraits(.isHeader)
                AedstButton(String(localized: "appSignIn", bundle: .module)) {
                    router.push(AuthRoute.login)
                }
                .accessibilityIdentifier("start.signIn")
            }
            .padding(AedstSpacing.xxl)
            .frame(maxWidth: 480)
        }
    }
}
