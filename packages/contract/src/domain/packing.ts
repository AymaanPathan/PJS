/**
 * Production Phase 8: Packing, finished goods & dispatch. Two lanes reach packing — 8a Borma wholes straight from
 * Phase 6, 8b graded kernels from Phase 7 — with the same two checks: QC-9 before filling, QC-11 on the finished
 * goods. Source: the client's "Production module" document (Oct 2026), Phase 8, and "Packing Traceability  FG Aging
 * Report.xlsx", measured on its 470 rows (Nov 2026):
 *
 * - Every row's material code is in the "Code" master with the same description and SKU, so the app asks only for
 *   the Grade and reads code and SKU from data/packingMaterials.ts.
 * - Packed Qty in Kg's = Qty Packed × SKU on 468 of 470 rows: the app works it out, and a typed kg that differs is
 *   kept as typed with an alert (the 2 real rows).
 * - Closing Qty = Qty Packed − Quantity Dispatched on every row; Grouping is the aging bucket (<30, 30-90, 90-180,
 *   180-365, >365, and 0 once nothing is left).
 *
 * QC-9 has no workbook yet; QC-11 uses "the same sample format as QC-8".
 */
import { PACKING_MATERIALS, type PackingMaterial } from "../data/packingMaterials.js";
import { FINAL_OUTPUT_FIELDS, finalOutputFigureList, finalOutputNotes } from "./borma.js";
import type { EntryDef } from "./lotEntries.js";

type Values = Record<string, string | undefined>;

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const n0 = (v: string | undefined | null) => num(v) || 0;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const kg2 = (n: number) => Math.round(n * 100) / 100;

/** The doc's two lanes into packing. */
export const PACKING_LANES = ["8a · Borma wholes", "8b · Graded kernels"];
export const PACKING_GRADES = PACKING_MATERIALS.map((m) => m.grade);

export const materialOf = (grade: string | undefined): PackingMaterial | undefined => PACKING_MATERIALS.find((m) => m.grade === (grade ?? "").trim());

/** Kg of a quantity of packs: typed when the sheet typed it, else qty × SKU as the sheet works it out. */
export function packKg(v: { grade?: string; qty?: string; kg?: string }): number | null {
  const typed = num(v.kg);
  if (typed !== null && !Number.isNaN(typed)) return typed;
  const m = materialOf(v.grade);
  const qty = num(v.qty);
  return m && qty !== null && !Number.isNaN(qty) ? kg2(qty * m.sku) : null;
}

const kgNote = (v: { grade?: string; qty?: string; kg?: string }): string[] => {
  const m = materialOf(v.grade);
  const typed = num(v.kg);
  const qty = num(v.qty);
  if (!m || typed === null || qty === null || Number.isNaN(typed) || Number.isNaN(qty)) return [];
  const worked = kg2(qty * m.sku);
  return Math.abs(worked - typed) > 0.01 ? [`${fmt(qty)} packs × ${m.sku} kg is ${fmt(worked)} kg, not the ${fmt(typed)} kg typed.`] : [];
};

const materialFigures = (grade: string | undefined, kg: number | null) => {
  const m = materialOf(grade);
  return [
    { label: "Material code", value: m?.code ?? "-" },
    { label: "SKU", value: m ? `${m.sku} kg` : "-" },
    { label: "Kg", value: kg === null ? "-" : `${fmt(kg)} kg` },
  ];
};

export const PACKING_ENTRY_DEFS = {
  packing: {
    kind: "packing", sheet: "Packing", title: "Packing", who: "floor",
    help: "What was packed today, per grade. The material code and SKU come from the grade; kg is packs × SKU unless you type it.",
    fields: [
      { key: "lane", label: "Lane", type: "select", options: PACKING_LANES, required: true, keep: true },
      { key: "grade", label: "Grade", type: "select", options: PACKING_GRADES, required: true },
      { key: "bin", label: "Bin", type: "text", hint: "The production bin on the sheet, e.g. ANA-03B.", keep: true },
      { key: "qtyPacked", label: "Qty packed (packs)", type: "number", required: true },
      { key: "packedKg", label: "Packed kg", type: "number", hint: "Blank = packs × SKU." },
      { key: "pouches", label: "Pouches used", type: "number" },
      { key: "cartons", label: "Cartons used", type: "number" },
      { key: "n2", label: "N₂ used", type: "number" },
    ],
    figures: (v) => materialFigures(v.grade, packKg({ grade: v.grade, qty: v.qtyPacked, kg: v.packedKg })),
    notes: (v) => kgNote({ grade: v.grade, qty: v.qtyPacked, kg: v.packedKg }),
  },
  qc9: {
    kind: "qc9", sheet: "Pre-fill Checks", title: "Check before filling", check: "QC-9", who: "qfs",
    decision: { ok: "OK", okHint: "The kernels can be filled into pouches.", no: "No · back to packing", noHint: "Re-sort or re-blend; nothing is filled.", noValue: "no" },
    help: "Peeled or Borma wholes ready to pack, checked before they go into the pouch.",
    fields: [
      { key: "lane", label: "Lane", type: "select", options: PACKING_LANES, required: true, keep: true },
      { key: "grade", label: "Grade", type: "select", options: PACKING_GRADES },
      { key: "sampleG", label: "Sample (g)", type: "number", required: true, keep: true },
      { key: "moisture", label: "Moisture (%)", type: "number" },
      { key: "remarks", label: "Remarks", type: "text" },
    ],
  },
  qc11: {
    kind: "qc11", sheet: "Final Checks", title: "Final output analysis", check: "QC-11", who: "qfs",
    decision: { ok: "OK · release", okHint: "The finished goods can be dispatched.", no: "No · hold", noHint: "Held and sent back to packing; not released for dispatch.", noValue: "no" },
    help: "A sample of the packed finished goods, in the same format as QC-8. Stock is released for dispatch once this is OK.",
    fields: [{ key: "grade", label: "Grade", type: "select", options: PACKING_GRADES, keep: true }, ...FINAL_OUTPUT_FIELDS],
    figures: finalOutputFigureList, notes: finalOutputNotes,
  },
  fg_dispatch: {
    kind: "fg_dispatch", sheet: "FG Dispatch", title: "Dispatch", who: "floor",
    help: "Finished goods leaving against a sales contract. Only packed stock of the grade can leave.",
    fields: [
      { key: "grade", label: "Grade", type: "select", options: PACKING_GRADES, required: true },
      { key: "contractNo", label: "Contract no", type: "text", required: true, keep: true },
      { key: "qtyOut", label: "Qty dispatched (packs)", type: "number", required: true },
      { key: "kgOut", label: "Dispatched kg", type: "number", hint: "Blank = packs × SKU." },
      { key: "truckNo", label: "Truck no", type: "text", keep: true },
      { key: "gatePassNo", label: "Gate pass / Sortie no", type: "text", keep: true },
    ],
    figures: (v) => materialFigures(v.grade, packKg({ grade: v.grade, qty: v.qtyOut, kg: v.kgOut })),
    notes: (v) => kgNote({ grade: v.grade, qty: v.qtyOut, kg: v.kgOut }),
  },
} satisfies Record<string, EntryDef>;

// ── Finished goods stock and aging ──────────────────────────────────────────────────────────────

/** The sheet's Grouping column. */
export function agingBucket(days: number, closingQty: number): string {
  if (closingQty <= 0) return "0";
  if (days < 30) return "<30";
  if (days < 90) return "30-90";
  if (days < 180) return "90-180";
  if (days < 365) return "180-365";
  return ">365";
}

export interface FgStockRow {
  grade: string;
  code: string;
  sku: number | null;
  packedQty: number;
  packedKg: number;
  dispatchedQty: number;
  dispatchedKg: number;
  closingQty: number;
  closingKg: number;
  /** The first packing date of this grade on the Lot. */
  packedOn: string;
  /** Today − packing date while anything is left, as the sheet's Aging; 0 once it has all gone. */
  agingDays: number;
  bucket: string;
}

const daysBetween = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

interface EntryLike { kind: string; date: string; status: string; values: Values }

/** "Closing quantity = packed − dispatched (pieces and kg) · Aging = today − packing date", per grade. */
export function fgStock(entries: EntryLike[], today: string): FgStockRow[] {
  const live = entries.filter((e) => e.status !== "rejected");
  const grades = [...new Set(live.filter((e) => e.kind === "packing").map((e) => e.values.grade ?? ""))].filter(Boolean);
  return grades.map((grade) => {
    const packs = live.filter((e) => e.kind === "packing" && e.values.grade === grade);
    const outs = live.filter((e) => e.kind === "fg_dispatch" && e.values.grade === grade);
    const m = materialOf(grade);
    const packedQty = packs.reduce((n, e) => n + n0(e.values.qtyPacked), 0);
    const packedKg = kg2(packs.reduce((n, e) => n + (packKg({ grade, qty: e.values.qtyPacked, kg: e.values.packedKg }) ?? 0), 0));
    const dispatchedQty = outs.reduce((n, e) => n + n0(e.values.qtyOut), 0);
    const dispatchedKg = kg2(outs.reduce((n, e) => n + (packKg({ grade, qty: e.values.qtyOut, kg: e.values.kgOut }) ?? 0), 0));
    const closingQty = packedQty - dispatchedQty;
    const packedOn = packs.map((e) => e.date).sort()[0] ?? "";
    const agingDays = closingQty > 0 && packedOn ? daysBetween(packedOn, today) : 0;
    return {
      grade, code: m?.code ?? "", sku: m?.sku ?? null, packedQty, packedKg, dispatchedQty, dispatchedKg, closingQty,
      closingKg: kg2(packedKg - dispatchedKg), packedOn, agingDays, bucket: agingBucket(agingDays, closingQty),
    };
  });
}
