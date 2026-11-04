import {
  authenticate,
  invalid,
  nextId,
  notFound,
  paginate,
  state,
} from "./core.mjs";

function publicNotification(n) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    subjectId: n.subjectId,
    createdAt: n.createdAt,
    readAt: n.readAt,
  };
}

export const notifications = {
  ListNotifications(body, req) {
    const user = authenticate(req);
    const rows = body.unreadOnly
      ? user.notifications.filter((n) => !n.readAt)
      : user.notifications;
    const { page, nextPageToken } = paginate(rows, body);
    return { notifications: page.map(publicNotification), nextPageToken };
  },
  GetUnreadCount(_body, req) {
    const user = authenticate(req);
    return { unread: user.notifications.filter((n) => !n.readAt).length };
  },
  MarkRead(body, req) {
    const user = authenticate(req);
    const ids = new Set(body.ids ?? []);
    if (ids.size === 0) throw invalid("ids is required");
    const now = new Date().toISOString();
    for (const n of user.notifications) {
      if (ids.has(n.id) && !n.readAt) n.readAt = now;
    }
    return {};
  },
  MarkAllRead(_body, req) {
    const user = authenticate(req);
    const now = new Date().toISOString();
    let marked = 0;
    for (const n of user.notifications) {
      if (!n.readAt) {
        n.readAt = now;
        marked += 1;
      }
    }
    return { marked };
  },
  RegisterPushDevice(body, req) {
    const user = authenticate(req);
    if (!body.platform || body.platform === "PUSH_PLATFORM_UNSPECIFIED") {
      throw invalid("platform is required");
    }
    if (body.platform === "PUSH_PLATFORM_WEB_PUSH" && !body.webPush?.endpoint) {
      throw invalid("web_push is required for WEB_PUSH");
    }
    const deviceId = nextId();
    state.devices.set(deviceId, { userId: user.id, ...body });
    return { deviceId };
  },
  UnregisterPushDevice(body, req) {
    const user = authenticate(req);
    const device = state.devices.get(body.deviceId);
    if (!device || device.userId !== user.id) throw notFound("device");
    state.devices.delete(body.deviceId);
    return {};
  },
  GetWebPushConfig(_body, req) {
    authenticate(req);
    // Not configured in the mock: the UI shows the "not set up" state.
    return { vapidPublicKey: process.env.MOCK_VAPID_PUBLIC_KEY ?? "" };
  },
  GetPreferences(_body, req) {
    return { preferences: { ...authenticate(req).preferences } };
  },
  UpdatePreferences(body, req) {
    const user = authenticate(req);
    if (!body.preferences) throw invalid("preferences is required");
    user.preferences = {
      pushEnabled: Boolean(body.preferences.pushEnabled),
      taskCompleted: Boolean(body.preferences.taskCompleted),
      taskDueSoon: Boolean(body.preferences.taskDueSoon),
      mediaReady: Boolean(body.preferences.mediaReady),
    };
    return { preferences: { ...user.preferences } };
  },
};
