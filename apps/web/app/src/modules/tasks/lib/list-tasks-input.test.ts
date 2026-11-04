import { describe, expect, it } from "vitest";

import {
  buildListTasksInput,
  SORT_OPTIONS,
  TASKS_PAGE_SIZE,
} from "@/modules/tasks/lib/list-tasks-input";
import {
  loadTaskSearchParams,
  SORT_VALUES,
} from "@/modules/tasks/lib/task-search-params";
import {
  SortDirection,
  TaskPriority,
  TaskSortField,
  TaskStatus,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";

describe("loadTaskSearchParams", () => {
  it("defaults an empty URL to the unfiltered, newest-first first page", () => {
    expect(loadTaskSearchParams({})).toEqual({
      q: "",
      status: "all",
      priority: "all",
      sort: "created-desc",
      cursors: [],
    });
  });

  it("parses every param from a URL", () => {
    expect(
      loadTaskSearchParams({
        q: "report",
        status: "in-progress",
        priority: "urgent",
        sort: "due-asc",
        cursors: "tok1,tok2",
      }),
    ).toEqual({
      q: "report",
      status: "in-progress",
      priority: "urgent",
      sort: "due-asc",
      cursors: ["tok1", "tok2"],
    });
  });

  it("falls back to defaults for values outside the allowed sets", () => {
    expect(
      loadTaskSearchParams({ status: "bogus", priority: "??", sort: "random" }),
    ).toMatchObject({ status: "all", priority: "all", sort: "created-desc" });
  });
});

describe("buildListTasksInput", () => {
  const base = loadTaskSearchParams({});

  it("sends no filters for the default view", () => {
    expect(buildListTasksInput(base)).toEqual({
      statuses: [],
      priorities: [],
      search: "",
      sortBy: TaskSortField.CREATED_AT,
      sortDirection: SortDirection.DESC,
      pageSize: TASKS_PAGE_SIZE,
      pageToken: "",
    });
  });

  it("maps URL slugs to protocol enums", () => {
    expect(
      buildListTasksInput({
        ...base,
        q: "x",
        status: "in-progress",
        priority: "urgent",
      }),
    ).toMatchObject({
      search: "x",
      statuses: [TaskStatus.IN_PROGRESS],
      priorities: [TaskPriority.URGENT],
    });
  });

  it("requests the page named by the last cursor", () => {
    expect(
      buildListTasksInput({ ...base, cursors: ["a", "b"] }).pageToken,
    ).toBe("b");
  });

  it("has a sort option for every URL sort value", () => {
    expect(SORT_OPTIONS.map((option) => option.value)).toEqual([
      ...SORT_VALUES,
    ]);
    expect(buildListTasksInput({ ...base, sort: "due-desc" })).toMatchObject({
      sortBy: TaskSortField.DUE_DATE,
      sortDirection: SortDirection.DESC,
    });
  });
});
