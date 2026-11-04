package com.aedst.core.network.contract

import com.connectrpc.StreamType

/**
 * The RPCs the Android app actually calls, as `<proto package>.<Service>/<Method>` (the Connect wire path), with the
 * streaming kind the app code assumes. Hand-maintained next to the call sites in `feature/<x>/data`, `core/media`
 * and `core/outbox`: add a line when a repository starts calling a new RPC.
 *
 * [ProtoContractTest] asserts every entry exists in the server's descriptors with the same streaming kind, so a server
 * rename or removal fails the Android build instead of the user's request.
 */
object AppRpcContract {
    val unary: Set<String> = setOf(
        // feature/auth signs in through OIDC (AppAuth) at the IdP, not through AuthService: no RPC from it is used.
        // feature/auth: PlayIntegrityDeviceAttestor (best-effort attestation after sign-in)
        "aedst.integrity.v1.IntegrityService/VerifyIntegrityToken",
        // core/capabilities: CapabilitiesData
        "aedst.capabilities.v1.CapabilitiesService/GetCapabilities",
        // feature/tasks: ConnectTaskRepository, task outbox handlers (core/outbox delivers them)
        "aedst.tasks.v1.TasksService/ListTasks",
        "aedst.tasks.v1.TasksService/GetTask",
        "aedst.tasks.v1.TasksService/CreateTask",
        // feature/tasks: TaskUpdateOutboxHandler (queued task.update)
        "aedst.tasks.v1.TasksService/UpdateTask",
        "aedst.tasks.v1.TasksService/CompleteTask",
        "aedst.tasks.v1.TasksService/ReopenTask",
        "aedst.tasks.v1.TasksService/DeleteTask",
        // feature/search: ConnectSearchRepository
        "aedst.search.v1.SearchService/Search",
        // feature/notifications: ConnectNotificationsRepository, PushRegistrar
        "aedst.notifications.v1.NotificationsService/ListNotifications",
        "aedst.notifications.v1.NotificationsService/GetUnreadCount",
        "aedst.notifications.v1.NotificationsService/MarkRead",
        "aedst.notifications.v1.NotificationsService/MarkAllRead",
        "aedst.notifications.v1.NotificationsService/GetPreferences",
        "aedst.notifications.v1.NotificationsService/UpdatePreferences",
        "aedst.notifications.v1.NotificationsService/RegisterPushDevice",
        "aedst.notifications.v1.NotificationsService/UnregisterPushDevice",
        // core/media: ConnectMediaRepository
        "aedst.media.v1.MediaService/ListMedia",
        "aedst.media.v1.MediaService/GetMedia",
        "aedst.media.v1.MediaService/DeleteMedia",
        "aedst.media.v1.MediaService/CreateUpload",
        "aedst.media.v1.MediaService/CompleteUpload",
        // feature/admin: ConnectAdminRepository
        "aedst.admin.v1.AdminService/GetOverview",
        "aedst.admin.v1.AdminService/ListTasks",
        "aedst.admin.v1.AdminService/DeleteTask",
        "aedst.admin.v1.AdminService/ListAuditLog",
    )

    /** Streaming RPCs the app uses (none yet): wire path to the kind the app expects. */
    val streaming: Map<String, StreamType> = emptyMap()
}
