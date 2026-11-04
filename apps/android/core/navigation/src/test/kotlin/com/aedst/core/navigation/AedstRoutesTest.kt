package com.aedst.core.navigation

import com.aedst.core.common.AedstFeature
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class AedstRoutesTest {

    @Test
    fun `relative in-app links map to routes`() {
        assertEquals("tasks/3f2a", AedstRoutes.routeForLink("/tasks/3f2a"))
        assertEquals("notifications", AedstRoutes.routeForLink("/notifications"))
        assertEquals("media/abc-1", AedstRoutes.routeForLink("/media/abc-1?x=1#y"))
    }

    @Test
    fun `absolute, protocol-relative and unknown links are rejected`() {
        assertNull(AedstRoutes.routeForLink("https://evil.example/tasks/1"))
        assertNull(AedstRoutes.routeForLink("//evil.example/tasks/1"))
        assertNull(AedstRoutes.routeForLink("/unknown/1"))
        assertNull(AedstRoutes.routeForLink("/tasks/../admin"))
        assertNull(AedstRoutes.routeForLink("/tasks/1/2"))
        assertNull(AedstRoutes.routeForLink(""))
        assertNull(AedstRoutes.routeForLink(null))
    }

    @Test
    fun `valid links resolve to typed keys`() {
        assertEquals(TaskListKey, AedstRoutes.keyForLink("/tasks"))
        assertEquals(TaskDetailKey("3f2a"), AedstRoutes.keyForLink("/tasks/3f2a"))
        assertEquals(MediaLibraryKey, AedstRoutes.keyForLink("/media"))
        assertEquals(MediaDetailKey("abc-1"), AedstRoutes.keyForLink("/media/abc-1?x=1#y"))
        assertEquals(NotificationsKey, AedstRoutes.keyForLink("/notifications"))
        assertEquals(SearchKey, AedstRoutes.keyForLink("/search"))
        assertEquals(AdminKey, AedstRoutes.keyForLink("/admin"))
    }

    @Test
    fun `invalid links never resolve to a key`() {
        assertNull(AedstRoutes.keyForLink("https://evil.example/tasks/1"))
        assertNull(AedstRoutes.keyForLink("//evil.example/tasks/1"))
        assertNull(AedstRoutes.keyForLink("/tasks/../admin"))
        assertNull(AedstRoutes.keyForLink("/tasks/1/2"))
        assertNull(AedstRoutes.keyForLink("/unknown"))
        assertNull(AedstRoutes.keyForLink(null))
    }

    @Test
    fun `valid routes without a screen resolve to null`() {
        // Accepted by the link validator (known prefix, two safe segments) but no destination takes an id.
        assertEquals("notifications/abc", AedstRoutes.routeForLink("/notifications/abc"))
        assertNull(AedstRoutes.keyForLink("/notifications/abc"))
        assertNull(AedstRoutes.keyForLink("/admin/x"))
        assertNull(AedstRoutes.keyForRoute(null))
        assertNull(AedstRoutes.keyForRoute(""))
    }

    @Test
    fun `a route names the feature it needs`() {
        assertEquals("tasks", AedstRoutes.featureForRoute("tasks/3f2a"))
        assertEquals("notifications", AedstRoutes.featureForRoute("notifications"))
        assertNull(AedstRoutes.featureForRoute("unknown/1"))
        assertNull(AedstRoutes.featureForRoute(null))
    }

    @Test
    fun `route prefixes are the capability feature ids`() {
        val ids = listOf(
            AedstFeature.TASKS,
            AedstFeature.MEDIA,
            AedstFeature.NOTIFICATIONS,
            AedstFeature.SEARCH,
            AedstFeature.ADMIN,
        )
        ids.forEach { assertEquals(it, AedstRoutes.featureForRoute(it)) }
    }

    @Test
    fun `an https App Link path is validated like a notification link`() {
        val link = AedstRoutes.linkForAppLink("https", "/tasks/abc-123")

        assertEquals("/tasks/abc-123", link)
        assertEquals(TaskDetailKey("abc-123"), AedstRoutes.keyForLink(link))
    }

    @Test
    fun `only https counts as an App Link, and an unknown path still resolves to nothing`() {
        assertEquals(null, AedstRoutes.linkForAppLink("http", "/tasks/abc"))
        assertEquals(null, AedstRoutes.linkForAppLink("aedst", "/tasks/abc"))
        assertEquals(null, AedstRoutes.linkForAppLink("https", null))
        assertEquals(null, AedstRoutes.keyForLink(AedstRoutes.linkForAppLink("https", "/settings/secret")))
    }
}
