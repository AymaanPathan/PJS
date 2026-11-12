/**
 * Production Phases 3–8: Lots, by-products and the boiler. Thin, like calibration.ts. Everything is Admin / Warehouse
 * Incharge except what auth/policy.ts opens to a QFS Officer: reading a batch's Lots and submitting their checks.
 */
import type { FastifyInstance } from "fastify";
import type { BatchLots, BoilerInput, CoolingInput, CookRunInput, LotEntryInput, ShellingDayInput, TruckInput } from "@anagroci/contract/types/lots";
import { currentUser, requireRole } from "../auth/plugin.js";
import { prisma } from "../db.js";
import {
  addBoilerReading, addTruck, deleteBoilerReading, deleteTruck, listBoilerReadings, listTrucks, storeBalances, updateTruck,
} from "../services/production/byProducts.js";
import {
  addLotEntry, addShellingDay, approveAllOfKind, cookLot, deleteCookRun, deleteLotEntry, deleteShellingDay, listLots, moveToCooling, reviewLotEntry, updateLotEntry,
} from "../services/production/factoryLots.js";
import { siteFor } from "./productionBatches.js";
import { runWhere } from "../services/production/batches.js";
import { listRcnReceipts } from "../services/production/rcnReceipts.js";
import { runBalanceOf } from "../services/production/runBalance.js";

export async function factoryLotRoutes(app: FastifyInstance) {
  const reviewers = { preHandler: requireRole("admin", "warehouse_incharge") };

  app.get("/api/production/batches/:code/lots", async (req, reply): Promise<BatchLots | undefined> => {
    const { code } = req.params as { code: string };
    const site = await siteFor(req);
    const batch = await prisma.productionBatch.findFirst({ where: runWhere(site, code), select: { code: true } });
    if (!batch) {
      reply.code(404).send({ error: `Production run ${code} not found` });
      return undefined;
    }
    const [lots, stores, trucks, boiler, all, loads] = await Promise.all([
      listLots(site, batch.code), storeBalances(prisma, site), listTrucks(site), listBoilerReadings(site),
      prisma.factoryLot.findMany({ where: { batch: { warehouse: site } }, select: { code: true } }),
      listRcnReceipts(site, batch.code),
    ]);
    return { lots, stores, trucks, boiler, allLotCodes: all.map((l) => l.code), balance: runBalanceOf(loads, lots) };
  });

  app.post("/api/production/factory-lots", reviewers, async (req, reply) => {
    const lot = await cookLot(await siteFor(req), currentUser(req).id, (req.body ?? {}) as CookRunInput);
    return reply.code(201).send(lot);
  });

  app.delete("/api/production/lot-cook-runs/:id", reviewers, async (req, reply) => {
    await deleteCookRun(await siteFor(req), Number((req.params as { id: string }).id));
    return reply.code(204).send();
  });

  app.post("/api/production/factory-lots/:code/cooling", reviewers, async (req) => {
    const { code } = req.params as { code: string };
    return moveToCooling(await siteFor(req), code, (req.body ?? {}) as CoolingInput);
  });

  app.post("/api/production/factory-lots/:code/entries", async (req, reply) => {
    const { code } = req.params as { code: string };
    const lot = await addLotEntry(await siteFor(req), currentUser(req), code, (req.body ?? {}) as LotEntryInput);
    return reply.code(201).send(lot);
  });

  app.post("/api/production/factory-lots/:code/entries/approve-all", reviewers, async (req) => {
    const { code } = req.params as { code: string };
    const { kind } = (req.body ?? {}) as { kind?: string };
    return approveAllOfKind(await siteFor(req), currentUser(req).id, code, kind ?? "");
  });

  app.post("/api/production/lot-entries/:id/approve", reviewers, async (req) => {
    return reviewLotEntry(await siteFor(req), currentUser(req).id, Number((req.params as { id: string }).id), true);
  });

  app.post("/api/production/lot-entries/:id/reject", reviewers, async (req) => {
    const { reason } = (req.body ?? {}) as { reason?: string };
    return reviewLotEntry(await siteFor(req), currentUser(req).id, Number((req.params as { id: string }).id), false, reason);
  });

  /** A floor record corrected or completed (a Borma trolley's weight after the oven). Checks are never edited. */
  app.put("/api/production/lot-entries/:id", reviewers, async (req) => {
    return updateLotEntry(await siteFor(req), currentUser(req), Number((req.params as { id: string }).id), (req.body ?? {}) as LotEntryInput);
  });

  app.delete("/api/production/lot-entries/:id", reviewers, async (req, reply) => {
    await deleteLotEntry(await siteFor(req), Number((req.params as { id: string }).id));
    return reply.code(204).send();
  });

  app.post("/api/production/factory-lots/:code/shelling-days", reviewers, async (req, reply) => {
    const { code } = req.params as { code: string };
    const lot = await addShellingDay(await siteFor(req), currentUser(req).id, code, (req.body ?? {}) as ShellingDayInput);
    return reply.code(201).send(lot);
  });

  app.delete("/api/production/shelling-days/:id", reviewers, async (req, reply) => {
    await deleteShellingDay(await siteFor(req), Number((req.params as { id: string }).id));
    return reply.code(204).send();
  });

  app.post("/api/production/trucks", reviewers, async (req, reply) => {
    return reply.code(201).send(await addTruck(await siteFor(req), currentUser(req).id, (req.body ?? {}) as TruckInput));
  });

  app.put("/api/production/trucks/:id", reviewers, async (req) => {
    return updateTruck(await siteFor(req), Number((req.params as { id: string }).id), (req.body ?? {}) as TruckInput);
  });

  app.delete("/api/production/trucks/:id", reviewers, async (req, reply) => {
    await deleteTruck(await siteFor(req), Number((req.params as { id: string }).id));
    return reply.code(204).send();
  });

  app.post("/api/production/boiler", reviewers, async (req, reply) => {
    return reply.code(201).send(await addBoilerReading(await siteFor(req), currentUser(req).id, (req.body ?? {}) as BoilerInput));
  });

  app.delete("/api/production/boiler/:id", reviewers, async (req, reply) => {
    await deleteBoilerReading(await siteFor(req), Number((req.params as { id: string }).id));
    return reply.code(204).send();
  });
}
