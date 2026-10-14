import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { SystemProvider } from "./components/SystemProvider";
import "./index.css";
import { startTelemetry } from "./lib/telemetry";

startTelemetry();

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <StrictMode>
    <SystemProvider>
      <RouterProvider router={router} />
    </SystemProvider>
  </StrictMode>
);
