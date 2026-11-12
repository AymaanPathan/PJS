/**
 * Production Phase 7: Humidification, peeling & grading. Kernels the Borma routed to Peeling are humidified so the
 * skin comes off (QC-10), peeled, the husk winnowed to recover pieces, then graded (QC-12). Source: the client's
 * "Production module" document (Oct 2026), Phase 7, and "Manual Peeling Individual peformance.xlsb":
 *
 * - Its "Online Sheet" is the grading day record: Date, UNIT, Input Material, one kg column per grade (the codes
 *   below, exactly as the sheet writes them), Rejection, Total Qty, No of Manpower, Avg Per head, Recoverability %.
 *   Total = Σ grades + rejection holds on its rows (17/08/2026: 74.8 kg, 11 workers → 6.8 kg/head).
 * - Its "Database" tab is the worker output: employee no, name, gender, kg per day; the bands are its own.
 *
 * Humidification, QC-10, the peeling machine, husk winnowing and QC-12 have no workbook yet (the doc's "No workbook
 * yet" row): their fields are the doc's, nothing more. Recoverability % is kept as typed — "rule to be agreed".
 */
import type { EntryDef, EntryFigure } from "./lotEntries.js";

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

/** The grading sheet's grade columns, in its order and spelling. "Rejection" is a column of its own (reject kernels). */
export const GRADE_CODES = ["WW", "CW", "SW", "SSW", "DW", "PUK1", "PUK2", "PUK3", "SS", "LP", "DP", "OW", "DW2", "FB", "SB", "FS", "LWP", "OP", "SP", "SSP2", "KTP", "SP2", "Powder"] as const;
export const gradeKey = (code: string) => `kg_${code}`;

/** The doc's four grading routes; only manual peeling has a workbook today. */
export const GRADING_ROUTES = ["Manual peeling", "Colour sorter", "Dicing", "Taiho"];

/** "Worker band (kg/day): GOOD > 11 · AVERAGE 9–11 · NEED IMPROVEMENT 7–9 · POOR 5–7 · V.POOR < 5" — the workbook's own words. */
export function workerBand(kg: number): "GOOD" | "AVERAGE" | "NEED IMPROVEMENT" | "POOR" | "V.POOR" {
  if (kg > 11) return "GOOD";
  if (kg >= 9) return "AVERAGE";
  if (kg >= 7) return "NEED IMPROVEMENT";
  if (kg >= 5) return "POOR";
  return "V.POOR";
}
/** The doc's alert: "worker below 5 kg/day". */
export const WORKER_ALERT_KG = 5;

export function gradingFigures(v: Values) {
  const gradesKg = GRADE_CODES.reduce((n, c) => n + n0(v[gradeKey(c)]), 0);
  const totalKg = kg2(gradesKg + n0(v.rejectionKg));
  const manpower = n0(v.manpower);
  return { gradesKg: kg2(gradesKg), totalKg, avgPerHead: manpower > 0 ? totalKg / manpower : null };
}

const outOver = (label: string, outKg: number, inKg: number): string[] =>
  inKg > 0 && outKg > inKg + 0.0001 ? [`${label} add up to ${fmt(outKg)} kg, more than the ${fmt(inKg)} kg that went in.`] : [];

export const PEELING_ENTRY_DEFS = {
  humidification: {
    kind: "humidification", sheet: "Humidification", title: "Humidification", who: "floor",
    help: "Trolleys the Borma sent to peeling go into a humidification chamber so the skin comes off. Weigh in and out.",
    fields: [
      { key: "chamber", label: "Chamber", type: "text", required: true, keep: true },
      { key: "trolleys", label: "Trolley nos", type: "text", hint: "As written on the trolleys, e.g. 12, 45, 88." },
      { key: "kgIn", label: "Kg in", type: "number", required: true },
      { key: "start", label: "Start", type: "time" },
      { key: "end", label: "End", type: "time" },
      { key: "kgOut", label: "Kg out", type: "number" },
    ],
    figures: (v): EntryFigure[] => {
      const out = num(v.kgOut);
      const gain = out === null || Number.isNaN(out) ? null : out - n0(v.kgIn);
      return [
        { label: "Moisture gain", value: gain === null ? "-" : `${fmt(gain)} kg` },
        { label: "Gain %", value: gain === null || n0(v.kgIn) <= 0 ? "-" : `${((gain / n0(v.kgIn)) * 100).toFixed(1)} %` },
      ];
    },
  },
  qc10: {
    kind: "qc10", sheet: "Humidity Checks", title: "Moisture before peeling", check: "QC-10", who: "qfs",
    decision: { ok: "OK", okHint: "The kernels go on to peeling.", no: "No · back to humidification", noHint: "The trolleys go back into the chamber.", noValue: "no" },
    help: "Moisture of the humidified kernels, before peeling.",
    fields: [
      { key: "chamber", label: "Chamber", type: "text" },
      { key: "moisture", label: "Moisture (%)", type: "number", required: true },
    ],
  },
  peeling: {
    kind: "peeling", sheet: "Peeling", title: "Peeling machine", who: "floor",
    help: "What one peeling machine took in and gave out. The husk goes on to winnowing.",
    fields: [
      { key: "machine", label: "Machine", type: "text", required: true, keep: true },
      { key: "kgIn", label: "Kg in", type: "number", required: true },
      { key: "wholesKg", label: "Wholes (kg)", type: "number" },
      { key: "piecesKg", label: "Pieces (kg)", type: "number" },
      { key: "huskKg", label: "Husk (kg)", type: "number" },
    ],
    figures: (v) => [{ label: "Out", value: `${fmt(n0(v.wholesKg) + n0(v.piecesKg) + n0(v.huskKg))} kg` }],
    notes: (v) => outOver("Wholes, pieces and husk", n0(v.wholesKg) + n0(v.piecesKg) + n0(v.huskKg), n0(v.kgIn)),
  },
  winnowing: {
    kind: "winnowing", sheet: "Husk Winnowing", title: "Husk winnowing", who: "floor",
    help: "The husk is winnowed to recover pieces. Recovered pieces go to grading; the husk goes to storage and is sold.",
    fields: [
      { key: "huskInKg", label: "Husk in (kg)", type: "number", required: true },
      { key: "piecesRecoveredKg", label: "Pieces recovered (kg)", type: "number" },
      { key: "huskToStorageKg", label: "Husk to storage (kg)", type: "number" },
    ],
    notes: (v) => outOver("Recovered pieces and husk", n0(v.piecesRecoveredKg) + n0(v.huskToStorageKg), n0(v.huskInKg)),
  },
  grading: {
    kind: "grading", sheet: "Grading", title: "Grading day record", who: "floor",
    help: "Kg out per grade for one route and day, as on the manual peeling performance sheet. Rejection goes to the reject store and is sold.",
    fields: [
      { key: "route", label: "Route", type: "select", options: GRADING_ROUTES, required: true, keep: true },
      { key: "unit", label: "Unit", type: "text", keep: true },
      { key: "inputMaterial", label: "Input material", type: "text", hint: "As the sheet writes it, e.g. TW.", keep: true },
      ...GRADE_CODES.map((c) => ({ key: gradeKey(c), label: c, type: "number" as const })),
      { key: "rejectionKg", label: "Rejection", type: "number" },
      { key: "manpower", label: "No of manpower", type: "number", hint: "Manual peeling: the workers present." },
      { key: "recoverability", label: "Recoverability %", type: "text", hint: "As typed; its rule is still to be agreed." },
    ],
    figures: (v) => {
      const f = gradingFigures(v);
      return [
        { label: "Total", value: `${fmt(f.totalKg)} kg` },
        { label: "Avg per head", value: f.avgPerHead === null ? "-" : `${f.avgPerHead.toFixed(2)} kg` },
      ];
    },
  },
  worker_output: {
    kind: "worker_output", sheet: "Peeling Workers", title: "Worker output", who: "floor",
    help: "Manual peeling only: one line per worker present, with what they peeled that day.",
    fields: [
      { key: "employeeNo", label: "Employee no", type: "text" },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "gender", label: "Gender", type: "select", options: ["FEMALE", "MALE"] },
      { key: "kg", label: "Kg peeled", type: "number", required: true },
    ],
    figures: (v) => (num(v.kg) === null ? [{ label: "Band", value: "-" }] : [{ label: "Band", value: workerBand(n0(v.kg)), alert: n0(v.kg) < WORKER_ALERT_KG }]),
    notes: (v) => (num(v.kg) !== null && n0(v.kg) < WORKER_ALERT_KG ? [`${v.name || "This worker"} peeled under ${WORKER_ALERT_KG} kg.`] : []),
  },
  qc12: {
    kind: "qc12", sheet: "In-process Checks", title: "In-process quality", check: "QC-12", who: "qfs",
    decision: { ok: "OK", okHint: "The graded kernels go on to packing.", no: "No · back to grading", noHint: "The kernels are graded again.", noValue: "no" },
    help: "A sample of the graded or reject kernels after grading.",
    fields: [
      { key: "material", label: "Material", type: "select", options: ["Graded kernels", "Reject kernels"], required: true, keep: true },
      { key: "grade", label: "Grade", type: "select", options: [...GRADE_CODES] },
      { key: "sampleG", label: "Sample (g)", type: "number", required: true, keep: true },
      { key: "moisture", label: "Moisture (%)", type: "number" },
      { key: "remarks", label: "Remarks", type: "text" },
    ],
  },
} satisfies Record<string, EntryDef>;
