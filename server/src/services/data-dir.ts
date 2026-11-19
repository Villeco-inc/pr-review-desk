// Where the server keeps its files (reviews.db, telemetry.db, runs/). `data/` by default, which is
// what the Docker container uses; `npm run dev` sets DATA_DIR=data-dev so both can run side by side.

import path from "node:path";

export function dataDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const configured = env.DATA_DIR?.trim();
  return path.resolve(cwd, configured || "data");
}
