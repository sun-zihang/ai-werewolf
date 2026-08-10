import { Router } from "express";
import { PROVIDERS } from "../ai/providers.js";

export function providersRouter(): Router {
  const r = Router();
  r.get("/", (_req, res) => {
    res.json(
      PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        kind: p.kind,
        baseUrl: p.baseUrl,
        defaultModels: p.defaultModels,
        needsKey: p.needsKey,
        note: p.note,
      }))
    );
  });
  return r;
}