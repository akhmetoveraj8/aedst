import AedstAppCore
import AedstDesignSystem
import AedstNavigation
import AuthUIMac
import SwiftUI

/// The navigation shell of the macOS build; `App/iOS/Sources/RootView.swift` is the iOS one. This and
/// `FeatureDestinations` are the only places that know every feature's Mac UI. State and rules come from
/// `AedstAppCore` (`RootViewModel`, `AppLink`, `DeepLink`), the same code the iOS build runs.
///
/// Sidebar first: signed in, the window is always a `NavigationSplitView` with the sections in the sidebar and the
/// `Router`'s stack as the detail column (no size classes on the Mac). Signed out, it is the sign-in stack alone.
/// Sections are also menu commands (`AppCommands`), and settings live in the Settings window (`PreferencesView`).
struct RootView: View {
    @State private var router = Router()
    @State private var model: RootViewModel
    @State private var selection: SidebarEntry?
    @Environment(\.scenePhase) private var scenePhase
    /// The navigation stack of this window, restored after a relaunch (routes are `Codable`).
    @SceneStorage("aedst.path") private var savedPath: Data?
    private let dependencies: AppDependencies

    @MainActor
    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        self._model = State(wrappedValue: RootViewModel(dependencies: dependencies))
    }

    var body: some View {
        // Read here, inside the body, so Observation re-renders (and republishes the menu state) when it changes.
        let entries = availableEntries
        ZStack {
            navigation(entries: entries)

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
        // The menu bar acts on the key window through this value (see `AppCommands`).
        .focusedSceneValue(\.sidebarNavigation, SidebarNavigation(entries: entries, open: select))
        .task { await model.run() }
        .task {
            for await link in dependencies.linkInbox.links {
                open(link)
            }
        }
        .onChange(of: scenePhase) { _, phase in model.handleScenePhase(phase) }
        .onChange(of: model.session) { _, session in
            if session == nil {
                selection = nil
                router.popToRoot()
            }
        }
        .onChange(of: model.hasRestored) { _, restored in
            // Back to where the user was, once the session is known. A signed-out launch starts at the root.
            if restored, model.isSignedIn { router.restore(from: savedPath) }
        }
        .onChange(of: [router.path.count, router.revision]) {
            savedPath = model.isSignedIn ? router.persistedData() : nil
        }
        .onChange(of: selection) { _, entry in
            if let entry { show(entry) }
        }
        .onOpenURL { url in
            guard let link = DeepLink(url: url) else { return }
            handle(link)
        }
    }

    // MARK: Layout

    /// The sections this user may open now: built, enabled by the server, and (admin) allowed by the role.
    private var availableEntries: [SidebarEntry] {
        guard model.isSignedIn else { return [] }
        return SidebarEntry.allCases.filter { entry in
            model.isFeatureEnabled(entry.feature) && (entry != .admin || model.isAdmin)
        }
    }

    @ViewBuilder
    private func navigation(entries: [SidebarEntry]) -> some View {
        if model.isSignedIn {
            NavigationSplitView {
                SidebarView(entries: entries, badge: dependencies.badge, selection: $selection) {
                    Task { await model.signOut() }
                }
                .navigationSplitViewColumnWidth(min: 180, ideal: 220)
            } detail: {
                AedstNavigationStack(router: router) {
                    SelectSectionPlaceholder()
                        .modifier(FeatureDestinations(dependencies: dependencies, router: router, open: open))
                }
            }
        } else {
            AedstNavigationStack(router: router) {
                SignInPromptView(router: router)
                    .authDestinations {
                        LoginView(
                            viewModel: dependencies.makeLoginViewModel(),
                            onLoginSucceeded: { session in
                                model.didSignIn(session)
                                router.popToRoot()
                            }
                        )
                    }
            }
        }
    }

    /// A menu command chose a section: select its sidebar row (which shows it), or show it again when the row is
    /// already selected, so the command also returns to the section's first screen.
    private func select(_ entry: SidebarEntry) {
        guard availableEntries.contains(entry) else { return }
        if selection == entry {
            show(entry)
        } else {
            selection = entry
        }
    }

    /// Replaces the detail column's content with the section's first screen.
    private func show(_ entry: SidebarEntry) {
        switch entry {
        case .tasks: router.replace(with: TaskRoute.list)
        case .search: router.replace(with: SearchRoute.search)
        case .notifications: router.replace(with: NotificationsRoute.inbox)
        case .media: router.replace(with: MediaRoute.library)
        case .admin: router.replace(with: AdminRoute.dashboard)
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

/// The signed-out window: the brand and the sign-in button.
private struct SignInPromptView: View {
    let router: Router

    var body: some View {
        VStack(spacing: AedstSpacing.lg) {
            Text(verbatim: "AEDST") // brand name, not translated
                .aedstFont(AedstTypography.largeTitle)
                .accessibilityAddTraits(.isHeader)
            AedstButton(String(localized: "appSignIn", bundle: AppStrings.bundle)) {
                router.push(AuthRoute.login)
            }
            .accessibilityIdentifier("start.signIn")
        }
        .padding(AedstSpacing.xxl)
        .frame(maxWidth: 480)
    }
}
