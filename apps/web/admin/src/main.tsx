import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@app/styles/globals.css";
import { initSentryClient } from "@/app/config/sentry/client";
import { createAppRouter } from "@/app/router";

const router = createAppRouter();
initSentryClient(router);

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element in index.html");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
