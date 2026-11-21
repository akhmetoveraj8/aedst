import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useCommandPalette } from "@/modules/search/lib/command-palette-store";
import {
  CommandPalette,
  CommandPaletteTrigger,
} from "@/modules/search/ui/CommandPalette";
import {
  DocumentKind,
  SearchService,
} from "@/shared/api/connect/generated/aedst/search/v1/search_pb";
import { routerMock } from "@/test/mocks/navigation";
import { backend, rpc } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.search.palette;
// The dialog chunk is a dynamic import, loaded on first open: allow for a cold
// Vite module graph on a loaded runner.
const LAZY = { timeout: 10_000 };

beforeEach(() => {
  act(() => useCommandPalette.setState({ open: false }));
});

describe("CommandPalette", () => {
  it("opens from the trigger and runs quick actions", async () => {
    renderWithProviders(
      <>
        <CommandPaletteTrigger />
        <CommandPalette />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Search…/ }));
    await userEvent.click(
      await screen.findByRole("option", { name: t.newTask }, LAZY),
    );
    expect(routerMock.push).toHaveBeenCalledWith("/tasks/new");
    expect(useCommandPalette.getState().open).toBe(false);
  });

  it("toggles with Ctrl+K and jumps to a live search hit", async () => {
    backend.use(
      rpc(SearchService.method.search, (input) => ({
        hits: [
          {
            kind: DocumentKind.TASK,
            id: "t-9",
            title: `${input.query} report`,
            link: "/tasks/t-9",
          },
        ],
      })),
    );
    renderWithProviders(<CommandPalette />);

    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByPlaceholderText(t.placeholder, {}, LAZY);
    await userEvent.type(input, "q3");
    await userEvent.click(
      await screen.findByRole("option", { name: /report/ }, { timeout: 3_000 }),
    );
    expect(routerMock.push).toHaveBeenCalledWith("/tasks/t-9");
  });

  it("falls back to the search page for an off-site hit link", async () => {
    backend.use(
      rpc(SearchService.method.search, () => ({
        hits: [
          {
            kind: DocumentKind.TASK,
            id: "t-evil",
            title: "evil report",
            link: "//evil.example/x",
          },
        ],
      })),
    );
    renderWithProviders(<CommandPalette />);
    act(() => useCommandPalette.setState({ open: true }));

    await userEvent.type(
      await screen.findByPlaceholderText(t.placeholder, {}, LAZY),
      "evil",
    );
    await userEvent.click(
      await screen.findByRole(
        "option",
        { name: /evil report/ },
        { timeout: 3_000 },
      ),
    );
    expect(routerMock.push).toHaveBeenCalledWith("/search");
    expect(routerMock.push).not.toHaveBeenCalledWith("//evil.example/x");
  });

  it("offers a full search for the typed text", async () => {
    backend.use(rpc(SearchService.method.search, () => ({ hits: [] })));
    renderWithProviders(<CommandPalette />);
    act(() => useCommandPalette.setState({ open: true }));

    await userEvent.type(
      await screen.findByPlaceholderText(t.placeholder, {}, LAZY),
      "budget",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Search for “budget”" }),
    );
    expect(routerMock.push).toHaveBeenCalledWith("/search?q=budget");
  });
});
