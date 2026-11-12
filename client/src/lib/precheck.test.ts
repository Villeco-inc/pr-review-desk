import { describe, expect, it } from "vitest";
import { findingsToPost, jevPrechecked } from "./precheck";

const f = (id: string, jevHolds: number | null, state = "open") => ({ id, jevHolds, state });

describe("jevPrechecked", () => {
  it("checks the open findings Jev says hold at or above the threshold", () => {
    expect(jevPrechecked([f("a", 0.9), f("b", 0.6), f("c", 0.59), f("d", null)], 0.6)).toEqual(["a", "b"]);
  });

  it("never checks a finding already posted, dismissed or resolved", () => {
    expect(jevPrechecked([f("a", 0.9, "posted"), f("b", 0.9, "dismissed"), f("c", 0.9, "resolved")], 0.6)).toEqual([]);
  });

  it("follows the threshold it is given", () => {
    expect(jevPrechecked([f("a", 0.5), f("b", 0.8)], 0.85)).toEqual([]);
    expect(jevPrechecked([f("a", 0.5), f("b", 0.8)], 0.5)).toEqual(["a", "b"]);
  });
});

describe("findingsToPost", () => {
  const open = [
    { id: "a", jevHolds: 0.9 },
    { id: "b", jevHolds: 0.6 },
    { id: "c", jevHolds: 0.59 },
    { id: "d", jevHolds: null },
  ];

  it("posts only the findings Jev holds at or above the threshold while Jev is on", () => {
    expect(findingsToPost(open, true, 0.6)).toEqual(["a", "b"]);
  });

  it("posts every open finding while Jev is off", () => {
    expect(findingsToPost(open, false, 0.6)).toEqual(["a", "b", "c", "d"]);
  });

  it("posts nothing while Jev is on and has judged none of them", () => {
    expect(findingsToPost([{ id: "a", jevHolds: null }], true, 0.6)).toEqual([]);
  });
});
