import { Router } from "express";
import { getDb } from "../db/schema";
import { forgetLocalSelection, readViewMemory, rememberCompare, rememberLocalSelection, rememberPrView } from "../services/view-memory";
import { configuredRepos } from "./prs";

export const viewMemoryRouter = Router();

// The same selection the lists and Compare offer: the saved pick, else REPOS and the repositories discovered in SCAN_DIR.
const selection = configuredRepos;

viewMemoryRouter.get("/view-memory", (_req, res) => {
  res.json(readViewMemory(getDb(), selection()));
});

viewMemoryRouter.put("/view-memory/prs", (req, res) => {
  const { repo, filters } = req.body as { repo?: unknown; filters?: unknown };
  if (typeof repo !== "string") {
    res.status(400).json({ error: "repo is required" });
    return;
  }
  try {
    rememberPrView(getDb(), selection(), repo, filters);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

viewMemoryRouter.put("/view-memory/compare", (req, res) => {
  const { repo, head } = req.body as { repo?: unknown; head?: unknown };
  if (typeof repo !== "string") {
    res.status(400).json({ error: "repo is required" });
    return;
  }
  try {
    rememberCompare(getDb(), selection(), repo, head);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

viewMemoryRouter.put("/view-memory/local", (req, res) => {
  const { label, selection: picked } = req.body as { label?: unknown; selection?: unknown };
  if (typeof label !== "string") {
    res.status(400).json({ error: "label is required" });
    return;
  }
  try {
    rememberLocalSelection(getDb(), label, picked);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

viewMemoryRouter.delete("/view-memory/local/:label", (req, res) => {
  forgetLocalSelection(getDb(), req.params.label);
  res.status(204).end();
});
