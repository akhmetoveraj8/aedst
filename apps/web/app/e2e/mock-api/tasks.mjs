import {
  authenticate,
  findTask,
  invalid,
  nextId,
  notify,
  PRIORITY,
  paginate,
  publicTask,
  STATUS,
} from "./core.mjs";

export const tasks = {
  CreateTask(body, req) {
    const user = authenticate(req);
    if (!body.title) {
      throw invalid("title is required");
    }
    const now = new Date().toISOString();
    const task = {
      id: nextId(),
      title: body.title,
      description: body.description ?? "",
      status: STATUS.TODO,
      priority: body.priority ?? PRIORITY.MEDIUM,
      dueDate: body.dueDate,
      createdAt: now,
      updatedAt: now,
      createdBy: user.id,
      version: 1,
    };
    user.tasks.unshift(task);
    return { task: publicTask(task) };
  },
  GetTask(body, req) {
    return { task: publicTask(findTask(authenticate(req), body.id)) };
  },
  ListTasks(body, req) {
    const user = authenticate(req);
    const statuses = body.statuses ?? [];
    const priorities = body.priorities ?? [];
    const search = (body.search ?? "").toLowerCase();

    let rows = user.tasks.filter(
      (task) =>
        (statuses.length === 0 || statuses.includes(task.status)) &&
        (priorities.length === 0 || priorities.includes(task.priority)) &&
        (search === "" || task.title.toLowerCase().includes(search)),
    );

    const byDue = body.sortBy === "TASK_SORT_FIELD_DUE_DATE";
    const direction = body.sortDirection === "SORT_DIRECTION_ASC" ? 1 : -1;
    const key = (task) =>
      Date.parse(byDue ? (task.dueDate ?? "9999-01-01") : task.createdAt);
    rows = [...rows].sort((a, b) => (key(a) - key(b)) * direction || 0);

    const { page, nextPageToken } = paginate(rows, body);
    return {
      tasks: page.map(publicTask),
      nextPageToken,
      totalCount: rows.length,
    };
  },
  UpdateTask(body, req) {
    const task = findTask(authenticate(req), body.id);
    for (const path of body.updateMask?.paths ??
      String(body.updateMask ?? "")
        .split(",")
        .filter(Boolean)) {
      if (path === "title") task.title = body.title;
      if (path === "description") task.description = body.description;
      if (path === "priority") task.priority = body.priority;
      if (path === "due_date" || path === "dueDate")
        task.dueDate = body.dueDate;
    }
    task.version += 1;
    task.updatedAt = new Date().toISOString();
    return { task: publicTask(task) };
  },
  DeleteTask(body, req) {
    const user = authenticate(req);
    const task = findTask(user, body.id);
    user.tasks.splice(user.tasks.indexOf(task), 1);
    return {};
  },
  CompleteTask(body, req) {
    const user = authenticate(req);
    const task = findTask(user, body.id);
    if (task.status !== STATUS.DONE) {
      // The real server derives this from TaskCompleted via the outbox.
      notify(user, {
        kind: "NOTIFICATION_KIND_TASK_COMPLETED",
        title: "Task completed",
        body: task.title,
        link: `/tasks/${task.id}`,
        subjectId: task.id,
      });
    }
    task.status = STATUS.DONE;
    task.completedAt = new Date().toISOString();
    task.updatedAt = task.completedAt;
    return { task: publicTask(task) };
  },
  ReopenTask(body, req) {
    const task = findTask(authenticate(req), body.id);
    task.status = STATUS.TODO;
    task.completedAt = undefined;
    task.updatedAt = new Date().toISOString();
    return { task: publicTask(task) };
  },
  GetTaskStats(_body, req) {
    const user = authenticate(req);
    const now = Date.now();
    const count = (predicate) => user.tasks.filter(predicate).length;
    return {
      total: user.tasks.length,
      todo: count((t) => t.status === STATUS.TODO),
      inProgress: count((t) => t.status === STATUS.IN_PROGRESS),
      done: count((t) => t.status === STATUS.DONE),
      overdue: count(
        (t) =>
          t.status !== STATUS.DONE && t.dueDate && Date.parse(t.dueDate) < now,
      ),
    };
  },
};
