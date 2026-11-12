/**
 * Production Phase 0: batches (and Phase 8's closing). Thin: resolve the factory site the
 * caller works at, call the service, return JSON. Admin and Warehouse Incharge only — auth/policy.ts
 * closes these to every other role by default.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { currentUser, requireRole } from "../auth/plugin.js";
import { scopedWarehouse } from "../auth/scope.js";
import { batchOfBin, closeBatch, getBatch, listAvailableBins, listBatches, productionSite, reopenBatch } from "../services/production/batches.js";
import { startRun, type StartRunInput } from "../services/production/startRun.js";

/** The factory site the caller works at — shared by every production route. */
export async function siteFor(req: FastifyRequest) {
  const { warehouse } = req.query as { warehouse?: string };
  return productionSite(scopedWarehouse(req, warehouse));
}

export async function productionBatchRoutes(app: FastifyInstance) {
  app.get("/api/production/batch-bins", async (req) => listAvailableBins(await siteFor(req)));

  app.get("/api/production/batches", async (req) => listBatches(await siteFor(req)));

  app.post("/api/production/batches", async (req, reply) => {
    const site = await siteFor(req);
    // The bins, and any loads already brought from them, in one save (services/production/startRun.ts).
    const code = await startRun(site, currentUser(req).id, (req.body ?? {}) as StartRunInput);
    return reply.code(201).send(await getBatch(site, code));
  });

  app.get("/api/production/batches/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    const row = await getBatch(await siteFor(req), code);
    if (!row) return reply.code(404).send({ error: `Batch ${code} not found` });
    return row;
  });

  /** Phase 8: the Warehouse Incharge closes the run; only an Admin reopens it ("unlocks locked records"). */
  app.post("/api/production/batches/:code/close", { preHandler: requireRole("admin", "warehouse_incharge") }, async (req) => {
    const { code } = req.params as { code: string };
    return closeBatch(await siteFor(req), currentUser(req).id, code);
  });

  app.post("/api/production/batches/:code/reopen", { preHandler: requireRole("admin") }, async (req) => {
    const { code } = req.params as { code: string };
    return reopenBatch(await siteFor(req), code);
  });

  /** For the procurement Bin page: which batch the bin was put in, if any. */
  app.get("/api/production/bin-batch/:binCode", async (req) => {
    const { binCode } = req.params as { binCode: string };
    return { batch: await batchOfBin(binCode) };
  });
}
