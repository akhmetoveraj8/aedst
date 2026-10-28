import {
  invalid,
  iso,
  nextId,
  notFound,
  notify,
  paginate,
  requireAdmin,
  STATUS,
  STATUS_NUMBER,
  state,
  userById,
} from "./core.mjs";

function audit(actor, action, targetKind, targetId, reason = "") {
  state.audit.unshift({
    id: nextId(),
    actorId: actor.id,
    action,
    targetKind,
    targetId,
    reason,
    createdAt: new Date().toISOString(),
  });
}

export const admin = {
  GetOverview(_body, req) {
    requireAdmin(req);
    const users = [...state.users.values()];
    const allTasks = users.flatMap((u) => u.tasks);
    const now = Date.now();
    return {
      usersTotal: String(users.length),
      tasksTotal: String(allTasks.length),
      tasksDone: String(
        allTasks.filter((t) => t.status === STATUS.DONE).length,
      ),
      tasksOverdue: String(
        allTasks.filter(
          (t) =>
            t.status !== STATUS.DONE &&
            t.dueDate &&
            Date.parse(t.dueDate) < now,
        ).length,
      ),
      mediaTotal: String(state.media.size),
      mediaBytes: String(
        [...state.media.values()].reduce((sum, m) => sum + m.sizeBytes, 0),
      ),
      pushDevices: String(state.devices.size),
      outboxLagSeconds: "0",
      jobsPending: "0",
    };
  },
  ListUsers(body, req) {
    requireAdmin(req);
    const q = String(body.query ?? "").toLowerCase();
    const rows = [...state.users.values()].filter(
      (u) => !q || u.email.toLowerCase().includes(q),
    );
    const { page, nextPageToken } = paginate(rows, body, 25);
    return {
      users: page.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: "",
        createdAt: u.createdAt,
        taskCount: String(u.tasks.length),
      })),
      nextPageToken,
    };
  },
  ListTasks(body, req) {
    requireAdmin(req);
    const q = String(body.query ?? "").toLowerCase();
    const rows = [...state.users.values()]
      .filter((u) => !body.ownerId || u.id === body.ownerId)
      .flatMap((u) => u.tasks)
      .filter((t) => !q || t.title.toLowerCase().includes(q));
    const { page, nextPageToken } = paginate(rows, body, 25);
    return {
      tasks: page.map((t) => ({
        id: t.id,
        ownerId: t.createdBy,
        title: t.title,
        status: STATUS_NUMBER[t.status] ?? 0,
        createdAt: t.createdAt,
        dueDate: iso(t.dueDate),
      })),
      nextPageToken,
    };
  },
  DeleteTask(body, req) {
    const actor = requireAdmin(req);
    const reason = String(body.reason ?? "").trim();
    if (reason.length < 3)
      throw invalid("reason must be at least 3 characters");
    for (const user of state.users.values()) {
      const task = user.tasks.find((t) => t.id === body.id);
      if (task) {
        user.tasks.splice(user.tasks.indexOf(task), 1);
        audit(actor, "task.delete", "task", task.id, reason);
        return {};
      }
    }
    throw notFound("task");
  },
  BroadcastNotification(body, req) {
    const actor = requireAdmin(req);
    if (!body.title) throw invalid("title is required");
    const recipients = body.userId
      ? [userById(body.userId)].filter(Boolean)
      : [...state.users.values()];
    for (const user of recipients) {
      notify(user, {
        kind: "NOTIFICATION_KIND_SYSTEM",
        title: body.title,
        body: body.body ?? "",
        link: body.link ?? "",
      });
    }
    audit(actor, "notification.broadcast", "user", body.userId ?? "");
    return { recipients: String(recipients.length) };
  },
  ListAuditLog(body, req) {
    requireAdmin(req);
    const { page, nextPageToken } = paginate(state.audit, body, 50);
    return { entries: page, nextPageToken };
  },
};
