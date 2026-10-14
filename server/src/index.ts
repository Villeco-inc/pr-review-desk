import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "./db/schema";
import { prsRouter, configuredRepos } from "./routes/prs";
import { reviewsRouter } from "./routes/reviews";
import { findingsRouter } from "./routes/findings";
import { localRouter } from "./routes/local";
import { compareRouter } from "./routes/compare";
import { telemetryRouter } from "./routes/telemetry";
import { track } from "./db/telemetry";
import { failInterruptedRuns } from "./services/run-log";
import { configuredLocalRepos } from "./services/local-git";

const db = getDb();
const stuck = db.prepare("UPDATE reviews SET status = 'failed', error = 'Server restarted during review' WHERE status IN ('running', 'queued')").run();
if (stuck.changes > 0) console.log(`[startup] reset ${stuck.changes} stuck review(s) to failed`);
failInterruptedRuns();

const app = express();
const port = Number(process.env.PORT ?? 3100);

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use((req, res, next) => {
  console.log(`[http] ${req.method} ${req.url}`);
  // Every API call is recorded once it has answered, except the client's own telemetry batches.
  if (req.path.startsWith("/api/") && req.path !== "/api/telemetry/events") {
    const start = Date.now();
    res.on("finish", () => {
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
      track("http", `${req.method} ${route}`, {
        status: String(res.statusCode),
        durationMs: Date.now() - start,
        payload: { path: req.path, query: req.query, bytes: Number(res.getHeader("content-length") ?? 0) || null },
      });
    });
  }
  next();
});

app.use("/api", prsRouter);
app.use("/api", reviewsRouter);
app.use("/api", findingsRouter);
app.use("/api", localRouter);
app.use("/api", compareRouter);
app.use("/api", telemetryRouter);

if (process.env.NODE_ENV === "production") {
  const distDir = path.join(process.cwd(), "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("/*splat", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }
}

app.listen(port, () => {
  console.log(`pr-review-desk server listening on http://localhost:${port}`);
  console.log(`repos: ${configuredRepos().join(", ") || "(none)"}`);
  console.log(`local repos: ${configuredLocalRepos().map((r) => r.label).join(", ") || "(none)"}`);
});
