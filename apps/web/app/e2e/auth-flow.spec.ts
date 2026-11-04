import {
  expect,
  logIn,
  mockApi,
  signInThroughUi,
  submitIdpForm,
  test,
  WEB_ORIGIN,
} from "./support/fixtures";

test.describe("route protection", () => {
  test("sends an anonymous visitor to login and back to where they were headed", async ({
    page,
    user,
  }) => {
    await page.goto("/en/tasks?status=done&q=Seed");

    // Redirected by proxy.ts before any page HTML renders.
    await expect(page).toHaveURL(
      /\/en\?next=%2Ftasks%3Fstatus%3Ddone%26q%3DSeed/,
    );

    await logIn(page, user);

    await expect(page).toHaveURL(/\/en\/tasks\?status=done&q=Seed/);
  });

  test("never redirects off-site through the next parameter", async ({
    page,
    user,
  }) => {
    await page.goto("/en?next=https%3A%2F%2Fevil.example%2Fphish");
    await logIn(page, user);

    await expect(page).toHaveURL(/\/en\/tasks$/);
  });

  test("skips the login page for an already signed-in visitor", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.goto("/en");
    await expect(page).toHaveURL(/\/en\/tasks$/);
  });

  test("protects nested routes in every locale", async ({ page }) => {
    await page.goto("/ru/tasks/new");
    await expect(page).toHaveURL(/\/ru\?next=%2Ftasks%2Fnew/);
  });
});

test.describe("sign in / out", () => {
  test("wrong credentials stay on the identity provider and create no session", async ({
    page,
    context,
    user,
  }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await submitIdpForm(page, user.email, "wrong-password", "Continue");

    await expect(
      page.getByRole("alert").filter({ hasText: "invalid credentials" }),
    ).toBeVisible();
    expect(
      (await context.cookies()).filter((c) =>
        c.name.startsWith("aedst_session"),
      ),
    ).toEqual([]);
  });

  test("the sign-in link starts an Authorization Code + PKCE request", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/127\.0\.0\.1:8181\/oidc\/authorize/);
    const params = new URL(page.url()).searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBeTruthy();
    expect(params.get("nonce")).toBeTruthy();
    expect(params.get("scope")).toContain("offline_access");
    expect(params.get("scope")).toContain(
      "urn:zitadel:iam:org:project:id:aedst-api-e2e:aud",
    );
    expect(params.get("redirect_uri")).toBe(`${WEB_ORIGIN}/api/auth/callback`);
  });

  test("a callback with a forged state is refused with an explanation", async ({
    page,
    context,
  }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/oidc\/authorize/);

    // An attacker-supplied code/state pair that was not started by this browser.
    await page.goto("/api/auth/callback?code=stolen&state=forged");

    await expect(page).toHaveURL(/\/en\?auth_error=invalid/);
    await expect(page.locator("p[role=alert]")).toContainText(
      "Sign-in could not be verified",
    );
    expect(
      (await context.cookies()).filter((c) =>
        c.name.startsWith("aedst_session"),
      ),
    ).toEqual([]);
  });

  test("a callback without a started login says the sign-in expired", async ({
    page,
  }) => {
    await page.goto("/api/auth/callback?code=x&state=y");

    await expect(page).toHaveURL(/\/en\?auth_error=expired/);
    await expect(page.locator("p[role=alert]")).toContainText("took too long");
  });

  test("creates a new account at the identity provider and lands on the dashboard", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: "Create one" }).click();
    await expect(
      page.getByRole("heading", { name: "Create account" }),
    ).toBeVisible();
    await submitIdpForm(
      page,
      `new-${Date.now()}-${Math.random()}@example.com`,
      "a-long-password",
      "Register",
    );

    await expect(page).toHaveURL(/\/en\/tasks$/);
    await expect(page.getByText("No tasks yet")).toBeVisible();
  });

  test("shows who is signed in from the ID token", async ({
    page,
    signedIn,
  }) => {
    await expect(
      page.getByText(`Signed in as ${signedIn.email}`),
    ).toBeVisible();
  });

  test("signing out ends the session at the identity provider and locally", async ({
    page,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();
    await page.getByRole("button", { name: "Sign out" }).click();
    // RP-initiated logout bounces through the IdP's end_session endpoint.
    await expect(page).toHaveURL(/\/en$/);

    await page.goto("/en/tasks");
    await expect(page).toHaveURL(/\/en\?next=/);
  });
});

test.describe("session storage", () => {
  test("tokens live only in httpOnly cookies, out of reach of page scripts", async ({
    page,
    context,
    browserName,
    signedIn,
  }) => {
    expect(signedIn.email).toBeTruthy();

    const cookies = await context.cookies();
    const session = cookies.filter((c) => c.name.startsWith("aedst_session"));
    expect(session.map((c) => c.name).sort()).toEqual([
      "aedst_session",
      "aedst_session_id",
      "aedst_session_refresh",
    ]);
    // The single-use pre-auth cookie is gone once the login completed.
    expect(cookies.map((c) => c.name)).not.toContain("aedst_oidc");
    for (const cookie of session) {
      expect(cookie.httpOnly).toBe(true);
      // WebKit's automation API reports Lax cookies as "None"; the header
      // itself is asserted by the unit tests.
      if (browserName !== "webkit") {
        expect(cookie.sameSite).toBe("Lax");
      }
    }

    const visibleToScripts = await page.evaluate(() => ({
      cookie: document.cookie,
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
    }));
    expect(visibleToScripts.cookie).not.toContain("aedst_session");
    expect(visibleToScripts.local).not.toMatch(/token|access|refresh/i);
    expect(visibleToScripts.session).not.toMatch(/token|access|refresh/i);
  });

  test("the browser never calls the API directly — only the same-origin proxy", async ({
    page,
    user,
  }) => {
    const origins = new Set<string>();
    page.on("request", (request) => {
      if (request.resourceType() === "fetch") {
        origins.add(new URL(request.url()).origin);
      }
    });

    await signInThroughUi(page, user);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/cursors=/);

    for (const origin of origins) {
      expect(origin).toBe(WEB_ORIGIN);
    }
  });
});

test.describe("session refresh", () => {
  test("an expired access token is renewed transparently on a full page load", async ({
    page,
    signedIn,
  }) => {
    await mockApi.expireAccessToken(signedIn.email);

    await page.reload();

    await expect(page).toHaveURL(/\/en\/tasks/);
    await expect(
      page.getByRole("link", { name: /Seed task 25/ }),
    ).toBeVisible();
  });

  test("an expired access token is renewed transparently on a client-side request", async ({
    page,
    signedIn,
  }) => {
    await mockApi.expireAccessToken(signedIn.email);

    // A client-side navigation: goes through the /api/rpc BFF, which
    // retries once after refreshing.
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByText("Seed task 05")).toBeVisible();
    await expect(page).toHaveURL(/\/en\/tasks/);
  });

  test("a session revoked server-side ends cleanly: explanation, login page, way back", async ({
    page,
    signedIn,
  }) => {
    await mockApi.revokeSession(signedIn.email);

    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page).toHaveURL(/\/en\?next=/);
    await expect(page.getByText("Your session expired")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
