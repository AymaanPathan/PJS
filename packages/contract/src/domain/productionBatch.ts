/**
 * Production Phase 0 (Batch): the rules both sides need.
 * Source: the client's "Production module" and "Phase 1 — Batch & Intake" documents (Oct 2026).
 *
 * A batch is a PLAN: a group of the factory's warehouse bins to be processed together, about one
 * month of work. Creating one moves no nuts and changes no stock.
 */
import type { ReceiptRecord, TransferRequest } from "../types/receipt.js";
import { GRN_QUANTITY_LABEL } from "./receiptStatus.js";
import { isGrnComplete } from "./recordLock.js";
import { parseQty } from "./receiptMath.js";
import { transferVariance } from "./transfers.js";

/** The client's settings: about 150 t a day, so a month is 3,700–4,500 t (150 t × ~26 working days). */
export const DAILY_CAPACITY_KG = 150_000;
export const MONTHLY_GUIDE_KG = { min: 3_700_000, max: 4_500_000 } as const;

// ── Warehouse bin stock, as procurement left it ────────────────────────────────────────────────

/** Where one procurement Lot stands, as far as production is concerned. */
export type LotBinState =
  /** In the bin, procurement finished: counts toward the bin's stock. */
  | "in_bin"
  /** In the bin, but its GRN weight is blank (an imported row from a sheet with no GRN column): counted as a Lot, not as kg. */
  | "weight_not_recorded"
  /** The n-bin step names several bins ("BIN-01/BIN-02"): which share went where was never recorded, so no kg is attributed. */
  | "split_across_bins"
  /** Came on a BKT carrying several Lots: the arrival was weighed per truck, not per Lot, so no kg is attributed. */
  | "weighed_with_other_lots";

export interface LotInBin {
  receiptId: string;
  lotNo: string;
  supplierName: string;
  arrivalDate: string;
  /** undefined unless state is "in_bin". */
  kg?: number;
  state: LotBinState;
  /** True when the Lot came back from sun drying into this bin (its dried quantity is what counts). */
  dried: boolean;
  /** Set when the Lot reached this site on a transfer (BKT): its receipt belongs to the sending site. */
  transferId?: string;
}

/**
 * A Lot another site sent here on a BKT, unloaded into one of this site's bins. The client's own sheets
 * chain it: "Bouake RCN Receiving at Factory" records the Yakro BIN NO. per Lot, and the bins in
 * "Issued to Production" (Source Bin) are those same bins.
 */
export interface ArrivedLot {
  transferId: string;
  receiptId: string;
  lotNo: string;
  supplierName: string;
  /** The day it arrived HERE (the BKT's receipt), not the supplier truck's arrival at the sending site. */
  arrivalDate: string;
  binCode: string;
  /** Net at arrival, from this site's scale. Undefined when the truck carried several Lots. */
  kg?: number;
}

/**
 * The Lots received into a bin on these transfers. The net at arrival is weighed per truck, so it is a
 * Lot's own weight only when the Lot was alone on the truck; splitting it between Lots would invent a
 * figure nobody weighed.
 */
export function arrivedLots(transfers: TransferRequest[]): ArrivedLot[] {
  return transfers
    .filter((t) => t.status === "received")
    .flatMap((t) => {
      const net = transferVariance(t).netAtArrivalKg;
      return t.lines
        .filter((l) => l.receivedBinCode)
        .map((l) => ({
          transferId: t.id,
          receiptId: l.receiptId,
          lotNo: l.lotNumber ?? "",
          supplierName: l.supplierName,
          arrivalDate: (t.receivedAt ?? "").slice(0, 10),
          binCode: l.receivedBinCode!.trim().toUpperCase(),
          kg: t.lines.length === 1 && net !== null ? net : undefined,
        }));
    });
}

export interface WarehouseBinStock {
  binCode: string;
  kg: number;
  lots: LotInBin[];
}

const filled = (v: string | undefined) => (v ?? "").trim() !== "";

/** The n-bin step reads several bins separated by "/" or "," (see masters' createBin). */
export function splitBinCodes(raw: string | undefined): string[] {
  return (raw ?? "").split(/[/,]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/**
 * Procurement is finished for a Lot only when nothing about it is still open — strict on purpose (team decision,
 * Oct 2026): a Lot whose questions are unanswered is "not ready", never assumed to be staying.
 *
 * - Quality passed.
 * - GRN complete: quantity and price, the rule that locks the record (recordLock.ts). An imported receipt only
 *   needs a GRN row: its sheet had no GRN quantity column, the same exception deriveStatus makes.
 * - Drying decided: "No drying needed", or the drying step exists (warehouseBinStock then waits for the dried
 *   quantity to come back). "Direct"/"Warehouse → Drying" chosen but not yet started is not ready either.
 * - Marked "Ready for production" at the warehouse. "Keep in warehouse" or no answer leaves it out of the bin's stock.
 *
 * Imported receipts never recorded the two decisions, so they don't qualify until someone answers them in the app.
 */
function procurementComplete(r: ReceiptRecord): boolean {
  if (r.branches["n-qfs"] !== "pass") return false;
  const grn = r.source === "imported" ? Boolean(r.stageData["n-grn"]) : isGrnComplete(r.stageData);
  if (!grn) return false;
  if (r.branches["n-xferdec"] !== "production") return false;
  return Boolean(r.stageData["n-drying"]) || r.branches["n-drying"] === "none";
}

/** The bins a Lot sits in now: the one it came back to from drying, otherwise the one it was allocated. */
export function binsOfLot(r: Pick<ReceiptRecord, "stageData" | "binNo">): string[] {
  const back = splitBinCodes(r.stageData["n-drying"]?.['New/assigned Bin (marked "dried stock")']);
  return back.length ? back : splitBinCodes(r.stageData["n-bin"]?.["Bin Number"] || r.binNo);
}

/**
 * What still stands between a Lot and "Ready for production", in the warehouse's words. Empty means it
 * can be marked. The same facts procurementComplete reads, so a Lot marked ready is one a batch can count.
 */
export function productionReadinessGaps(r: Pick<ReceiptRecord, "branches" | "stageData" | "binNo" | "source">): string[] {
  const drying = r.stageData["n-drying"];
  const dried = !drying || (parseQty(drying["Dried quantity returned to warehouse"]) !== undefined && binsOfLot(r).length > 0);
  return [
    r.branches["n-qfs"] !== "pass" && "pass Quality",
    binsOfLot(r).length === 0 && "allocate a Bin",
    !(r.source === "imported" ? Boolean(r.stageData["n-grn"]) : isGrnComplete(r.stageData)) && "complete the GRN (quantity and price)",
    !drying && r.branches["n-drying"] !== "none" && "answer the Drying step",
    !dried && "record the dried quantity returned to a Bin",
  ].filter((gap): gap is string => Boolean(gap));
}

/** What the "Ready for production" option needs to say while it can't be chosen. */
export function productionReadinessNotice(gaps: string[]): string | undefined {
  return gaps.length ? `Before this Lot can be marked ready for production: ${gaps.join(", ")}.` : undefined;
}

/** Lots marked "Keep in warehouse", per bin: physically there, but not in the stock a batch plans from. */
export function keptLotsByBin(receipts: ReceiptRecord[]): Map<string, number> {
  const kept = new Map<string, number>();
  for (const r of receipts) {
    if (r.branches["n-xferdec"] !== "stays") continue;
    for (const code of binsOfLot(r)) kept.set(code, (kept.get(code) ?? 0) + 1);
  }
  return kept;
}

/**
 * The stock of each warehouse bin, worked out from the procurement receipts — never stored, so it
 * can't drift from the Lots it is made of.
 *
 * - Only Lots whose procurement is finished (procurementComplete above) are in a bin at all; rejected and
 *   transferred-out trucks never are.
 * - The quantity is the GRN Weight: the quantity officially recognised into stock (recordLock.ts).
 *   Net, GRN and Paid are kept apart on purpose (client, Oct 2026), so Net is never substituted.
 * - A Lot sent to sun drying is out of its bin until the dried quantity is recorded as returned to a
 *   bin ("Dried quantity returned to warehouse" + "New/assigned Bin"); from then it counts there, at
 *   the dried quantity.
 */
export function warehouseBinStock(receipts: ReceiptRecord[], arrivals: ArrivedLot[] = []): Map<string, WarehouseBinStock> {
  const bins = new Map<string, WarehouseBinStock>();
  const add = (binCode: string, lot: LotInBin) => {
    const bin = bins.get(binCode) ?? { binCode, kg: 0, lots: [] };
    bin.lots.push(lot);
    if (lot.kg !== undefined) bin.kg += lot.kg;
    bins.set(binCode, bin);
  };

  for (const r of receipts) {
    if (!procurementComplete(r)) continue;

    const base = {
      receiptId: r.id,
      lotNo: r.lotNo || r.stageData["n-lot"]?.["Lot Number"] || "",
      supplierName: r.supplierName,
      arrivalDate: r.arrivalDate,
    };

    const drying = r.stageData["n-drying"];
    let binCodes: string[];
    let kg: number | undefined;
    let dried = false;
    if (drying) {
      const returned = parseQty(drying["Dried quantity returned to warehouse"]);
      const back = splitBinCodes(drying['New/assigned Bin (marked "dried stock")']);
      if (returned === undefined || back.length === 0) continue; // still out for drying
      binCodes = back;
      kg = returned;
      dried = true;
    } else {
      binCodes = splitBinCodes(r.stageData["n-bin"]?.["Bin Number"] || r.binNo);
      kg = filled(r.stageData["n-grn"]?.[GRN_QUANTITY_LABEL]) ? parseQty(r.stageData["n-grn"]![GRN_QUANTITY_LABEL]) : undefined;
    }
    if (binCodes.length === 0) continue;

    if (binCodes.length > 1) {
      for (const code of binCodes) add(code, { ...base, state: "split_across_bins", dried });
    } else if (kg === undefined) {
      add(binCodes[0]!, { ...base, state: "weight_not_recorded", dried });
    } else {
      add(binCodes[0]!, { ...base, kg, state: "in_bin", dried });
    }
  }
  // The sending site's receipt says "transferred out", so procurementComplete above never counts it there:
  // a Lot is in one site's bins or the other's, never both.
  for (const a of arrivals) {
    const lot = { receiptId: a.receiptId, lotNo: a.lotNo, supplierName: a.supplierName, arrivalDate: a.arrivalDate, dried: false, transferId: a.transferId };
    add(a.binCode, a.kg === undefined ? { ...lot, state: "weighed_with_other_lots" } : { ...lot, kg: a.kg, state: "in_bin" });
  }
  for (const bin of bins.values()) bin.kg = Math.round(bin.kg * 100) / 100;
  return bins;
}

// ── The batch plan ───────────────────────────────────────────────────────────────────────────

export interface BatchPlan {
  plannedKg: number;
  /** Days at the daily capacity, rounded: 4,172.9 t ÷ 150 t ≈ 28. */
  days: number;
  /** ISO date: start + days. Undefined while the start date isn't a real date. */
  endDate?: string;
  /** Outside 3,700–4,500 t is a warning only; creating is never blocked. */
  withinMonthlyGuide: boolean;
}

export function addDays(isoDate: string, days: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function planBatch(binKgs: number[], startDate: string): BatchPlan {
  const plannedKg = Math.round(binKgs.reduce((a, b) => a + b, 0) * 100) / 100;
  const days = Math.round(plannedKg / DAILY_CAPACITY_KG);
  return {
    plannedKg,
    days,
    endDate: addDays(startDate, days),
    withinMonthlyGuide: plannedKg >= MONTHLY_GUIDE_KG.min && plannedKg <= MONTHLY_GUIDE_KG.max,
  };
}

/** "ANA-" + the largest bin's own suffix: BIN-03B → ANA-03B, as the client names its batches. */
export function suggestBatchCode(bins: { binCode: string; kg: number }[]): string {
  if (bins.length === 0) return "";
  const largest = bins.reduce((a, b) => (b.kg > a.kg ? b : a));
  return `ANA-${largest.binCode.replace(/^BIN-?/i, "")}`;
}

/** Same shape as a Bin code: letters, digits and - _ . only. */
export const BATCH_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

// ── Status ──────────────────────────────────────────────────────────────────────────────────

/**
 * Open → In process (first load received) → Closed (by the Warehouse Incharge, Phase 8). Derived from the batch's RCN
 * Receipts and its closing, never typed.
 */
export type BatchStatus = "open" | "in_process" | "closed";

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = { open: "Waiting for first load", in_process: "In production", closed: "Closed" };

export function batchStatus(rcnReceiptCount: number, closed = false): BatchStatus {
  if (closed) return "closed";
  return rcnReceiptCount > 0 ? "in_process" : "open";
}
