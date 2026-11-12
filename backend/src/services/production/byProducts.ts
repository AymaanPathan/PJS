/**
 * The doc's "By-products & dispatch": each stream's store, calculated from what produced it and what left, the trucks
 * through the common gate procedure, and the boiler burning shell. The stores are the factory's, shared by its batches.
 */
import type { Prisma } from "@prisma/client";
import { STREAMS, boilerError, isStream, storeBalance, streamLabel, truckError, truckNetKg, truckStatus, type StoreBalance, type Stream } from "@anagroci/contract/domain/byProducts";
import { isIsoDate } from "@anagroci/contract/domain/dateFormat";
import { shellingFigures } from "@anagroci/contract/domain/shelling";
import type { BoilerInput, BoilerReadingView, TruckInput, TruckView } from "@anagroci/contract/types/lots";
import { prisma } from "../../db.js";
import { ValidationError } from "../../domain/validation.js";
import { blankToNull } from "./rcnReceipts.js";

type Tx = Prisma.TransactionClient;
const name = { select: { displayName: true } };

export async function storeBalances(tx: Tx | typeof prisma, site: string): Promise<StoreBalance[]> {
  const [loads, entries, days, trucks, boiler] = await Promise.all([
    tx.rcnReceipt.findMany({ where: { batch: { warehouse: site }, finalisedAt: { not: null } }, select: { dustKg: true, voidsKg: true } }),
    tx.lotEntry.findMany({ where: { kind: { in: ["waste_water", "winnowing", "grading"] }, status: { not: "rejected" }, lot: { batch: { warehouse: site } } }, select: { kind: true, values: true } }),
    tx.shellingDay.findMany({ where: { lot: { batch: { warehouse: site } } }, select: { inputKg: true, wholesKg: true, piecesKg: true, rejectionKg: true, oilKg: true, blackRejectionKg: true } }),
    tx.truckMovement.findMany({ where: { warehouse: site, gatePassNo: { not: null } }, select: { stream: true, tareKg: true, grossKg: true } }),
    tx.boilerReading.findMany({ where: { warehouse: site }, select: { shellKg: true } }),
  ]);
  const entryKg = (kind: string, key: string) => entries.filter((e) => e.kind === kind).reduce((n, e) => n + (Number((e.values as Record<string, string>)[key]) || 0), 0);
  const figures = days.map((d) => shellingFigures({ inputKg: d.inputKg, wholesKg: d.wholesKg ?? "", piecesKg: d.piecesKg ?? "", rejectionKg: d.rejectionKg ?? "", oilKg: d.oilKg ?? "", blackRejectionKg: d.blackRejectionKg ?? "" }));
  const produced: Record<Stream, number> = {
    dust_voids: loads.reduce((n, l) => n + (Number(l.dustKg) || 0) + (Number(l.voidsKg) || 0), 0),
    waste_water: entryKg("waste_water", "kg"),
    shell: figures.reduce((n, f) => n + f.shellKg, 0),
    shell_dust: figures.reduce((n, f) => n + f.shellDustKg, 0),
    black_rejection: days.reduce((n, d) => n + (Number(d.blackRejectionKg) || 0), 0),
    husk: entryKg("winnowing", "huskToStorageKg"),
    reject_kernels: entryKg("grading", "rejectionKg"),
  };
  const dispatched = (s: Stream) => trucks.filter((t) => t.stream === s).reduce((n, t) => n + (truckNetKg(t) ?? 0), 0);
  const burned = boiler.reduce((n, b) => n + (Number(b.shellKg) || 0), 0);
  return STREAMS.map((s) => storeBalance(s.key, produced[s.key], dispatched(s.key), s.key === "shell" ? burned : 0));
}

/** After removing what produced a by-product: what has since left can't be un-left. Throwing rolls the removal back. */
export async function assertStoresNotShort(tx: Tx, site: string): Promise<void> {
  const short = (await storeBalances(tx, site)).find((s) => s.stockKg < 0);
  if (short) throw new ValidationError(`That would leave the ${streamLabel(short.stream).toLowerCase()} store at ${short.stockKg.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg: it has already left by truck or been burned.`);
}

// ── Trucks ──────────────────────────────────────────────────────────────────────────────────────

const TRUCK_INCLUDE = { createdBy: name } satisfies Prisma.TruckMovementInclude;
type TruckRow = Prisma.TruckMovementGetPayload<{ include: typeof TRUCK_INCLUDE }>;

function truckView(t: TruckRow): TruckView {
  return {
    id: t.id, stream: t.stream as Stream, date: t.date, truckNo: t.truckNo, driver: t.driver ?? "", documentsChecked: t.documentsChecked,
    tareKg: t.tareKg ?? "", grossKg: t.grossKg ?? "", netKg: truckNetKg(t), slipNo: t.slipNo ?? "", buyer: t.buyer ?? "", category: t.category ?? "",
    price: t.price ?? "", gatePassNo: t.gatePassNo ?? "", status: truckStatus(t), createdBy: t.createdBy.displayName, createdAt: t.createdAt.toISOString(),
  };
}

export async function listTrucks(site: string): Promise<TruckView[]> {
  const rows = await prisma.truckMovement.findMany({ where: { warehouse: site }, include: TRUCK_INCLUDE, orderBy: { id: "desc" } });
  return rows.map(truckView);
}

function truckData(input: TruckInput, date: string) {
  return {
    stream: input.stream!, date, truckNo: input.truckNo!.trim(), driver: blankToNull(input.driver), documentsChecked: Boolean(input.documentsChecked),
    tareKg: blankToNull(input.tareKg), grossKg: blankToNull(input.grossKg), slipNo: blankToNull(input.slipNo), buyer: blankToNull(input.buyer),
    category: blankToNull(input.category), price: blankToNull(input.price), gatePassNo: blankToNull(input.gatePassNo),
  };
}

async function checkTruck(tx: Tx, site: string, input: TruckInput, selfId: number | null): Promise<string> {
  const date = (input.date ?? "").trim();
  if (date && !isIsoDate(date)) throw new ValidationError("A date is required.");
  const stock = isStream(input.stream) ? (await storeBalances(tx, site)).find((s) => s.stream === input.stream)!.stockKg : 0;
  const problem = truckError({ ...input, date }, stock);
  if (problem) throw new ValidationError(problem);
  const pass = blankToNull(input.gatePassNo);
  if (pass) {
    const twin = await tx.truckMovement.findFirst({ where: { warehouse: site, gatePassNo: pass, ...(selfId ? { id: { not: selfId } } : {}) }, select: { id: true } });
    if (twin) throw new ValidationError(`Gate pass ${pass} is already used on another truck.`);
  }
  return date;
}

export async function addTruck(site: string, actorId: string, input: TruckInput): Promise<TruckView> {
  return truckView(await prisma.$transaction((tx) => addTruckIn(tx, site, actorId, input)));
}

export async function addTruckIn(tx: Tx, site: string, actorId: string, input: TruckInput): Promise<TruckRow> {
  const date = await checkTruck(tx, site, input, null);
  return tx.truckMovement.create({ data: { warehouse: site, ...truckData(input, date), createdById: actorId }, include: TRUCK_INCLUDE });
}

export async function updateTruck(site: string, id: number, input: TruckInput): Promise<TruckView> {
  return truckView(await prisma.$transaction((tx) => updateTruckIn(tx, site, id, input)));
}

/** A truck is filled in as it moves through the gate; once it has its gate pass it has left, and is closed. */
export async function updateTruckIn(tx: Tx, site: string, id: number, input: TruckInput): Promise<TruckRow> {
  const saved = await tx.truckMovement.findFirst({ where: { id, warehouse: site } });
  if (!saved) throw new ValidationError(`Truck ${id} doesn't exist at ${site}.`);
  if (saved.gatePassNo) throw new ValidationError(`Truck ${saved.truckNo} has left on gate pass ${saved.gatePassNo}; it can't be changed.`);
  const date = await checkTruck(tx, site, input, id);
  return tx.truckMovement.update({ where: { id }, data: truckData(input, date), include: TRUCK_INCLUDE });
}

/** A truck still at the gate entered by mistake. One with a gate pass has left, and stays on record. */
export async function deleteTruck(site: string, id: number): Promise<void> {
  const saved = await prisma.truckMovement.findFirst({ where: { id, warehouse: site } });
  if (!saved) throw new ValidationError(`Truck ${id} doesn't exist at ${site}.`);
  if (saved.gatePassNo) throw new ValidationError(`Truck ${saved.truckNo} has left on gate pass ${saved.gatePassNo}; it stays on record.`);
  await prisma.truckMovement.delete({ where: { id } });
}

// ── Boiler ──────────────────────────────────────────────────────────────────────────────────────

const boilerView = (b: Prisma.BoilerReadingGetPayload<{ include: { createdBy: typeof name } }>): BoilerReadingView => ({
  id: b.id, date: b.date, shellKg: b.shellKg, runningHours: b.runningHours ?? "", createdBy: b.createdBy.displayName,
});

export async function listBoilerReadings(site: string): Promise<BoilerReadingView[]> {
  const rows = await prisma.boilerReading.findMany({ where: { warehouse: site }, include: { createdBy: name }, orderBy: [{ date: "desc" }, { id: "desc" }] });
  return rows.map(boilerView);
}

export async function addBoilerReading(site: string, actorId: string, input: BoilerInput): Promise<BoilerReadingView> {
  return boilerView(await prisma.$transaction((tx) => addBoilerReadingIn(tx, site, actorId, input)));
}

export async function addBoilerReadingIn(tx: Tx, site: string, actorId: string, input: BoilerInput) {
  const date = (input.date ?? "").trim();
  if (date && !isIsoDate(date)) throw new ValidationError("A date is required.");
  const stock = (await storeBalances(tx, site)).find((s) => s.stream === "shell")!.stockKg;
  const problem = boilerError({ ...input, date }, stock);
  if (problem) throw new ValidationError(problem);
  return tx.boilerReading.create({ data: { warehouse: site, date, shellKg: input.shellKg!.trim(), runningHours: blankToNull(input.runningHours), createdById: actorId }, include: { createdBy: name } });
}

export async function deleteBoilerReading(site: string, id: number): Promise<void> {
  const saved = await prisma.boilerReading.findFirst({ where: { id, warehouse: site } });
  if (!saved) throw new ValidationError(`Boiler reading ${id} doesn't exist at ${site}.`);
  await prisma.boilerReading.delete({ where: { id } });
}
