import { Router } from "express";
import { healthReader, realGit } from "../services/health";

export const healthRouter = Router();

const health = healthReader(process.env, realGit);

healthRouter.get("/health", (_req, res) => {
  res.json(health());
});
