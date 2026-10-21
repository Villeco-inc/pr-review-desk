import { describe, expect, it } from "vitest";
import { isTrackedRequest } from "../services/tracked-requests";

describe("which requests telemetry records", () => {
  it("records an API call", () => {
    expect(isTrackedRequest("GET", "/api/prs")).toBe(true);
    expect(isTrackedRequest("POST", "/api/reviews")).toBe(true);
  });

  it("leaves out what is not an API call, and the client's own telemetry batches", () => {
    expect(isTrackedRequest("GET", "/")).toBe(false);
    expect(isTrackedRequest("GET", "/assets/index.js")).toBe(false);
    expect(isTrackedRequest("POST", "/api/telemetry/events")).toBe(false);
  });

  it("leaves out the polls a page repeats every few seconds, which would bury every other event", () => {
    expect(isTrackedRequest("GET", "/api/freshness")).toBe(false);
    expect(isTrackedRequest("GET", "/api/repos")).toBe(false);
  });

  it("still records what changes the selection, and the reads that are not polls", () => {
    expect(isTrackedRequest("PUT", "/api/repos")).toBe(true);
    expect(isTrackedRequest("GET", "/api/repos/available")).toBe(true);
    expect(isTrackedRequest("GET", "/api/view-memory")).toBe(true);
  });
});
