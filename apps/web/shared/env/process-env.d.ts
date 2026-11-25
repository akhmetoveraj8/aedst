// Every environment variable the web projects read, declared once so that
// `noPropertyAccessFromIndexSignature` can stay on while code keeps the
// literal `process.env.NAME` / `import.meta.env.NAME` form. That form is
// required: Next.js and Vite inline public variables only when they are
// written as a plain member access. A typo now fails the typecheck instead
// of silently reading `undefined`. Values are still validated at runtime by
// the Zod schemas in this directory and in each project's `env.ts`.
//
// Included by every project's tsconfig.json (app, admin, admin/server,
// marketing). Add a variable here in the same change that first reads it.

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Identical to the declaration in next/types/global.d.ts, so the two merge.
      readonly NODE_ENV: "development" | "production" | "test";
      NEXT_RUNTIME?: string;
      CI?: string;

      // Public (inlined into client bundles).
      NEXT_PUBLIC_SITE_URL?: string;
      NEXT_PUBLIC_APP_URL?: string;
      NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?: string;
      NEXT_PUBLIC_BING_SITE_VERIFICATION?: string;
      NEXT_PUBLIC_SENTRY_DSN?: string;
      NEXT_PUBLIC_SENTRY_ENVIRONMENT?: string;
      NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE?: string;
      NEXT_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE?: string;
      NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE?: string;
      NEXT_PUBLIC_POSTHOG_KEY?: string;
      NEXT_PUBLIC_POSTHOG_HOST?: string;
      NEXT_PUBLIC_PRIVACY_POLICY_URL?: string;

      // Server only.
      API_BASE_URL?: string;
      AUTH_COOKIE_NAME?: string;
      AUTH_ROLES_CLAIM?: string;
      AUTH_ROLES_ORG?: string;
      OIDC_CLIENT_ID?: string;
      OIDC_CLIENT_SECRET?: string;
      OIDC_ISSUER?: string;
      OIDC_PROJECT_ID?: string;
      OIDC_SCOPE?: string;
      OIDC_STATE_SECRET?: string;
      MEDIA_ORIGINS?: string;
      ADMIN_BFF_URL?: string;
      ADMIN_ORIGIN?: string;
      ADMIN_STATIC_DIR?: string;
      LOG_LEVEL?: string;
      TRUST_PROXY?: string;

      // Build and release metadata.
      SENTRY_AUTH_TOKEN?: string;
      SENTRY_DSN?: string;
      SENTRY_ORG?: string;
      SENTRY_PROJECT?: string;
      SENTRY_RELEASE?: string;
      GITHUB_SHA?: string;
      VERCEL_ENV?: string;
      VERCEL_GIT_COMMIT_SHA?: string;

      // Tests and local tooling.
      E2E_WEB_PORT?: string;
      E2E_ADMIN_PORT?: string;
      E2E_MARKETING_PORT?: string;
      AEDST_CONTRACT_SERVER_URL?: string;
      STORYBOOK_VISUAL?: string;
    }
  }

  interface ImportMetaEnv {
    VITE_APP_URL?: string;
    VITE_SENTRY_RELEASE?: string;
    STORYBOOK_VISUAL?: string;
  }
}

export {};
