/**
 * The small records a Lot collects in Phases 3 and 4: one definition each, one form and one table to show them all,
 * so a new record is a data change here rather than a new component. Fields and rules are the "Production module"
 * document's; column words and the formulas it leaves out come from the client's own sheets, measured on every row:
 * "23. Shelling Line wise Processing Data", "21.Shelling Frequency Machine Report", "13. Shelling Machine Quality
 * Reports" (9,173 sampled rows) and "11. Shell Waste Sample Report" (1,449 sampled rows).
 *
 * `who: "qfs"` is a quality check: a QFS Officer's waits for the Incharge, an Incharge's or Admin's is approved as it
 * is saved. `who: "floor"` is the floor's own record: the Incharge's or Admin's for now (Data Entry later).
 */
import { COOLING_HOURS, durationHours, hoursBetween, isTime } from "./cooking.js";

export { durationHours };
import { SILO_SIZES, siloFromWord, siloLabel, type SiloSize } from "./calibration.js";
import { SORTER_SIZE_GROUPS, SORTER_STREAMS, sorterFigures } from "./colourSort.js";
import { BORMA_ENTRY_DEFS } from "./borma.js";
import { PEELING_ENTRY_DEFS } from "./peeling.js";
import { PACKING_ENTRY_DEFS } from "./packing.js";

export const ENTRY_KINDS = [
  "cooker_log", "qc3", "qc4", "waste_water", "line_run", "qc5_frequency", "qc5_capacity", "qty1", "qc6", "qc7_before", "qc7_after",
  // Phase 6 · Borma (domain/borma.ts)
  "borma_trolley", "borma_oven", "qc8",
  // Phase 7 · Humidification, peeling & grading (domain/peeling.ts)
  "humidification", "qc10", "peeling", "winnowing", "grading", "worker_output", "qc12",
  // Phase 8 · Packing & dispatch (domain/packing.ts)
  "packing", "qc9", "qc11", "fg_dispatch",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** The 14 cutting lines, as the sheets name them; the doc: "14 cutting lines open the shells". */
export const SHELLING_LINES = ["A++", "A+", "A1", "A2", "AB", "B1", "B2", "B3", "BC", "C1", "C2", "C3", "D", "DE"];
/** All values of the sheet's Shift column. */
export const SHIFTS = ["A", "B", "G"];
/** All values of the shell sample sheet's Sampling Point column. */
export const SHELL_SAMPLE_POINTS = ["Line 1", "Line 2", "Direct Line", "Before Conveyor", "After Conveyor"];
export const YES_NO = ["Yes", "No"];

/** The doc's targets: "Wholes % (target 95 %)", "Alert if kernel left in shell > 0.5 %". */
export const WHOLES_TARGET_PCT = 95;
export const KERNEL_IN_SHELL_ALERT_PCT = 0.5;

export type EntryFieldType = "number" | "text" | "time" | "size" | "line" | "select";

export interface EntryField {
  key: string;
  label: string;
  type: EntryFieldType;
  required?: boolean;
  options?: string[];
  hint?: string;
  /** Kept when "Save and add another" clears the rest: what stays the same from one sample to the next. */
  keep?: boolean;
}

export interface EntryFigure {
  label: string;
  value: string;
  /** Out of the doc's target: shown in red. */
  alert?: boolean;
}

type Values = Record<string, string | undefined>;

export interface EntryDef {
  kind: EntryKind;
  /** The tab of the production workbook. */
  sheet: string;
  title: string;
  /** "QC-3" and so on, for what the doc numbers. */
  check?: string;
  who: "qfs" | "floor";
  /** How it asks for the decision; absent where the doc only raises an alert. */
  decision?: { ok: string; okHint: string; no: string; noHint: string; noValue: "no" | "wait" };
  /** One line above the form, in plain words. */
  help: string;
  fields: EntryField[];
  figures?: (v: Values) => EntryFigure[];
  /** Soft alerts, never refusals: the sheets break them on real rows. */
  notes?: (v: Values, ctx: EntryContext) => string[];
}

export interface EntryContext {
  date?: string;
  /** "YYYY-MM-DDTHH:MM" the Lot went into its cooling silo. */
  coolingAt?: string | null;
}

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const n0 = (v: string | undefined | null) => num(v) || 0;
const sum = (v: Values, keys: string[]) => keys.reduce((n, k) => n + n0(v[k]), 0);
const pct = (n: number, digits = 1) => `${n.toFixed(digits)} %`;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

const hrs = (h: number | null) => (h === null ? "-" : `${h.toFixed(2)} h`);

/** The sheet's own factor for Kernel lbs: 176.36, to the last decimal on its rows. */
const LBS_PER_BAG = 176.36;

/**
 * QC-5's numbers, as the sheet's formulas on all 9,173 rows. Knife-marked kernels are already among the wholes, so they
 * count in Total Kernels but not towards what the sample must add up to (the sheet's Error column).
 */
export function machineSampleFigures(v: Values) {
  const sample = n0(v.sampleG);
  const totalKernels = sum(v, ["wholesG", "piecesG", "edgeCutG", "buttsG", "knifeMarkG"]);
  const ofKernels = (g: number) => (totalKernels > 0 ? (g / totalKernels) * 100 : 0);
  return {
    totalKernels,
    wholesPct: ofKernels(n0(v.wholesG)),
    piecesPct: ofKernels(n0(v.piecesG) + n0(v.buttsG)),
    knifeMarkPct: ofKernels(n0(v.knifeMarkG)),
    edgeCutPct: ofKernels(n0(v.edgeCutG)),
    uncutPct: sample > 0 ? (n0(v.uncutG) / sample) * 100 : 0,
    unscoopPct: sample > 0 ? ((n0(v.unscoopWholesG) + n0(v.unscoopPiecesG)) / sample) * 100 : 0,
    errorG: sample - sum(v, ["wholesG", "piecesG", "edgeCutG", "buttsG", "uncutG", "unscoopWholesG", "unscoopPiecesG", "shellG"]),
  };
}

/**
 * QC-6's kernel left in the shell, as the sheet's Kernel % on all 1,449 sampled rows: an unscooped nut still holds 0.4 of
 * its weight in kernel and an uncut one 0.28; the Rejection column is weighed but never counted. Real check (row of
 * 1000 g, 5 g whole, 8 g brokens, 5 g unscoop, 12 g uncut): 1.836 %.
 */
export function shellSampleFigures(v: Values) {
  const sample = n0(v.sampleG);
  const kernelPct = sample > 0 ? ((n0(v.wholeG) + n0(v.brokensG) + 0.4 * n0(v.unscoopG) + 0.28 * n0(v.uncutG)) / sample) * 100 : 0;
  return { kernelPct, kernelLbs: (kernelPct / 100) * LBS_PER_BAG, errorG: sample - sum(v, ["wholeG", "brokensG", "rejectionG", "unscoopG", "uncutG", "shellG"]) };
}

/** QC-7's sample, the same on both sides of the sorter: the sheet's columns, with the doc's stream and size group. */
const SORTER_FIELDS: EntryField[] = [
  { key: "stream", label: "Stream", type: "select", options: [...SORTER_STREAMS], required: true, keep: true },
  { key: "sizes", label: "Size group", type: "select", options: SORTER_SIZE_GROUPS, keep: true },
  { key: "shift", label: "Shift", type: "select", options: ["A", "B"], keep: true },
  { key: "sampleG", label: "Sample (g)", type: "number", required: true, keep: true },
  { key: "nutCount", label: "Nut count", type: "number" },
  { key: "moisture", label: "Moisture (%)", type: "number" },
  { key: "wholesG", label: "Wholes (g)", type: "number" },
  { key: "brokensG", label: "Brokens (g)", type: "number" },
  { key: "buttsG", label: "Butts (g)", type: "number" },
  { key: "knifeMarkG", label: "Knife mark (g)", type: "number", hint: "The sheet's Backcut." },
  { key: "rejectionG", label: "Rejection (g)", type: "number" },
  { key: "oilDirtG", label: "Oil / dirt (g)", type: "number" },
  { key: "edgeCutG", label: "Edge cut (g)", type: "number" },
  { key: "uncutG", label: "Uncut (g)", type: "number" },
  { key: "unscoopG", label: "Unscoop (g)", type: "number" },
  { key: "shellG", label: "Shell (g)", type: "number" },
];

const sorterFigureList = (v: Values): EntryFigure[] => {
  const f = sorterFigures(v);
  return [
    { label: "Wholes %", value: pct(f.wholesPct) },
    { label: "Brokens %", value: pct(f.brokensPct) },
    { label: "Rejection %", value: pct(f.rejectionPct) },
    { label: "Knife mark %", value: pct(f.knifeMarkPct) },
    { label: "Shell %", value: pct(f.shellPct) },
  ];
};

/** "Parts must add up to the sample": a note, as the sheet has a real row off by grams. */
const sorterNotes = (v: Values): string[] => {
  const f = sorterFigures(v);
  return n0(v.sampleG) > 0 && Math.abs(f.errorG) > 0.0001 ? [`The parts add up to ${fmt(n0(v.sampleG) - f.errorG)} g, not the ${fmt(n0(v.sampleG))} g sample.`] : [];
};

export const ENTRY_DEFS: Record<EntryKind, EntryDef> = {
  cooker_log: {
    kind: "cooker_log", sheet: "Cooker Log", title: "Cooker log", who: "floor",
    help: "One line for each run of a cooker. A re-cook is a new line, so both runs stay on record.",
    fields: [
      { key: "size", label: "Size", type: "size", required: true },
      { key: "start", label: "Start", type: "time", required: true },
      { key: "stop", label: "Stop", type: "time", required: true },
      { key: "tempC", label: "Temperature (°C)", type: "number", required: true },
      { key: "pressureBar", label: "Pressure (bar)", type: "number", required: true },
    ],
    figures: (v) => [{ label: "Running time", value: hrs(durationHours(v.start, v.stop)) }],
  },
  qc3: {
    kind: "qc3", sheet: "Cooking Checks", title: "Cooking check", check: "QC-3", who: "qfs",
    decision: { ok: "OK", okHint: "The cooker's settings were met for this size.", no: "No · re-cook", noHint: "The size is held and cooked again.", noValue: "no" },
    help: "One check for each size cooked: were the cooker's settings met?",
    fields: [
      { key: "size", label: "Size", type: "size", required: true },
      { key: "remarks", label: "Remarks", type: "text" },
    ],
  },
  qc4: {
    kind: "qc4", sheet: "Cooling Checks", title: "Moisture and temperature check", check: "QC-4", who: "qfs",
    decision: { ok: "OK", okHint: "The Lot can go to shelling.", no: "Wait", noHint: "The Lot stays in the cooling silo and is checked again.", noValue: "wait" },
    help: "After 24 hours in the cooling silo. Shelling can't start until this says OK.",
    fields: [
      { key: "time", label: "Time of the check", type: "time", required: true },
      { key: "moisture", label: "Moisture (%)", type: "number", required: true },
      { key: "tempC", label: "Temperature (°C)", type: "number", required: true },
    ],
    notes: (v, ctx) => {
      if (!ctx.coolingAt || !ctx.date || !isTime(v.time)) return [];
      const h = hoursBetween(ctx.coolingAt, `${ctx.date}T${v.time!.trim()}`);
      return h < COOLING_HOURS ? [`Only ${Math.max(0, h).toFixed(1)} hours in the cooling silo; ${COOLING_HOURS} hours are expected.`] : [];
    },
  },
  waste_water: {
    kind: "waste_water", sheet: "Waste Water", title: "Cooking waste water", who: "floor",
    help: "What went to the waste water tank. It leaves by truck, recorded under By-products & trucks.",
    fields: [
      { key: "kg", label: "Quantity (kg)", type: "number", required: true },
      { key: "tank", label: "Tank", type: "text" },
    ],
  },
  line_run: {
    kind: "line_run", sheet: "Line Runs", title: "Line run", who: "floor",
    help: "One line for each cutting line that ran this Lot.",
    fields: [
      { key: "line", label: "Line", type: "line", required: true },
      { key: "size", label: "Size", type: "size", required: true },
      { key: "inputKg", label: "Input (kg)", type: "number", required: true },
      { key: "start", label: "Start", type: "time", required: true },
      { key: "end", label: "End", type: "time", required: true },
      { key: "uncutKg", label: "Uncut (kg)", type: "number" },
    ],
    figures: (v) => [
      { label: "Duration", value: hrs(durationHours(v.start, v.end)) },
      { label: "Uncut %", value: n0(v.inputKg) > 0 ? pct((n0(v.uncutKg) / n0(v.inputKg)) * 100) : "-" },
    ],
  },
  qc5_frequency: {
    kind: "qc5_frequency", sheet: "Machine Frequency", title: "Machine frequency", check: "QC-5", who: "qfs",
    help: "How fast each machine runs. Count the grams it cuts in one minute.",
    fields: [
      { key: "line", label: "Line", type: "line", required: true, keep: true },
      { key: "machine", label: "Machine no", type: "number", required: true },
      { key: "gramsPerMin", label: "Grams per minute", type: "number", required: true },
    ],
    figures: (v) => [{ label: "Kg per hour", value: fmt(n0(v.gramsPerMin) * 0.06) }],
  },
  qc5_capacity: {
    kind: "qc5_capacity", sheet: "Machine Samples", title: "Machine capacity sample", check: "QC-5", who: "qfs",
    help: "A 1,000 g sample from one machine, weighed into its parts. The percentages tell you if the machine needs adjusting.",
    fields: [
      { key: "shift", label: "Shift", type: "select", options: SHIFTS, required: true, keep: true },
      { key: "line", label: "Line", type: "line", required: true, keep: true },
      { key: "machine", label: "Machine no", type: "number", required: true },
      { key: "sampleG", label: "Sample (g)", type: "number", required: true, keep: true },
      { key: "wholesG", label: "Wholes (g)", type: "number" },
      { key: "piecesG", label: "Pieces (g)", type: "number" },
      { key: "edgeCutG", label: "Edge cut (g)", type: "number" },
      { key: "buttsG", label: "Butts (g)", type: "number" },
      { key: "knifeMarkG", label: "Knife mark (g)", type: "number", hint: "Already among the wholes." },
      { key: "uncutG", label: "Uncut (g)", type: "number" },
      { key: "unscoopWholesG", label: "Unscoop wholes (g)", type: "number" },
      { key: "unscoopPiecesG", label: "Unscoop pieces (g)", type: "number" },
      { key: "shellG", label: "Shell (g)", type: "number" },
    ],
    figures: (v) => {
      const f = machineSampleFigures(v);
      return [
        { label: "Wholes %", value: pct(f.wholesPct), alert: f.totalKernels > 0 && f.wholesPct < WHOLES_TARGET_PCT },
        { label: "Uncut %", value: pct(f.uncutPct) },
        { label: "Unscoop %", value: pct(f.unscoopPct) },
        { label: "Knife mark %", value: pct(f.knifeMarkPct) },
      ];
    },
    notes: (v) => {
      const f = machineSampleFigures(v);
      const out: string[] = [];
      if (f.totalKernels > 0 && f.wholesPct < WHOLES_TARGET_PCT) out.push(`Wholes ${pct(f.wholesPct)} is below the ${WHOLES_TARGET_PCT} % target: check the machine.`);
      if (Math.abs(f.errorG) > 0.0001) out.push(`The parts add up to ${fmt(n0(v.sampleG) - f.errorG)} g, not the ${fmt(n0(v.sampleG))} g sample.`);
      return out;
    },
  },
  qty1: {
    kind: "qty1", sheet: "Uncut Checks", title: "Uncut quantity check", check: "QTY-1", who: "qfs",
    help: "Shells that did not open, per line. They go back through shelling until only the final uncut is left.",
    fields: [
      { key: "line", label: "Line", type: "line", required: true },
      { key: "kg", label: "Uncut (kg)", type: "number", required: true },
      { key: "repassed", label: "Repassed?", type: "select", options: YES_NO, required: true },
    ],
  },
  qc6: {
    kind: "qc6", sheet: "Shell Samples", title: "Kernel left in the shell", check: "QC-6", who: "qfs",
    help: "A sample of the shell before it goes to the silo. Too much kernel means a line must be checked; the shell still moves on.",
    fields: [
      { key: "point", label: "Sampling point", type: "select", options: SHELL_SAMPLE_POINTS, required: true, keep: true },
      { key: "sampleG", label: "Sample (g)", type: "number", required: true, keep: true },
      { key: "wholeG", label: "Whole (g)", type: "number" },
      { key: "brokensG", label: "Brokens (g)", type: "number" },
      { key: "rejectionG", label: "Rejection (g)", type: "number" },
      { key: "unscoopG", label: "Unscoop (g)", type: "number" },
      { key: "uncutG", label: "Uncut (g)", type: "number" },
      { key: "shellG", label: "Shell (g)", type: "number" },
    ],
    figures: (v) => {
      const f = shellSampleFigures(v);
      return [
        { label: "Kernel left in shell", value: pct(f.kernelPct, 2), alert: f.kernelPct > KERNEL_IN_SHELL_ALERT_PCT },
        { label: "Kernel lbs per bag", value: f.kernelLbs.toFixed(2) },
      ];
    },
    notes: (v) => {
      const f = shellSampleFigures(v);
      const out: string[] = [];
      if (f.kernelPct > KERNEL_IN_SHELL_ALERT_PCT) out.push(`${pct(f.kernelPct, 2)} kernel left in the shell, above ${KERNEL_IN_SHELL_ALERT_PCT} %: check the line.`);
      if (Math.abs(f.errorG) > 0.0001) out.push(`The parts add up to ${fmt(n0(v.sampleG) - f.errorG)} g, not the ${fmt(n0(v.sampleG))} g sample.`);
      return out;
    },
  },
  qc7_before: {
    kind: "qc7_before", sheet: "Sorter Before", title: "Sample before the sorter", check: "QC-7", who: "qfs",
    help: "A 1,000 g sample of the shelled kernels going into the colour sorter, weighed into its parts.",
    fields: SORTER_FIELDS, figures: sorterFigureList, notes: sorterNotes,
  },
  qc7_after: {
    kind: "qc7_after", sheet: "Sorter After", title: "Sample after the sorter", check: "QC-7", who: "qfs",
    decision: { ok: "OK", okHint: "The stream goes on to the Borma ovens.", no: "No · sort again", noHint: "The stream goes through the sorter again before Borma.", noValue: "no" },
    help: "A 1,000 g sample of one stream coming out of the sorter. One check for each stream: wholes, pieces, and rejection + oil.",
    fields: SORTER_FIELDS, figures: sorterFigureList, notes: sorterNotes,
  },
  ...BORMA_ENTRY_DEFS,
  ...PEELING_ENTRY_DEFS,
  ...PACKING_ENTRY_DEFS,
};

/**
 * Which phase of the run each kind belongs to. Phases 6 to 8 take their records on any Lot of the run, in any order:
 * nothing waits for an earlier phase to finish — a failed check only shows, and its result is what counts.
 */
export const ENTRY_PHASE: Record<EntryKind, number> = {
  cooker_log: 3, qc3: 3, qc4: 3, waste_water: 3,
  line_run: 4, qc5_frequency: 4, qc5_capacity: 4, qty1: 4, qc6: 4,
  qc7_before: 5, qc7_after: 5,
  borma_trolley: 6, borma_oven: 6, qc8: 6,
  humidification: 7, qc10: 7, peeling: 7, winnowing: 7, grading: 7, worker_output: 7, qc12: 7,
  packing: 8, qc9: 8, qc11: 8, fg_dispatch: 8,
};

/** The floor's own records can be corrected (a Borma trolley is weighed after the oven, hours after its line). A quality check stays as recorded. */
export const isEditableKind = (kind: EntryKind): boolean => ENTRY_DEFS[kind].who === "floor";

/** Recorded on a Lot only once it is shelled: the sorter works on what shelling gave. */
export const AFTER_SHELLING: EntryKind[] = ["qc7_before", "qc7_after"];

/** Recorded on a Lot only once QC-4 has passed it. */
export const AFTER_COOLING: EntryKind[] = ["line_run", "qc5_frequency", "qc5_capacity", "qty1", "qc6"];

export const isEntryKind = (v: unknown): v is EntryKind => typeof v === "string" && (ENTRY_KINDS as readonly string[]).includes(v);

export const sizeWord = (size: string | undefined): string => SILO_SIZES.find((s) => s.key === size)?.sheet ?? (size ?? "");

/** A field's value as a person reads it. */
export function entryFieldText(field: EntryField, value: string | undefined): string {
  if (!value) return "-";
  return field.type === "size" && SILO_SIZES.some((s) => s.key === value) ? siloLabel(value as SiloSize) : value;
}

/** A value from a form or a file → as stored: a size word read to its silo; everything else trimmed. */
export function normalizeEntryValues(kind: EntryKind, raw: Values): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ENTRY_DEFS[kind].fields) {
    const t = (raw[f.key] ?? "").trim();
    if (!t) continue;
    out[f.key] = f.type === "size" ? (SILO_SIZES.some((s) => s.key === t) ? t : siloFromWord(t) ?? t) : t;
  }
  return out;
}

export interface EntryValues {
  date?: string;
  values?: Values;
  decision?: string;
}

/**
 * The form's checks; the first problem, or null. `sizes` limits a size field to the sizes this Lot actually cooked.
 * Values are stored as typed; a number is only checked to be one.
 */
export function entryError(kind: EntryKind, v: EntryValues, sizes?: SiloSize[]): string | null {
  const def = ENTRY_DEFS[kind];
  if (!(v.date ?? "").trim()) return "A date is required.";
  const values = normalizeEntryValues(kind, v.values ?? {});
  for (const f of def.fields) {
    const t = values[f.key];
    if (!t) {
      if (f.required) return `Enter ${f.label.toLowerCase().replace(/ \(.*\)$/, "")}.`;
      continue;
    }
    if (f.type === "number") {
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) return `${f.label} must be a number, 0 or more.`;
    }
    if (f.type === "time" && !isTime(t)) return `${f.label} must be a time, as HH:MM.`;
    if (f.type === "line" && !SHELLING_LINES.includes(t)) return `${t} is not one of the 14 lines.`;
    if (f.type === "select" && !f.options!.includes(t)) {
      return f.options!.length > 20 ? `${f.label} must be one of the ${f.options!.length} in the list ("${t}" isn't).` : `${f.label} must be one of ${f.options!.join(", ")}.`;
    }
    if (f.type === "size") {
      if (!SILO_SIZES.some((s) => s.key === t)) return `${t} is not one of the 9 sizes.`;
      if (sizes && kind !== "line_run" && !sizes.includes(t as SiloSize)) return `This Lot cooked no size ${siloLabel(t as SiloSize)}.`;
    }
  }
  if (kind === "qc4" && Number(values.moisture) > 20) return "Moisture must be a number between 0 and 20.";
  if (def.decision && v.decision !== "ok" && v.decision !== def.decision.noValue) return `Choose ${def.decision.ok} or ${def.decision.no}.`;
  return null;
}

export const entryNotes = (kind: EntryKind, values: Values, ctx: EntryContext): string[] => ENTRY_DEFS[kind].notes?.(values, ctx) ?? [];
export const entryFigures = (kind: EntryKind, values: Values): EntryFigure[] => ENTRY_DEFS[kind].figures?.(values) ?? [];
