import { describe, expect, it } from "vitest";
import { rejectReason } from "../services/local-only";

describe("rejectReason", () => {
  it("serves the Desk's own pages and API on a local host", () => {
    expect(rejectReason("GET", "localhost:37703", undefined)).toBeNull();
    expect(rejectReason("GET", "127.0.0.1:3100", undefined)).toBeNull();
    expect(rejectReason("GET", "[::1]:3100", undefined)).toBeNull();
    expect(rejectReason("POST", "localhost:37703", "http://localhost:37703")).toBeNull();
    expect(rejectReason("POST", "localhost:5173", "http://localhost:5173")).toBeNull();
  });

  it("lets a write without Origin through: only browsers send one, and they always do across sites", () => {
    expect(rejectReason("POST", "localhost:3100", undefined)).toBeNull();
  });

  it("refuses a write sent by another site", () => {
    expect(rejectReason("POST", "localhost:37703", "https://evil.example")).toMatch(/origin/);
    expect(rejectReason("PATCH", "localhost:37703", "http://localhost:5173")).toMatch(/origin/);
    expect(rejectReason("POST", "localhost:37703", "null")).toMatch(/origin/);
  });

  it("refuses any request whose Host is not local, as a rebound domain would send", () => {
    expect(rejectReason("GET", "evil.example:37703", undefined)).toMatch(/host/);
    expect(rejectReason("GET", "localhost.evil.example", undefined)).toMatch(/host/);
    expect(rejectReason("GET", undefined, undefined)).toMatch(/host/);
  });
});
