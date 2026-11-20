import { describe, it, expect } from "vitest";
import { dataDir } from "../services/data-dir";

describe("dataDir", () => {
  it("uses data/ by default", () => expect(dataDir({}, "/app")).toBe("/app/data"));
  it("resolves DATA_DIR from the working directory", () =>
    expect(dataDir({ DATA_DIR: "data-dev" }, "/app")).toBe("/app/data-dev"));
  it("keeps an absolute DATA_DIR", () => expect(dataDir({ DATA_DIR: "/tmp/x" }, "/app")).toBe("/tmp/x"));
  it("ignores an empty DATA_DIR", () => expect(dataDir({ DATA_DIR: "  " }, "/app")).toBe("/app/data"));
});
