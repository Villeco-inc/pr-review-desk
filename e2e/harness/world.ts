// Where the e2e world lives, shared by e2e.config.ts (which starts it) and the tests (which read it).
import os from "node:os";
import path from "node:path";

export const PORT = Number(process.env.E2E_PORT ?? 3203);
export const APP_URL = `http://localhost:${PORT}`;
/** Created fresh by start-app.mjs at each run and deleted when the server stops. */
export const WORLD = process.env.E2E_WORLD ?? path.join(os.tmpdir(), `pr-review-desk-e2e-${PORT}`);
