import { describe, expect, it } from "vitest";

import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { mutationKeyFor } from "@/shared/api/connect/mutation-key";
import { procedureFromKey } from "@/shared/lib/query-client";

describe("mutationKeyFor", () => {
  it("lets the mutation cache recover rpc.procedure for Sentry", () => {
    expect(
      procedureFromKey(mutationKeyFor(TasksService.method.createTask)),
    ).toBe("aedst.tasks.v1.TasksService/CreateTask");
    expect(
      procedureFromKey(mutationKeyFor(TasksService.method.updateTask)),
    ).toBe("aedst.tasks.v1.TasksService/UpdateTask");
  });
});
