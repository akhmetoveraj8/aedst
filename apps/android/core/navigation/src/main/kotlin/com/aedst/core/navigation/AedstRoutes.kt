package com.aedst.core.navigation

/**
 * Server in-app links (`Notification.link`, `SearchHit.link`, e.g. `/tasks/<id>`) and their mapping to typed
 * [AedstKey]s — the navigation-contract equivalent of a server module publishing a stable RPC method name instead
 * of another module importing its handler package.
 *
 * A link is validated into a *route* ([routeForLink], the link without the leading slash) and then resolved to a key
 * ([keyForRoute]); [keyForLink] does both. Anything else yields `null`.
 */
object AedstRoutes {
    /** Intent extra (and FCM `data` key) carrying a server in-app link such as `/tasks/<id>`. */
    const val EXTRA_LINK = "link"

    private const val TASKS = "tasks"
    private const val SEARCH = "search"
    private const val NOTIFICATIONS = "notifications"
    private const val MEDIA = "media"
    private const val ADMIN = "admin"

    private const val MAX_SEGMENTS = 2
    private val LINK_PREFIXES = listOf(TASKS, MEDIA, NOTIFICATIONS, SEARCH, ADMIN)
    private val SAFE_SEGMENT = Regex("^[A-Za-z0-9_-]{1,64}$")

    /**
     * Maps a server-provided relative in-app link (`/tasks/<id>`) to a route, or `null` when it is not a link this
     * app understands. Absolute URLs, protocol-relative `//host` links, query strings and unexpected segments are
     * rejected, so a notification payload can never navigate to an arbitrary destination.
     */
    fun routeForLink(link: String?): String? {
        if (link.isNullOrBlank() || !link.startsWith("/") || link.startsWith("//")) return null
        val path = link.substringBefore('?').substringBefore('#').trim('/')
        val segments = path.split('/')
        if (segments.isEmpty() || segments.size > MAX_SEGMENTS || segments.first() !in LINK_PREFIXES) return null
        if (!segments.all(SAFE_SEGMENT::matches)) return null
        return path
    }

    /** Resolves a route accepted by [routeForLink] to its key, or `null` for routes without a screen. */
    fun keyForRoute(route: String?): AedstKey? {
        if (route.isNullOrBlank()) return null
        val segments = route.split('/')
        val id = segments.getOrNull(1)
        return when (segments.first()) {
            TASKS -> if (segments.size == 1) TaskListKey else id?.let(::TaskDetailKey)
            MEDIA -> if (segments.size == 1) MediaLibraryKey else id?.let(::MediaDetailKey)
            NOTIFICATIONS -> NotificationsKey.takeIf { segments.size == 1 }
            SEARCH -> SearchKey.takeIf { segments.size == 1 }
            ADMIN -> AdminKey.takeIf { segments.size == 1 }
            else -> null
        }.takeIf { segments.size <= MAX_SEGMENTS }
    }

    /**
     * The capability id (`AedstFeature`) a route needs: its first segment (`tasks/<id>` -> `tasks`), so a link into a
     * feature the server switched off can be dropped. `null` for a route this app does not know.
     */
    fun featureForRoute(route: String?): String? = route?.substringBefore('/')?.takeIf { it in LINK_PREFIXES }

    /**
     * The in-app link carried by an Android App Link (`ACTION_VIEW` of `https://<host>/tasks/<id>`): its path, so it goes
     * through the same [routeForLink] validation as a notification link. Any other scheme is not an App Link and yields
     * `null`; the host is the manifest's business (the intent filter only matches the verified host).
     */
    fun linkForAppLink(scheme: String?, path: String?): String? = path.takeIf { scheme == "https" }

    /** Validates a server link and resolves it to the destination it opens, or `null`. */
    fun keyForLink(link: String?): AedstKey? = keyForRoute(routeForLink(link))
}
