/**
 * Production Phase 3: Cooking & cooling. Each size is steam-cooked, checked (QC-3), rested 24 hours in a cooling silo
 * and checked again (QC-4); only then may the Lot be shelled. Source: the client's "Production module" document
 * (Oct 2026), Phase 3, and docs/Production/6. Cooking Process Report (Sheet1).
 */
import { SILO_SIZES, SILO_SIZE_KEYS, siloLabel, sizesTotal, type SiloSize, type SizeValues } from "./calibration.js";

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The sheet's "No of Bags" = total ÷ 80 on all 107 cooked Lots. */
export const KG_PER_BAG = 80;
export const lotBags = (totalKg: number): number => totalKg / KG_PER_BAG;

/**
 * "ANG · 26 year · G = July · 16th lot of the month": what the client writes on every sheet (E = May … I = September
 * on all 107 Lots). The app only suggests it; a Lot's code stays typed, as the sheet has real exceptions (ANG26F20A).
 */
export function nextLotCode(date: string, existing: string[]): string {
  const year = date.slice(2, 4);
  const month = Number(date.slice(5, 7));
  const prefix = `ANG${year}${String.fromCharCode(64 + month)}`;
  const seqs = existing.filter((c) => c.startsWith(prefix)).map((c) => parseInt(c.slice(prefix.length), 10)).filter(Number.isFinite);
  return `${prefix}${String(Math.max(0, ...seqs) + 1).padStart(2, "0")}`;
}

export interface CookRunValues {
  date?: string;
  code?: string;
  sizes?: SizeValues;
}

/** "Cannot exceed that silo's stock." `stock` is each silo's kg now. */
export function cookRunError(v: CookRunValues, stock: Record<SiloSize, number>): string | null {
  if (!(v.date ?? "").trim()) return "A date is required.";
  if (!(v.code ?? "").trim()) return "Give the Lot its number.";
  for (const s of SILO_SIZES) {
    const n = num(v.sizes?.[s.key]);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0) return `Size ${s.code} must be a number of kg, 0 or more.`;
    if (n > stock[s.key]) return `Silo ${siloLabel(s.key)} holds ${fmt(stock[s.key])} kg; ${fmt(n)} kg can't be cooked from it.`;
  }
  if (sizesTotal(v.sizes ?? {}) <= 0) return "Enter the kg cooked from at least one silo.";
  return null;
}

/** The kg per size of a Lot's runs, added up. A Lot can take more than one cooking row (ANG26F01 has two in the sheet). */
export function lotSizes(runs: { sizes: SizeValues }[]): Record<SiloSize, number> {
  return Object.fromEntries(SILO_SIZE_KEYS.map((k) => [k, Math.round(runs.reduce((n, r) => n + (num(r.sizes[k]) || 0), 0) * 100) / 100])) as Record<SiloSize, number>;
}

/** Hours from one "YYYY-MM-DDTHH:MM" to another. Both are factory time as typed, so no timezone comes into it. */
export function hoursBetween(from: string, to: string): number {
  return (Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 3_600_000;
}

/** The doc: "Cooling silo · time in: 24 h clock starts"; QC-4 warns under it. */
export const COOLING_HOURS = 24;

export interface CoolingValues {
  silo?: string;
  date?: string;
  time?: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (v: string | undefined | null): boolean => TIME_RE.test((v ?? "").trim());

/** Hours from one "HH:MM" to another on the same shift; past midnight when the end is earlier. */
export function durationHours(start: string | undefined, end: string | undefined): number | null {
  if (!isTime(start) || !isTime(end)) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const d = mins(end!.trim()) - mins(start!.trim());
  return (d < 0 ? d + 1440 : d) / 60;
}

export function coolingError(v: CoolingValues): string | null {
  if (!(v.silo ?? "").trim()) return "Enter the cooling silo.";
  if (!(v.date ?? "").trim()) return "A date is required.";
  if (!isTime(v.time)) return "Enter the time the Lot went in, as HH:MM.";
  return null;
}

/** QC-3 per size, from its newest approved check: "No → re-cook" holds the size until a newer check passes it. */
export type CookCheckState = "not_checked" | "waiting" | "ok" | "recook";

export const COOK_CHECK_LABELS: Record<CookCheckState, string> = {
  not_checked: "Not checked yet",
  waiting: "Waiting for approval",
  ok: "OK",
  recook: "Held · re-cook",
};

interface CheckLike {
  id: number;
  status: string;
  decision: string | null;
  values: Record<string, string | undefined>;
}

export function cookChecks(sizes: SiloSize[], qc3: CheckLike[]): Record<string, CookCheckState> {
  const newestFirst = [...qc3].sort((a, b) => b.id - a.id);
  return Object.fromEntries(sizes.map((size) => {
    const mine = newestFirst.filter((c) => c.values.size === size && c.status !== "rejected");
    if (mine[0]?.status === "submitted") return [size, "waiting"];
    const decided = mine.find((c) => c.status === "approved");
    return [size, !decided ? "not_checked" : decided.decision === "ok" ? "ok" : "recook"];
  }));
}

/** QC-4: "Wait → re-check", and "shelling cannot start on it" until the newest approved one says OK. */
export type CoolingCheckState = "not_checked" | "waiting" | "ok" | "wait";

export function coolingCheck(qc4: CheckLike[]): CoolingCheckState {
  const newestFirst = [...qc4].filter((c) => c.status !== "rejected").sort((a, b) => b.id - a.id);
  if (newestFirst[0]?.status === "submitted") return "waiting";
  const decided = newestFirst.find((c) => c.status === "approved");
  return !decided ? "not_checked" : decided.decision === "ok" ? "ok" : "wait";
}

/**
 * The doc's Lot statuses as far as Colour sort, plus its step 5 "Ready for shelling". Worked out from the records, never
 * typed. Phases 4 and 5 read this one for what they allow (shelling only after QC-4), whatever later phase the Lot has
 * records in.
 */
export type EarlyLotStatus = "cooking" | "cooling" | "ready" | "shelled" | "colour_sorted";

/** Phases 6–8 (domain/laterPhases.ts works out which): the furthest phase with a record. */
export type LaterLotStatus = "in_borma" | "humidified" | "peeled" | "graded" | "packed" | "qc11_passed" | "dispatched";

/** A Lot's one status, as the run and the Lot lists show it. */
export type LotStatus = EarlyLotStatus | LaterLotStatus;

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  cooking: "Cooking",
  cooling: "Cooling",
  ready: "Ready for shelling",
  shelled: "Shelled",
  colour_sorted: "Colour sorted",
  in_borma: "In Borma",
  humidified: "Humidified",
  peeled: "Peeled",
  graded: "Graded",
  packed: "Packed",
  qc11_passed: "QC-11 passed",
  dispatched: "Dispatched",
};

export function lotStatus(v: { inCooling: boolean; cooling: CoolingCheckState; shellingDays: number; colourSorted?: boolean }): EarlyLotStatus {
  if (v.shellingDays > 0) return v.colourSorted ? "colour_sorted" : "shelled";
  if (!v.inCooling) return "cooking";
  return v.cooling === "ok" ? "ready" : "cooling";
}

/** Past QC-4, so anything of Phase 4 may be recorded on it. */
export const canShell = (status: EarlyLotStatus): boolean => status === "ready" || status === "shelled" || status === "colour_sorted";

/** Shelled, so the sorter has its kernels: Phase 5 may be recorded on it. */
export const canColourSort = (status: EarlyLotStatus): boolean => status === "shelled" || status === "colour_sorted";

export type CookingStep = "cook" | "cooker_log" | "qc3" | "cooling" | "qc4" | "none";

/**
 * Held sizes with no cooker run since the check that held them: these still have to be cooked again. Once the new run
 * is logged the job passes back to the QFS Officer, who checks the size again.
 */
export function sizesToRecook(sizes: SiloSize[], entries: { id: number; kind: string; status: string; decision: string | null; values: Record<string, string | undefined> }[]): SiloSize[] {
  return sizes.filter((size) => {
    const checks = entries.filter((e) => e.kind === "qc3" && e.status === "approved" && e.values.size === size).sort((a, b) => b.id - a.id);
    const newest = checks[0];
    if (!newest || newest.decision === "ok") return false;
    return !entries.some((e) => e.kind === "cooker_log" && e.values.size === size && e.id > newest.id);
  });
}

/**
 * The one job to point this person at, for a Lot still in Phase 3. A QFS Officer is only sent to a check, the
 * Incharge also to the floor's jobs and to approvals.
 */
export function nextCookingStep(v: { canFloor: boolean; canCheck: boolean; canReview: boolean; loggedSizes: SiloSize[]; sizes: SiloSize[]; checks: Record<string, CookCheckState>; toRecook: SiloSize[]; inCooling: boolean; cooling: CoolingCheckState }): CookingStep {
  const states = v.sizes.map((s) => v.checks[s]);
  if (!v.inCooling) {
    if (v.canReview && states.includes("waiting")) return "qc3";
    if (v.canFloor && v.sizes.some((s) => !v.loggedSizes.includes(s))) return "cooker_log";
    if (v.canFloor && v.toRecook.length > 0) return "cooker_log";
    // A held size whose new run is logged wants its check again, just as a size never checked does.
    if (v.canCheck && v.sizes.some((s) => v.checks[s] === "not_checked" || (v.checks[s] === "recook" && !v.toRecook.includes(s)))) return "qc3";
    if (v.canFloor && states.every((s) => s === "ok")) return "cooling";
    return "none";
  }
  if (v.canReview && v.cooling === "waiting") return "qc4";
  if (v.canCheck && (v.cooling === "not_checked" || v.cooling === "wait")) return "qc4";
  return "none";
}
