import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { messages, renderWithProviders } from "@/test/render";
import LocaleRootPage from "./page";

// The auth public surface also exports the sign-out button, whose Server
// Action pulls in node-only OIDC code that cannot load in the browser project.
vi.mock("@/modules/auth/lib/auth-actions", () => ({ logoutAction: vi.fn() }));

// The consent provider lives in the locale layout, which this test does not
// render; the button is covered by ConsentLayer.test.tsx.
vi.mock("@/app/providers/PrivacySettingsButton", () => ({
  PrivacySettingsButton: () => null,
}));

// The page is an async Server Component; next-intl/server needs a request
// scope, so it is backed by the same English catalogue the client tests use.
vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async ({ namespace }: { namespace: string }) => {
    const catalogue = namespace
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)[part],
        messages,
      ) as Record<string, string>;
    return (key: string) => catalogue[key] ?? key;
  },
}));

async function renderLocaleRootPage(query: Record<string, string> = {}) {
  const page = await LocaleRootPage({
    params: Promise.resolve({ locale: "en" }),
    searchParams: Promise.resolve(query),
  });
  return renderWithProviders(page);
}

describe("LocaleRootPage", () => {
  it("renders the app name and description", async () => {
    await renderLocaleRootPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: messages.common.appName,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(messages.common.appDescription),
    ).toBeInTheDocument();
  });

  it("offers sign-in for a signed-out visitor", async () => {
    await renderLocaleRootPage();

    expect(
      screen.getByRole("heading", { name: messages.auth.login.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: messages.auth.login.submit }),
    ).toBeInTheDocument();
  });

  it("shows the failure reason from a bounced sign-in, and ignores unknown codes", async () => {
    await renderLocaleRootPage({ auth_error: "expired" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      messages.auth.login.errors.expired,
    );
  });

  it("does not render arbitrary auth_error text", async () => {
    await renderLocaleRootPage({ auth_error: "<b>pwned</b>" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("emits schema.org JSON-LD describing the app", async () => {
    const { container } = await renderLocaleRootPage();

    const script = container.querySelector(
      'script[type="application/ld+json"]',
    );
    expect(script).not.toBeNull();
    const doc = JSON.parse(script?.textContent ?? "{}");
    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@graph"]).toEqual([
      expect.objectContaining({
        "@type": "WebApplication",
        "@id": "http://localhost:3000/en#webapp",
        name: messages.common.appName,
        inLanguage: "en",
        url: "http://localhost:3000/en",
        publisher: { "@id": "http://localhost:3000/#organization" },
      }),
    ]);
  });

  it("publishes a self-referencing canonical with hreflang alternates", async () => {
    const { generateMetadata } = await import("./page");
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: "ru" }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.alternates?.canonical).toBe("http://localhost:3000/ru");
    expect(metadata.alternates?.languages).toMatchObject({
      en: "http://localhost:3000/en",
      tg: "http://localhost:3000/tj",
    });
  });

  it("escapes markup in JSON-LD so it cannot close its script tag", () => {
    // Guards the XSS vector directly through the component the page uses.
    return import("@/app/config/JsonLd").then(({ JsonLd }) => {
      const { container } = render(
        <JsonLd data={{ name: "</script><script>alert(1)</script>" }} />,
      );
      expect(container.innerHTML).not.toContain("</script><script>");
      expect(container.querySelector("script")?.textContent).toContain(
        "\\u003c/script>",
      );
    });
  });
});
