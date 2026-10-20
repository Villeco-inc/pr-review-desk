import { Router } from "express";
import { getDb } from "../db/schema";
import { selectedRepos } from "../services/repo-selection";
import { forgetLocalSelection, readViewMemory, rememberLocalSelection, rememberPrView } from "../services/view-memory";

export const viewMemoryRouter = Router();

const selection = () => selectedRepos(getDb(), process.env.REPOS);

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
