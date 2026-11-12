import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, migrateFindingQuality } from "../db/schema";
import { JEV_MODEL, jevClientFromEnv, judgeFindingsOnOutcome, judgeReviewFindings } from "../services/jev";

vi.mock("../db/telemetry", () => ({ track: vi.fn() }));

type Body = { model: string; state: { finding: Record<string, unknown> }; questions: Record<string, { type: string }> };
type Handler = (body: Body) => { status: number; body: unknown } | "hang";

/** A stand-in for the TypeSafe API: the real SDK talks to it over HTTP. */
let requests: { path: string; auth: string | undefined; body: Body }[];
let handler: Handler;
let server: http.Server;
let client: TypeSafeClient;
let db: Database.Database;

const severityAnswer = (p: number[]) => ({
  type: "score",
  score: p.reduce((acc, v, i) => acc + v * i, 0),
  confidence: 0.6,
  legend: { "0": "Cosmetic", "1": "Minor", "2": "Moderate", "3": "Serious", "4": "Critical" },
  probabilities: Object.fromEntries(p.map((v, i) => [String(i), v])),
});

const ok: Handler = (body) => {
  const isNit = body.state.finding.title === "Rename x";
  return {
    status: 200,
    body: {
      model: "jev-1.13.0",
      answers: {
        nit: { type: "noul", noul: isNit ? 0.93 : 0.04 },
        severity: severityAnswer(isNit ? [0.9, 0.1, 0, 0, 0] : [0, 0, 0.2, 0.7, 0.1]),
        holds: { type: "noul", noul: isNit ? 0.12 : 0.88 },
      },
      usage: { input_tokens: 400, output_tokens: 30 },
    },
  };
};

beforeEach(async () => {
  requests = [];
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as Body;
      requests.push({ path: req.url ?? "", auth: req.headers.authorization, body });
      const answer = handler(body);
      if (answer === "hang") return;
      res.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = jevClientFromEnv({ TYPESAFE_API_KEY: "test-key" }, { baseURL, compression: false, timeout: 300, retry: { maxRetries: 1, backoffInitialMs: 1, backoffMaxMs: 1 } })!;

  db = new Database(":memory:");
  migrate(db);
  migrateFindingQuality(db);
  db.prepare("INSERT INTO reviews (id, repo, number, created_at, updated_at) VALUES ('o/r#1', 'o/r', 1, 'now', 'now')").run();
  const add = db.prepare("INSERT INTO findings (id, review_id, ord, file, start_line, end_line, severity, title, summary, problem) VALUES (?, 'o/r#1', ?, 'src/a.ts', ?, ?, ?, ?, ?, ?)");
  add.run("f1", 0, 10, 14, "high", "Retries never back off", "Retries never back off on timeout", "With a host that never answers, the client loops immediately");
  add.run("f2", 1, 40, 40, "nit", "Rename x", "Variable x should be named count", "");
});

afterEach(() => {
  server.closeAllConnections();
  server.close();
});

const judgments = () => db.prepare("SELECT * FROM finding_judgments ORDER BY finding_id").all() as Record<string, unknown>[];

describe("jevClientFromEnv", () => {
  it("is off without a key, and pins the model unless JEV_MODEL says otherwise", () => {
    expect(jevClientFromEnv({})).toBeNull();
    expect(jevClientFromEnv({ TYPESAFE_API_KEY: "  " })).toBeNull();
    expect(jevClientFromEnv({ TYPESAFE_API_KEY: "k" })?.defaultModel).toBe(JEV_MODEL);
    expect(jevClientFromEnv({ TYPESAFE_API_KEY: "k", JEV_MODEL: "jev-latest" })?.defaultModel).toBe("jev-latest");
  });
});

describe("judgeReviewFindings", () => {
  it("asks the three questions together per finding and stores the raw probabilities", async () => {
    handler = ok;
    expect(await judgeReviewFindings(db, client, "o/r#1")).toEqual({ judged: 2, skipped: [] });
    expect(requests).toHaveLength(2);
    const first = requests.find((r) => r.body.state.finding.title === "Retries never back off")!;
    expect(first.path).toBe("/v1/systemone");
    expect(first.auth).toBe("Bearer test-key");
    expect(first.body.model).toBe(JEV_MODEL);
    expect(Object.fromEntries(Object.entries(first.body.questions).map(([k, q]) => [k, q.type]))).toEqual({ nit: "noul", severity: "score", holds: "noul" });
    expect(first.body.state).toEqual({
      finding: { title: "Retries never back off", summary: "Retries never back off on timeout", problem: "With a host that never answers, the client loops immediately", given_severity: "high", file: "src/a.ts", lines: "10-14" },
    });
    const [f1, f2] = judgments();
    expect(f1).toMatchObject({ finding_id: "f1", model: "jev-1.13.0", nit: 0.04, holds: 0.88, severity_confidence: 0.6, input_tokens: 400, output_tokens: 30 });
    expect(f1.severity_score).toBeCloseTo(2.9);
    expect(JSON.parse(String(f1.severity_probabilities))).toEqual({ "0": 0, "1": 0, "2": 0.2, "3": 0.7, "4": 0.1 });
    expect(f2).toMatchObject({ finding_id: "f2", nit: 0.93, holds: 0.12 });
  });

  it("judges only findings that have no answer yet", async () => {
    handler = ok;
    await judgeReviewFindings(db, client, "o/r#1");
    requests = [];
    expect(await judgeReviewFindings(db, client, "o/r#1")).toEqual({ judged: 0, skipped: [] });
    expect(requests).toEqual([]);
  });

  it("stores nothing when the key is refused", async () => {
    handler = () => ({ status: 401, body: { error: "invalid api key" } });
    const result = await judgeReviewFindings(db, client, "o/r#1");
    expect(result).toEqual({ judged: 0, skipped: ["AuthenticationError"] });
    expect(judgments()).toEqual([]);
  });

  it("stores nothing when the API keeps failing, after the SDK's own retry", async () => {
    handler = () => ({ status: 500, body: { error: "boom" } });
    expect(await judgeReviewFindings(db, client, "o/r#1")).toEqual({ judged: 0, skipped: ["InternalServerError"] });
    expect(requests).toHaveLength(4); // two findings, one retry each
    expect(judgments()).toEqual([]);
  });

  it("stores nothing when the API does not answer in time", async () => {
    handler = () => "hang";
    expect(await judgeReviewFindings(db, client, "o/r#1")).toEqual({ judged: 0, skipped: ["APITimeoutError"] });
    expect(judgments()).toEqual([]);
  });

  it("leaves a finding unjudged when an answer is missing, and stores the undecided one as it came", async () => {
    handler = (body) =>
      body.state.finding.title === "Rename x"
        ? { status: 200, body: { model: "jev-1.13.0", answers: { nit: { type: "noul", noul: 0.5 } }, usage: {} } }
        : { status: 200, body: { model: "jev-1.13.0", answers: { nit: { type: "noul", noul: 0.5 }, holds: { type: "noul", noul: 0.49 }, severity: severityAnswer([0.2, 0.2, 0.2, 0.2, 0.2]) }, usage: {} } };
    const result = await judgeReviewFindings(db, client, "o/r#1");
    expect(result.judged).toBe(1);
    expect(judgments()).toEqual([expect.objectContaining({ finding_id: "f1", nit: 0.5, holds: 0.49 })]);
  });

  it("drops the answer for a finding that a re-run replaced meanwhile", async () => {
    handler = (body) => {
      if (body.state.finding.title === "Retries never back off") db.prepare("DELETE FROM findings WHERE id = 'f1'").run();
      return ok(body);
    };
    expect((await judgeReviewFindings(db, client, "o/r#1")).judged).toBe(1);
    expect(judgments().map((j) => j.finding_id)).toEqual(["f2"]);
  });
});

describe("judgeFindingsOnOutcome", () => {
  it("does not listen when Jev is off", () => {
    const outcomes = new EventEmitter();
    expect(judgeFindingsOnOutcome(outcomes, () => db, null)).toBeNull();
    expect(outcomes.listenerCount("outcome")).toBe(0);
  });

  it("judges a review that reported, and ignores one that failed", async () => {
    handler = ok;
    const outcomes = new EventEmitter();
    const stop = judgeFindingsOnOutcome(outcomes, () => db, client)!;
    outcomes.emit("outcome", { reviewId: "o/r#1", status: "failed", title: "", target: null });
    expect(requests).toEqual([]);
    outcomes.emit("outcome", { reviewId: "o/r#1", status: "reported", title: "", target: null, findings: 2 });
    await vi.waitFor(() => expect(judgments()).toHaveLength(2));
    stop();
    expect(outcomes.listenerCount("outcome")).toBe(0);
  });

  it("never throws into the emitter, even when the database fails", async () => {
    handler = ok;
    const outcomes = new EventEmitter();
    judgeFindingsOnOutcome(outcomes, () => {
      throw new Error("db gone");
    }, client);
    expect(() => outcomes.emit("outcome", { reviewId: "o/r#1", status: "reported", title: "", target: null })).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });
});
