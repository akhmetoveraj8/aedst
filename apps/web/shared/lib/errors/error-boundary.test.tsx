import { Code, ConnectError } from "@connectrpc/connect";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Component, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * In Vitest `@sentry/nextjs` resolves to its server build, whose
 * ErrorBoundary is a pass-through; stand in a minimal boundary with the same
 * props contract (beforeCapture + fallback render prop) so our wiring — tags
 * and fallback choice — is what is tested.
 */
const scope = vi.hoisted(() => ({ setTag: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  ErrorBoundary: class extends Component<
    {
      children: ReactNode;
      beforeCapture: (s: typeof scope, error: unknown) => void;
      fallback: (props: { resetError: () => void }) => ReactNode;
    },
    { error: unknown }
  > {
    state = { error: null as unknown };
    static getDerivedStateFromError(error: unknown) {
      return { error };
    }
    componentDidCatch(error: unknown) {
      this.props.beforeCapture(scope, error);
    }
    render() {
      return this.state.error
        ? this.props.fallback({
            resetError: () => this.setState({ error: null }),
          })
        : this.props.children;
    }
  },
}));

import { ErrorBoundary } from "@/shared/lib/errors/error-boundary";
import { messages } from "@/test/render";

let shouldThrow: unknown = null;
function Widget() {
  if (shouldThrow) {
    throw shouldThrow;
  }
  return <p>widget</p>;
}

function renderBoundary(fallback?: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ErrorBoundary feature="media" fallback={fallback}>
        <Widget />
      </ErrorBoundary>
    </NextIntlClientProvider>,
  );
}

describe("ErrorBoundary", () => {
  it("tags the event and shows a translated, retryable fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = new ConnectError("down", Code.Unavailable);
    renderBoundary();

    expect(screen.getByRole("alert")).toHaveTextContent(
      messages.common.errors.title,
    );
    expect(scope.setTag).toHaveBeenCalledWith("error.kind", "unavailable");
    expect(scope.setTag).toHaveBeenCalledWith("error.source", "boundary");
    expect(scope.setTag).toHaveBeenCalledWith("feature", "media");

    shouldThrow = null;
    await userEvent.click(
      screen.getByRole("button", { name: messages.common.actions.tryAgain }),
    );
    expect(screen.getByText("widget")).toBeInTheDocument();
  });

  it("renders a custom (or empty) fallback for optional widgets", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    shouldThrow = new Error("bug");
    const { unmount } = renderBoundary(<p>custom</p>);
    expect(screen.getByText("custom")).toBeInTheDocument();
    unmount();

    renderBoundary(null);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    shouldThrow = null;
  });
});
