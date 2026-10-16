import type { RequestHandler } from "express";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostname(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

/**
 * Why a request must be refused, or null. The Desk acts on GitHub with your token, so only a page it
 * served itself may write to it: another site open in the browser could otherwise post as you.
 */
export function rejectReason(method: string, host: string | undefined, origin: string | undefined): string | null {
  // A site that points its own domain at 127.0.0.1 (DNS rebinding) arrives with its own name as Host.
  if (!host || !LOCAL_HOSTNAMES.has(hostname(host.toLowerCase()))) return `host not allowed: ${host ?? "(none)"}`;
  if (SAFE_METHODS.has(method) || origin === undefined) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return `origin not allowed: ${origin}`;
  }
  return originHost === host.toLowerCase() ? null : `origin not allowed: ${origin}`;
}

export const localOnly: RequestHandler = (req, res, next) => {
  const reason = rejectReason(req.method, req.headers.host, req.headers.origin);
  if (!reason) return next();
  console.warn(`[local-only] refused ${req.method} ${req.url}: ${reason}`);
  res.status(403).json({ error: reason });
};
