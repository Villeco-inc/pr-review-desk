import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { SystemProvider } from "./components/SystemProvider";
import { loadViewMemory } from "./lib/view-memory";
import "./index.css";
import { startTelemetry } from "./lib/telemetry";

startTelemetry();

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

// What the screens remember is loaded first, so the router can read it synchronously on the first page.
void loadViewMemory().catch(() => undefined).then(() => {
  createRoot(container).render(
    <StrictMode>
      <SystemProvider>
        <RouterProvider router={router} />
      </SystemProvider>
    </StrictMode>
  );
});
