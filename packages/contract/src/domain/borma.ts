/**
 * Production Phase 6: Borma (drying). Kernels go onto numbered trolleys, are weighed, dried in a Borma oven, weighed
 * again, checked (QC-8) and sent on: wholes to packing or peeling, everything else to peeling. Source: the client's
 * "Production module" document (Oct 2026), Phase 6, and three of its sheets, measured on every row (Nov 2026):
 *
 * - "18. Borma Loss Tally Sheet" (6,940 trolley rows). Material is written Wholes / Pieces / Reject / Oil and To is
 *   Packing (6,242) or Peeling (698) — the sheet's own words, kept. The empty trolley is weighed before AND after
 *   (they differ on 199 rows), so both are recorded. After > before on 8 rows: an alert, never a refusal.
 * - "20. Borma Machine Monitoring report": one oven run per Borma — start, stop, set pressure, 4 cycles of
 *   temperature and hours. Running hours = stop − start (07:44 → 16:44 = 9 h on its first row).
 * - "14. Final Output Analysis Report" (QC-8, 262 samples): every % below holds on all 262 rows, including
 *   Pieces % = (pieces + butts) ÷ sample and Spotted % = (spotted + PUK3) ÷ sample.
 *
 * The daily Borma summary ("8. Borma Process Report") is not entered: it is worked out from the trolley lines.
 */
import { durationHours } from "./cooking.js";
import type { EntryDef, EntryField, EntryFigure } from "./lotEntries.js";

type Values = Record<string, string | undefined>;

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const n0 = (v: string | undefined | null) => num(v) || 0;
const pct = (n: number, digits = 1) => `${n.toFixed(digits)} %`;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const kg2 = (n: number) => Math.round(n * 100) / 100;

/** The plant's 14 Borma ovens, numbered as on the sheets (1 … 14). */
export const BORMA_NOS = Array.from({ length: 14 }, (_, i) => String(i + 1));
/** The tally sheet's Material column, its own four words. */
export const BORMA_MATERIALS = ["Wholes", "Pieces", "Reject", "Oil"] as const;
export type BormaMaterial = (typeof BORMA_MATERIALS)[number];
/** The tally sheet's To column. "Peeling" is the doc's humidification → peeling → grading lane (Phase 7). */
export const BORMA_ROUTES = ["Packing", "Peeling"] as const;
/** The Shift column of the quality sheets. */
const SHIFTS = ["A", "B", "G"];

// ── Trolley line ────────────────────────────────────────────────────────────────────────────────

export interface TrolleyFigures {
  netBeforeKg: number;
  /** Null while the trolley is still in the oven (no gross after yet). */
  netAfterKg: number | null;
  lossKg: number | null;
  lossPct: number | null;
}

/** "Net = gross − empty trolley · Loss = net before − net after · Loss % = loss ÷ net before". No empty-after weight = the same trolley weight as before. */
export function trolleyFigures(v: Values): TrolleyFigures {
  const netBeforeKg = kg2(n0(v.grossBeforeKg) - n0(v.emptyBeforeKg));
  if (num(v.grossAfterKg) === null) return { netBeforeKg, netAfterKg: null, lossKg: null, lossPct: null };
  const emptyAfter = num(v.emptyAfterKg) ?? n0(v.emptyBeforeKg);
  const netAfterKg = kg2(n0(v.grossAfterKg) - emptyAfter);
  const lossKg = kg2(netBeforeKg - netAfterKg);
  return { netBeforeKg, netAfterKg, lossKg, lossPct: netBeforeKg > 0 ? (lossKg / netBeforeKg) * 100 : null };
}

// ── QC-8 / QC-11: the final output sample ───────────────────────────────────────────────────────

/** The "14. Final Output Analysis Report" columns; QC-11 at packing uses "the same sample format as QC-8". */
export const FINAL_OUTPUT_FIELDS: EntryField[] = [
  { key: "shift", label: "Shift", type: "select", options: SHIFTS, keep: true },
  { key: "sampleG", label: "Sample (g)", type: "number", required: true, keep: true },
  { key: "nutCount", label: "Nut count", type: "number" },
  { key: "moisture", label: "Moisture (%)", type: "number", required: true },
  { key: "goodKernelsG", label: "Good kernels (g)", type: "number" },
  { key: "piecesG", label: "Pieces (g)", type: "number" },
  { key: "buttsG", label: "Butts (g)", type: "number" },
  { key: "scorchedG", label: "Scorched (g)", type: "number" },
  { key: "spottedG", label: "Spotted (g)", type: "number" },
  { key: "puk3G", label: "PUK3 (g)", type: "number" },
  { key: "shrivelledG", label: "Shrivelled (g)", type: "number" },
  { key: "blemishG", label: "Blemish (g)", type: "number" },
  { key: "dessertG", label: "Dessert / NW (g)", type: "number" },
  { key: "oilG", label: "Oil (g)", type: "number" },
  { key: "dirtyG", label: "Dirty (g)", type: "number" },
  { key: "mechanicalDamageG", label: "Mechanical damage (g)", type: "number" },
  { key: "rejectionG", label: "Rejection (g)", type: "number" },
  { key: "huskG", label: "Husk (g)", type: "number" },
];

const FINAL_OUTPUT_PARTS = ["goodKernelsG", "piecesG", "buttsG", "scorchedG", "spottedG", "puk3G", "shrivelledG", "blemishG", "dessertG", "oilG", "dirtyG", "mechanicalDamageG", "rejectionG", "huskG"];

export function finalOutputFigures(v: Values) {
  const sample = n0(v.sampleG);
  const of = (...keys: string[]) => (sample > 0 ? (keys.reduce((n, k) => n + n0(v[k]), 0) / sample) * 100 : 0);
  return {
    goodPct: of("goodKernelsG"),
    piecesPct: of("piecesG", "buttsG"),
    scorchedPct: of("scorchedG"),
    spottedPct: of("spottedG", "puk3G"),
    shrivelledBlemishedPct: of("shrivelledG", "blemishG"),
    dessertPct: of("dessertG"),
    dirtOilPct: of("oilG", "dirtyG"),
    rejectionPct: of("rejectionG"),
    huskPct: of("huskG"),
    errorG: sample - FINAL_OUTPUT_PARTS.reduce((n, k) => n + n0(v[k]), 0),
  };
}

export const finalOutputFigureList = (v: Values): EntryFigure[] => {
  const f = finalOutputFigures(v);
  return [
    { label: "Good kernels %", value: pct(f.goodPct) },
    { label: "Scorched %", value: pct(f.scorchedPct) },
    { label: "Spotted %", value: pct(f.spottedPct) },
    { label: "Shrivelled / blemished %", value: pct(f.shrivelledBlemishedPct) },
    { label: "Rejection %", value: pct(f.rejectionPct) },
    { label: "Husk %", value: pct(f.huskPct) },
  ];
};

/** "Parts add up to the sample": an alert, as on every other sample of the line. */
export const finalOutputNotes = (v: Values): string[] => {
  const f = finalOutputFigures(v);
  return n0(v.sampleG) > 0 && Math.abs(f.errorG) > 0.0001 ? [`The parts add up to ${fmt(n0(v.sampleG) - f.errorG)} g, not the ${fmt(n0(v.sampleG))} g sample.`] : [];
};

// ── The entry definitions ───────────────────────────────────────────────────────────────────────

const OVEN_CYCLES: EntryField[] = [1, 2, 3, 4].flatMap((c) => [
  { key: `cycle${c}TempC`, label: `Cycle ${c} temperature (°C)`, type: "number" as const },
  { key: `cycle${c}Hours`, label: `Cycle ${c} time (h)`, type: "number" as const },
]);

export const BORMA_ENTRY_DEFS = {
  borma_trolley: {
    kind: "borma_trolley", sheet: "Borma Trolleys", title: "Trolley line", who: "floor",
    help: "One line per trolley, as on the Borma tally sheet. Weigh it empty and loaded before the oven; add the weights after the oven when it comes out (edit the line).",
    fields: [
      { key: "bormaNo", label: "Borma no", type: "select", options: BORMA_NOS, required: true, keep: true },
      { key: "material", label: "Material", type: "select", options: [...BORMA_MATERIALS], required: true, keep: true },
      { key: "trolleyNo", label: "Trolley no", type: "text", required: true },
      { key: "emptyBeforeKg", label: "Empty trolley before (kg)", type: "number", required: true },
      { key: "grossBeforeKg", label: "Gross before (kg)", type: "number", required: true, hint: "Trolley + kernels." },
      { key: "emptyAfterKg", label: "Empty trolley after (kg)", type: "number", hint: "Blank = the same as before." },
      { key: "grossAfterKg", label: "Gross after (kg)", type: "number", hint: "Weighed when the trolley comes out of the oven." },
      { key: "to", label: "Goes to", type: "select", options: [...BORMA_ROUTES], hint: "Wholes: Packing or Peeling. Pieces, reject and oil: Peeling." },
    ],
    figures: (v) => {
      const f = trolleyFigures(v);
      return [
        { label: "Net before", value: `${fmt(f.netBeforeKg)} kg` },
        { label: "Net after", value: f.netAfterKg === null ? "In the oven" : `${fmt(f.netAfterKg)} kg` },
        { label: "Loss (kg)", value: f.lossKg === null ? "-" : `${fmt(f.lossKg)} kg`, alert: f.lossKg !== null && f.lossKg < 0 },
        { label: "Loss %", value: f.lossPct === null ? "-" : pct(f.lossPct) },
      ];
    },
    notes: (v) => {
      const f = trolleyFigures(v);
      const out: string[] = [];
      if (n0(v.grossBeforeKg) > 0 && f.netBeforeKg <= 0) out.push("The gross before is not more than the empty trolley: check the weights.");
      if (f.lossKg !== null && f.lossKg < 0) out.push("The kernels weigh more after the oven than before: check the weights.");
      if (v.to === "Packing" && v.material && v.material !== "Wholes") out.push(`Only wholes go straight to packing; ${v.material.toLowerCase()} goes to peeling.`);
      return out;
    },
  },
  borma_oven: {
    kind: "borma_oven", sheet: "Borma Ovens", title: "Oven run", who: "floor",
    help: "One line per Borma per run, as on the Borma machine monitoring sheet. A second run of the same oven is a new line.",
    fields: [
      { key: "bormaNo", label: "Borma no", type: "select", options: BORMA_NOS, required: true },
      { key: "start", label: "Start", type: "time", required: true, keep: true },
      { key: "stop", label: "Stop", type: "time", required: true, keep: true },
      { key: "pressureBar", label: "Set pressure (bar)", type: "number", required: true },
      ...OVEN_CYCLES.map((f) => ({ ...f, keep: true })),
    ],
    figures: (v) => {
      const h = durationHours(v.start, v.stop);
      return [{ label: "Running hours", value: h === null ? "-" : `${h.toFixed(2)} h` }];
    },
  },
  qc8: {
    kind: "qc8", sheet: "Borma Quality", title: "Quality after the Borma", check: "QC-8", who: "qfs",
    decision: { ok: "OK", okHint: "The trolleys go on to packing or peeling.", no: "No · back into the Borma", noHint: "The trolley goes back into the oven for another run.", noValue: "no" },
    help: "A 1,000 g sample of the dried kernels, weighed into its parts. The app works out each %.",
    fields: FINAL_OUTPUT_FIELDS, figures: finalOutputFigureList, notes: finalOutputNotes,
  },
} satisfies Record<string, EntryDef>;

// ── The Lot's Borma summary ─────────────────────────────────────────────────────────────────────

export interface BormaSummary {
  trolleys: number;
  /** Trolleys with a weight after the oven. */
  weighedAfter: number;
  beforeKg: number;
  /** Only the trolleys weighed after, so loss is like for like. */
  afterKg: number;
  /** Before kg of the trolleys weighed after. */
  beforeOfWeighedKg: number;
  lossKg: number;
  lossPct: number | null;
  byMaterial: Record<BormaMaterial, { beforeKg: number; afterKg: number }>;
  /** After-oven kg routed each way. */
  toPackingKg: number;
  toPeelingKg: number;
}

/** "The daily Borma summary is built from the trolley lines — no separate entry." */
export function bormaSummary(trolleys: { values: Record<string, string | undefined> }[]): BormaSummary {
  const byMaterial = Object.fromEntries(BORMA_MATERIALS.map((m) => [m, { beforeKg: 0, afterKg: 0 }])) as BormaSummary["byMaterial"];
  let beforeKg = 0, afterKg = 0, beforeOfWeighedKg = 0, weighedAfter = 0, toPackingKg = 0, toPeelingKg = 0;
  for (const t of trolleys) {
    const f = trolleyFigures(t.values);
    const m = byMaterial[t.values.material as BormaMaterial];
    beforeKg += f.netBeforeKg;
    if (m) m.beforeKg += f.netBeforeKg;
    if (f.netAfterKg === null) continue;
    weighedAfter++;
    afterKg += f.netAfterKg;
    beforeOfWeighedKg += f.netBeforeKg;
    if (m) m.afterKg += f.netAfterKg;
    if (t.values.to === "Packing") toPackingKg += f.netAfterKg;
    if (t.values.to === "Peeling") toPeelingKg += f.netAfterKg;
  }
  for (const m of BORMA_MATERIALS) byMaterial[m] = { beforeKg: kg2(byMaterial[m].beforeKg), afterKg: kg2(byMaterial[m].afterKg) };
  const lossKg = kg2(beforeOfWeighedKg - afterKg);
  return {
    trolleys: trolleys.length, weighedAfter, beforeKg: kg2(beforeKg), afterKg: kg2(afterKg), beforeOfWeighedKg: kg2(beforeOfWeighedKg),
    lossKg, lossPct: beforeOfWeighedKg > 0 ? (lossKg / beforeOfWeighedKg) * 100 : null, byMaterial, toPackingKg: kg2(toPackingKg), toPeelingKg: kg2(toPeelingKg),
  };
}
