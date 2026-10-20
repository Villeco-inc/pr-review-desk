import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "./db/schema";
import { prsRouter, startPrRefresh } from "./routes/prs";
import { parseRepoList, selectedRepos } from "./services/repo-selection";
import { reviewsRouter } from "./routes/reviews";
import { findingsRouter } from "./routes/findings";
import { localRouter } from "./routes/local";
import { viewMemoryRouter } from "./routes/view-memory";
import { failInterruptedRuns } from "./services/run-log";

const db = getDb();
const stuck = db.prepare("UPDATE reviews SET status = 'failed', error = 'Server restarted during review' WHERE status IN ('running', 'queued')").run();
if (stuck.changes > 0) console.log(`[startup] reset ${stuck.changes} stuck review(s) to failed`);
failInterruptedRuns();

const app = express();
const port = Number(process.env.PORT ?? 3100);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
// Express 5 leaves req.body undefined when a request carries no body: every route reads it as an object.
app.use((req, _res, next) => {
  req.body ??= {};
  next();
});

app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.url}`);
  next();
});

app.use("/api", prsRouter);
app.use("/api", reviewsRouter);
app.use("/api", findingsRouter);
app.use("/api", localRouter);
app.use("/api", viewMemoryRouter);

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
  console.log(`selected repos: ${selectedRepos(db, process.env.REPOS).join(", ") || "(none yet, pick them in the app)"}`);
  const { ignored } = parseRepoList(process.env.REPOS);
  if (ignored.length > 0) console.warn(`ignored in REPOS, not owner/name: ${ignored.join(", ")}`);
  startPrRefresh();
});
