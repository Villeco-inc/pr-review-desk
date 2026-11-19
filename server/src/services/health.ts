import { execFileSync } from "node:child_process";
import type { DeskHealth } from "../../../shared/types";

type Git = (args: string[]) => string | null;

export function deskHealth(env: NodeJS.ProcessEnv, git: Git): DeskHealth {
  const mode = env.NODE_ENV === "production" ? "prod" : "dev";
  return {
    mode,
    version: env.DESK_COMMIT || git(["rev-parse", "--short", "HEAD"]) || "inconnue",
    branch: mode === "prod" ? null : git(["rev-parse", "--abbrev-ref", "HEAD"]),
    port: Number(env.PORT ?? 3100),
  };
}

/** In prod the image's commit never changes; in dev the checkout moves under a running server (a commit, a checkout). */
export function healthReader(env: NodeJS.ProcessEnv, git: Git): () => DeskHealth {
  const atStart = deskHealth(env, git);
  return atStart.mode === "prod" ? () => atStart : () => deskHealth(env, git);
}

export function realGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}
